-- Documentation-only follow-up: no behavior change. Adds COMMENT ON for the two new
-- tables/functions (previously undocumented at the catalog level) and two inline
-- comments inside fanout_notification_event clarifying non-obvious intent that a
-- future maintainer could otherwise "fix" incorrectly:
--   1) why "not found" and "not authorized" are merged into one boolean/one error
--   2) why the category_enabled CASE has a branch (artist_updates) that v_category
--      can never currently equal
-- Body is byte-for-byte identical in logic to the version applied in
-- 20260729213817_sprint3_5_harden_notification_functions.sql; only comments added.
--
-- ROLLBACK: comments are inert; safe to leave in place indefinitely. To fully revert,
-- reapply that migration's function body verbatim (no COMMENT ON statements).

create or replace function public.fanout_notification_event(p_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event public.notification_events;
  v_category text;
  v_inserted integer := 0;
  v_authorized boolean;
begin
  select * into v_event from public.notification_events where id = p_event_id;

  -- Deliberately a single boolean covering both "event doesn't exist" and "caller
  -- isn't admin/manager/owner of it": raising one generic error for both keeps this
  -- function from being usable as an oracle to enumerate valid notification_event ids.
  v_authorized := found and (
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
  );

  if not v_authorized then
    raise exception 'notification_event not found or not authorized';
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
          -- artist_updates has no event_type mapped to it above (yet): this branch
          -- is reserved for a future event source and is currently unreachable.
          -- user_notification_preferences.artist_updates still exists so a UI can
          -- collect the preference ahead of that event source shipping.
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

comment on function public.fanout_notification_event(uuid) is
  'Fans a notification_events row out to pending notification_deliveries rows, one per (follower, enabled channel), respecting user_notification_preferences. Caller must be admin, a manager, or the entity owner. Idempotent: safe to call more than once for the same event_id. Not currently invoked by any trigger or application code.';

comment on function public.mark_notification_read(uuid, text) is
  'Sets read_state (unread/read/dismissed) on a notification_deliveries row the caller owns. No-ops silently (0 rows affected, no error) if the delivery belongs to someone else. read_at reflects the last time the row was marked read and is not cleared by a later unread/dismissed call.';

comment on table public.notification_deliveries is
  'One row per (notification_event, recipient, channel): tracks send status for a future delivery worker (pending/processing/delivered/failed/skipped, retry_count, failure_reason, provider_message_id) and, for the in_app channel, doubles as the read/unread record (read_state, opened_at, read_at). Rows are only ever created by fanout_notification_event and only ever have read_state changed via mark_notification_read.';

comment on table public.user_notification_preferences is
  'Per-user channel toggles (in_app/email/web_push) and per-category alert toggles, consulted by fanout_notification_event. email_enabled defaults false and is unrelated to newsletter/marketing consent (see newsletter_subscribers).';
