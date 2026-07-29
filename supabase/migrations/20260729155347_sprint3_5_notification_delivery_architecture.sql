-- Sprint 3.5: Notification Delivery Architecture
-- Purely additive: 2 new tables, 2 new functions, 0 changes to any existing
-- table/column/function.
--
-- ROLLBACK (reverse dependency order):
--   drop function if exists public.mark_notification_read(uuid, text);
--   drop function if exists public.fanout_notification_event(uuid);
--   drop table if exists public.notification_deliveries;
--   drop table if exists public.user_notification_preferences;

-- 1) user_notification_preferences
create table public.user_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  in_app_enabled   boolean not null default true,
  email_enabled    boolean not null default false,
  web_push_enabled boolean not null default false,
  new_gig_alerts      boolean not null default true,
  cancellation_alerts boolean not null default true,
  artist_updates       boolean not null default true,
  venue_updates        boolean not null default true,
  festival_updates     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_notification_preferences enable row level security;
create policy "notification_preferences_select_own" on public.user_notification_preferences
  for select using (auth.uid() = user_id);
create policy "notification_preferences_insert_own" on public.user_notification_preferences
  for insert with check (auth.uid() = user_id);
create policy "notification_preferences_update_own" on public.user_notification_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) notification_deliveries
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_event_id uuid not null references public.notification_events(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  delivery_channel text not null check (delivery_channel in ('in_app', 'email', 'web_push')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'processing', 'delivered', 'failed', 'skipped')),
  attempted_at timestamptz,
  delivered_at timestamptz,
  failed_at    timestamptz,
  retry_count  integer not null default 0,
  failure_reason      text,
  provider_message_id text,
  read_state text not null default 'unread' check (read_state in ('unread', 'read', 'dismissed')),
  opened_at timestamptz,
  read_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_event_id, recipient_user_id, delivery_channel)
);
alter table public.notification_deliveries enable row level security;
create index notification_deliveries_recipient_idx on public.notification_deliveries (recipient_user_id, created_at desc);
create index notification_deliveries_status_idx on public.notification_deliveries (delivery_status);
create index notification_deliveries_created_at_idx on public.notification_deliveries (created_at desc);
create index notification_deliveries_pending_idx on public.notification_deliveries (created_at) where delivery_status = 'pending';
create policy "notification_deliveries_select_own" on public.notification_deliveries
  for select using (auth.uid() = recipient_user_id);
create policy "notification_deliveries_select_admin" on public.notification_deliveries
  for select using (is_admin());
create policy "notification_deliveries_admin_write" on public.notification_deliveries
  for all using (is_admin()) with check (is_admin());

-- 3) mark_notification_read
create or replace function public.mark_notification_read(p_delivery_id uuid, p_state text default 'read')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('read', 'dismissed', 'unread') then
    raise exception 'invalid read_state: %', p_state;
  end if;
  update public.notification_deliveries
  set read_state = p_state,
      opened_at = coalesce(opened_at, case when p_state in ('read','dismissed') then now() else opened_at end),
      read_at = case when p_state = 'read' then now() else read_at end,
      updated_at = now()
  where id = p_delivery_id
    and recipient_user_id = auth.uid();
end;
$$;

-- 4) fanout_notification_event
create or replace function public.fanout_notification_event(p_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event public.notification_events;
  v_category text;
  v_inserted integer := 0;
begin
  select * into v_event from public.notification_events where id = p_event_id;
  if not found then
    raise exception 'notification_event % not found', p_event_id;
  end if;

  if not (
    public.is_admin()
    or public.manages_entity(v_event.entity_type, v_event.entity_id)
    or (
      v_event.entity_type in ('band', 'solo_artist', 'festival')
      and exists (select 1 from public.profiles where id = v_event.entity_id and user_id = auth.uid())
    )
    or (
      v_event.entity_type = 'venue'
      and exists (select 1 from public.venues where id = v_event.entity_id and user_id = auth.uid())
    )
  ) then
    raise exception 'not authorized to fan out notification_event %', p_event_id;
  end if;

  v_category := case v_event.event_type
    when 'gig_added'          then 'new_gig_alerts'
    when 'gig_cancelled'      then 'cancellation_alerts'
    when 'venue_event_added'  then 'venue_updates'
    when 'festival_updated'   then 'festival_updates'
    else null
  end;
  if v_category is null then
    raise exception 'unmapped event_type: %', v_event.event_type;
  end if;

  with followers as (
    select bf.user_id
    from public.band_follows bf
    where v_event.entity_type in ('band', 'solo_artist', 'festival')
      and bf.band_profile_id = v_event.entity_id
    union
    select vf.user_id
    from public.venue_follows vf
    where v_event.entity_type = 'venue'
      and vf.venue_id = v_event.entity_id
  ),
  prefs as (
    select
      f.user_id,
      coalesce(p.in_app_enabled, true)   as in_app_enabled,
      coalesce(p.email_enabled, false)   as email_enabled,
      coalesce(p.web_push_enabled, false) as web_push_enabled,
      coalesce(
        case v_category
          when 'new_gig_alerts'      then p.new_gig_alerts
          when 'cancellation_alerts' then p.cancellation_alerts
          when 'artist_updates'      then p.artist_updates
          when 'venue_updates'       then p.venue_updates
          when 'festival_updates'    then p.festival_updates
        end,
        true
      ) as category_enabled
    from followers f
    left join public.user_notification_preferences p on p.user_id = f.user_id
  ),
  channels as (
    select user_id, 'in_app'::text as delivery_channel from prefs where category_enabled and in_app_enabled
    union all
    select user_id, 'email'::text from prefs where category_enabled and email_enabled
    union all
    select user_id, 'web_push'::text from prefs where category_enabled and web_push_enabled
  )
  insert into public.notification_deliveries (notification_event_id, recipient_user_id, delivery_channel)
  select p_event_id, user_id, delivery_channel from channels
  on conflict (notification_event_id, recipient_user_id, delivery_channel) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
