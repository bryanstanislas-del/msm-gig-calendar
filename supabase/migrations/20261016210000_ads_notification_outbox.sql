-- Ads phase 1 -- advertising notification OUTBOX (forward migration on top
-- of 20261016180000). STATUS: NOT APPLIED to any remote database.
--
-- Disabled by default, twice over: the DB switch `ads_email_enabled`
-- (default OFF) makes ad_notify_claim return nothing, and the server worker
-- additionally needs ADS_EMAIL_ENABLED=true plus its own secret. Rows are
-- still ENQUEUED while disabled (from persisted facts), so nothing is lost
-- and MSM can see what would be sent.
--
-- Kinds (payload = persisted facts copied at enqueue; templates use only it):
--   initial_priority_admin_alert  admin: a 12-hour priority clock started
--   correction_request            advertiser: reasons + exact version
--   correction_deadline           advertiser: exact persisted response deadline
--                                 (only known once the request notice is delivered)
--   review_outcome                advertiser: approved / rejected (+ reason)
--   booking_confirmation          advertiser: durable order confirmation
--
-- Semantics (explicit, see docs/ads/agreed-terms-implementation.md):
--   * accepted  = the provider accepted the message. NOT delivery, NOT read.
--   * delivered = the provider reported delivery to the recipient's mail
--                 server. NOT proof of reading. For a correction_request
--                 this (and only this, or the admin fallback) starts the
--                 3-working-hour response window, at the reported time.
--   * bounced/failed/suppressed before delivery = known failure: no window.
--     After delivery = late failure -> notice_exception (MSM decides; gate).
--   * opened/clicked events are ignored (never treated as reading).

insert into public.ad_settings (key, bool_value, int_value, text_value, description) values
  ('ads_email_enabled', false, null, null,
   'Advertising emails may be claimed by the server worker. Default OFF. The worker also needs ADS_EMAIL_ENABLED=true and its secret.')
on conflict (key) do nothing;

create table public.ad_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('initial_priority_admin_alert', 'correction_request', 'correction_deadline',
                                     'review_outcome', 'booking_confirmation')),
  dedupe_key text not null unique,
  booking_id uuid references public.ad_bookings(id) on delete restrict,
  correction_request_id uuid references public.ad_correction_requests(id) on delete restrict,
  creative_version_id uuid references public.ad_creative_versions(id) on delete restrict,
  recipient_role text not null check (recipient_role in ('advertiser', 'admin')),
  recipient_email text check (recipient_email is null or char_length(recipient_email) <= 254),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'accepted', 'delivered', 'bounced', 'complained', 'failed', 'dead', 'cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null,
  lease_until timestamptz,
  provider_message_id text unique,
  last_error text,
  created_at timestamptz not null,
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  check (recipient_role = 'admin' or recipient_email is not null)
);
comment on table public.ad_notification_outbox is 'Advertising email outbox. accepted = provider accepted (not delivered, not read); delivered = provider-reported delivery (not read). Admin alerts resolve their recipient from ADS_ADMIN_ALERT_EMAIL at send time.';
create index ad_notification_outbox_due_idx on public.ad_notification_outbox (status, next_attempt_at);

create table public.ad_notification_events (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.ad_notification_outbox(id) on delete restrict,
  event text not null,
  provider_event_id text unique,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null
);
comment on table public.ad_notification_events is 'Append-only history of every outbox transition and provider event (idempotent on provider_event_id).';
create trigger ad_notification_events_immutable before update or delete on public.ad_notification_events
  for each row execute function ads_internal.block_mutation();
create trigger ad_notification_outbox_no_delete before delete on public.ad_notification_outbox
  for each row execute function ads_internal.block_mutation();

create or replace function ads_internal.notify_event(p_outbox uuid, p_event text, p_details jsonb default '{}'::jsonb, p_provider_event text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.ad_notification_events (outbox_id, event, provider_event_id, details, occurred_at)
  values (p_outbox, p_event, p_provider_event, coalesce(p_details, '{}'::jsonb), ads_internal.clock_now())
$$;

create or replace function ads_internal.enqueue_notification(
  p_kind text, p_dedupe text, p_booking uuid, p_request uuid, p_version uuid, p_role text, p_email text, p_payload jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare oid uuid; t timestamptz := ads_internal.clock_now();
begin
  insert into public.ad_notification_outbox (kind, dedupe_key, booking_id, correction_request_id, creative_version_id,
                                             recipient_role, recipient_email, payload, next_attempt_at, created_at)
  values (p_kind, p_dedupe, p_booking, p_request, p_version, p_role, p_email, p_payload, t, t)
  on conflict (dedupe_key) do nothing
  returning id into oid;
  if oid is not null then perform ads_internal.notify_event(oid, 'enqueued', jsonb_build_object('kind', p_kind)); end if;
end; $$;

create or replace function ads_internal.advertiser_email_for_campaign(p_campaign uuid) returns table (booking_id uuid, email text, display_name text)
language sql stable security definer set search_path = '' as $$
  select b.id, a.contact_email, a.display_name
  from public.ad_campaigns c join public.ad_bookings b on b.id = c.booking_id join public.ad_advertisers a on a.id = b.advertiser_id
  where c.id = p_campaign
$$;

-- ── Enqueue triggers (persisted facts only) ─────────────────────────────
create or replace function ads_internal.enqueue_from_deadline() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; vno integer; reasons jsonb;
begin
  select * into r from ads_internal.advertiser_email_for_campaign(new.campaign_id);
  select version_no into vno from public.ad_creative_versions where id = new.creative_version_id;
  if new.kind = 'initial_priority' then
    perform ads_internal.enqueue_notification('initial_priority_admin_alert', 'initial_priority_admin_alert:' || new.id,
      r.booking_id, null, new.creative_version_id, 'admin', null,
      jsonb_build_object('booking_id', r.booking_id, 'advertiser', r.display_name, 'version_no', vno, 'version_id', new.creative_version_id,
                         'starts_at', new.starts_at, 'due_at', new.due_at, 'deadline_kind', new.kind, 'due_inclusive', true));
  elsif new.kind = 'correction_response' then
    select to_jsonb(q.reasons) into reasons from public.ad_correction_requests q where q.id = new.correction_request_id;
    perform ads_internal.enqueue_notification('correction_deadline', 'correction_deadline:' || new.id,
      r.booking_id, new.correction_request_id, new.creative_version_id, 'advertiser', r.email,
      jsonb_build_object('booking_id', r.booking_id, 'advertiser', r.display_name, 'version_no', vno, 'version_id', new.creative_version_id,
                         'request_id', new.correction_request_id, 'reasons', reasons,
                         'notice_delivered_at', new.starts_at, 'response_due_at', new.due_at, 'due_inclusive', true));
  end if;
  return null;
end; $$;
create trigger ad_review_deadlines_enqueue after insert on public.ad_review_deadlines
  for each row execute function ads_internal.enqueue_from_deadline();

create or replace function ads_internal.enqueue_from_correction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; vno integer;
begin
  select * into r from ads_internal.advertiser_email_for_campaign(new.campaign_id);
  select version_no into vno from public.ad_creative_versions where id = new.creative_version_id;
  perform ads_internal.enqueue_notification('correction_request', 'correction_request:' || new.id,
    r.booking_id, new.id, new.creative_version_id, 'advertiser', r.email,
    jsonb_build_object('booking_id', r.booking_id, 'advertiser', r.display_name, 'version_no', vno, 'version_id', new.creative_version_id,
                       'request_id', new.id, 'reasons', to_jsonb(new.reasons), 'requested_at', new.requested_at,
                       'response_rule', '3 UK working hours (09:00-17:00 Mon-Fri, excluding England & Wales bank holidays) from delivery of this notice'));
  return null;
end; $$;
create trigger ad_correction_requests_enqueue after insert on public.ad_correction_requests
  for each row execute function ads_internal.enqueue_from_correction();

create or replace function ads_internal.enqueue_from_review_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; vno integer; reason text; conf public.ad_booking_confirmations;
begin
  if new.event_type not in ('approved', 'rejected') then return null; end if;
  select * into r from ads_internal.advertiser_email_for_campaign(new.campaign_id);
  select version_no, rejection_reason into vno, reason from public.ad_creative_versions where id = new.creative_version_id;
  select * into conf from public.ad_booking_confirmations where booking_id = r.booking_id;
  perform ads_internal.enqueue_notification('review_outcome', 'review_outcome:' || new.id,
    r.booking_id, null, new.creative_version_id, 'advertiser', r.email,
    jsonb_build_object('booking_id', r.booking_id, 'advertiser', r.display_name, 'version_no', vno, 'version_id', new.creative_version_id,
                       'outcome', new.event_type, 'decided_at', new.occurred_at,
                       'reason', case when new.event_type = 'rejected' then reason end,
                       'booked_from', conf.booked_from, 'booked_until', conf.booked_until));
  return null;
end; $$;
create trigger ad_review_events_enqueue after insert on public.ad_review_events
  for each row execute function ads_internal.enqueue_from_review_event();

create or replace function ads_internal.enqueue_from_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.ad_advertisers;
begin
  select ad.* into a from public.ad_bookings b join public.ad_advertisers ad on ad.id = b.advertiser_id where b.id = new.booking_id;
  perform ads_internal.enqueue_notification('booking_confirmation', 'booking_confirmation:' || new.booking_id,
    new.booking_id, null, null, 'advertiser', a.contact_email,
    jsonb_build_object('booking_id', new.booking_id, 'advertiser', a.display_name, 'confirmed_at', new.confirmed_at,
                       'total_pence', new.total_pence, 'placement_pence', new.placement_pence, 'priority_fee_pence', new.priority_fee_pence,
                       'priority_review', new.priority_review, 'currency', new.currency, 'terms_version', new.terms_version,
                       'review_rule', new.review_rule, 'booked_from', new.booked_from, 'booked_until', new.booked_until));
  return null;
end; $$;
create trigger ad_booking_confirmations_enqueue after insert on public.ad_booking_confirmations
  for each row execute function ads_internal.enqueue_from_confirmation();

-- ── Worker (service role): claim -> send -> result ──────────────────────
create or replace function public.ad_notify_claim(p_limit integer, p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t timestamptz := ads_internal.clock_now(); out jsonb := '[]'::jsonb; o public.ad_notification_outbox;
begin
  if not coalesce(ads_internal.setting_bool('ads_email_enabled'), false) then return out; end if;
  if p_limit is null or p_limit not between 1 and 50 or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'ADS_BAD_REQUEST';
  end if;
  for o in select * from public.ad_notification_outbox
            where (status = 'pending' and next_attempt_at <= t) or (status = 'sending' and lease_until < t)
            order by next_attempt_at, created_at limit p_limit for update skip locked loop
    update public.ad_notification_outbox set status = 'sending', attempts = attempts + 1, lease_until = t + make_interval(secs => p_lease_seconds)
     where id = o.id returning * into o;
    perform ads_internal.notify_event(o.id, 'claimed', jsonb_build_object('attempt', o.attempts));
    out := out || jsonb_build_array(jsonb_build_object('id', o.id, 'kind', o.kind, 'attempt', o.attempts, 'recipient_role', o.recipient_role,
             'recipient_email', o.recipient_email, 'payload', o.payload, 'idempotency_key', 'msm-ads-notify-' || o.id));
  end loop;
  return out;
end; $$;

-- Email evidence for a correction notice. If the window was already started
-- by an admin-recorded FALLBACK contact, a later email failure is not a late
-- failure of that notice: it is kept in the outbox history only.
create or replace function ads_internal.email_notice(o public.ad_notification_outbox, p_status text, p_at timestamptz, p_key text, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.ad_correction_requests;
begin
  if o.kind <> 'correction_request' or o.correction_request_id is null then return null; end if;
  select * into r from public.ad_correction_requests where id = o.correction_request_id;
  if p_status <> 'sent' and r.notice_delivered_at is not null and r.notice_channel = 'fallback' then
    return 'fallback_window_unaffected';
  end if;
  return ads_internal.apply_correction_notice(o.correction_request_id, 'email', p_status, p_at, o.provider_message_id, p_key, left(p_note, 500), 'mailer');
end; $$;

create or replace function public.ad_notify_result(p_id uuid, p_attempt integer, p_outcome text, p_provider_message_id text, p_error text)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox; t timestamptz := ads_internal.clock_now(); max_attempts constant integer := 6;
begin
  if p_outcome not in ('accepted', 'retryable_error', 'permanent_error') then raise exception 'ADS_BAD_REQUEST'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status <> 'sending' or o.attempts <> p_attempt then return 'stale'; end if;      -- lease lost / duplicate worker
  if p_outcome = 'accepted' then
    if p_provider_message_id is null or char_length(p_provider_message_id) not between 6 and 200 then raise exception 'ADS_BAD_REQUEST: provider id'; end if;
    update public.ad_notification_outbox set status = 'accepted', provider_message_id = p_provider_message_id, accepted_at = t,
           lease_until = null, last_error = null where id = o.id;
    perform ads_internal.notify_event(o.id, 'accepted', jsonb_build_object('attempt', p_attempt, 'provider_message_id', p_provider_message_id));
    return 'accepted';
  end if;
  if p_outcome = 'retryable_error' and o.attempts < max_attempts then
    update public.ad_notification_outbox set status = 'pending', lease_until = null, last_error = left(p_error, 500),
           next_attempt_at = t + least(interval '6 hours', interval '5 minutes' * power(2, o.attempts - 1)) where id = o.id;
    perform ads_internal.notify_event(o.id, 'send_error_retry', jsonb_build_object('attempt', p_attempt, 'error', left(p_error, 500)));
    return 'retry_scheduled';
  end if;
  update public.ad_notification_outbox set status = case when p_outcome = 'permanent_error' then 'failed' else 'dead' end,
         lease_until = null, last_error = left(p_error, 500), failed_at = t where id = o.id returning * into o;
  perform ads_internal.notify_event(o.id, o.status, jsonb_build_object('attempt', p_attempt, 'error', left(p_error, 500)));
  perform ads_internal.email_notice(o, 'failed', t, 'outbox-failed-' || o.id || '-' || p_attempt, 'Email not sent: ' || coalesce(p_error, ''));
  return o.status;
end; $$;

-- ── Provider delivery events (authenticated webhook, service role) ──────
create or replace function public.ad_notify_provider_event(
  p_provider_event_id text, p_type text, p_message_id text, p_occurred_at timestamptz, p_details jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox; at_ts timestamptz := least(coalesce(p_occurred_at, ads_internal.clock_now()), ads_internal.clock_now());
        v_outcome text; notice text;
begin
  if p_provider_event_id is null or char_length(p_provider_event_id) not between 6 and 200 then raise exception 'ADS_BAD_REQUEST'; end if;
  if exists (select 1 from public.ad_notification_events where provider_event_id = p_provider_event_id) then return 'duplicate'; end if;
  if p_type not in ('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed',
                    'email.suppressed', 'email.complained') then
    return 'ignored_type';                                     -- opened/clicked etc.: never treated as reading
  end if;
  select * into o from public.ad_notification_outbox where provider_message_id = p_message_id for update;
  if not found then raise exception 'ADS_RETRY_LATER: unknown provider message'; end if;   -- result not recorded yet
  if p_type = 'email.delivered' then
    if o.status in ('accepted', 'sending') then
      update public.ad_notification_outbox set status = 'delivered', delivered_at = at_ts where id = o.id;
    end if;
    notice := ads_internal.email_notice(o, 'sent', at_ts, 'resend:' || p_provider_event_id, 'Provider-reported delivery (not proof of reading)');
    v_outcome := 'delivered';
  elsif p_type in ('email.bounced', 'email.failed', 'email.suppressed') then
    update public.ad_notification_outbox set status = case when p_type = 'email.bounced' then 'bounced' else 'failed' end,
           failed_at = at_ts where id = o.id;
    notice := ads_internal.email_notice(o, case when p_type = 'email.bounced' then 'bounced' else 'failed' end, at_ts, 'resend:' || p_provider_event_id, p_type);
    v_outcome := replace(p_type, 'email.', '');
  elsif p_type = 'email.complained' then
    update public.ad_notification_outbox set status = 'complained' where id = o.id;
    v_outcome := 'complained';
  else
    v_outcome := replace(p_type, 'email.', '');                -- sent / delivery_delayed: history only
  end if;
  perform ads_internal.notify_event(o.id, 'provider_' || v_outcome,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('type', p_type, 'occurred_at', at_ts, 'correction_notice', notice), p_provider_event_id);
  return v_outcome || coalesce(':' || notice, '');
end; $$;

-- ── Admin visibility and manual retry / cancel ──────────────────────────
create or replace function public.ad_admin_retry_notification(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status not in ('dead', 'failed') then raise exception 'ADS_INVALID_STATE: only failed or dead notifications can be retried'; end if;
  update public.ad_notification_outbox set status = 'pending', next_attempt_at = ads_internal.clock_now(), last_error = null where id = o.id;
  perform ads_internal.notify_event(o.id, 'admin_retry', jsonb_build_object('note', btrim(p_note), 'by', auth.uid()));
end; $$;

create or replace function public.ad_admin_cancel_notification(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status not in ('pending', 'dead', 'failed') then raise exception 'ADS_INVALID_STATE'; end if;
  update public.ad_notification_outbox set status = 'cancelled' where id = o.id;
  perform ads_internal.notify_event(o.id, 'admin_cancelled', jsonb_build_object('note', btrim(p_note), 'by', auth.uid()));
end; $$;

alter table public.ad_notification_outbox enable row level security;
alter table public.ad_notification_events enable row level security;
create policy ad_notification_outbox_admin on public.ad_notification_outbox for select to authenticated using (public.is_admin_or_above());
create policy ad_notification_events_admin on public.ad_notification_events for select to authenticated using (public.is_admin_or_above());
revoke all on public.ad_notification_outbox, public.ad_notification_events from anon, authenticated, service_role;
grant select on public.ad_notification_outbox, public.ad_notification_events to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname in ('ad_notify_claim', 'ad_notify_result', 'ad_notify_provider_event',
                    'ad_admin_retry_notification', 'ad_admin_cancel_notification'))
              or (n.nspname = 'ads_internal' and p.proname in ('notify_event', 'enqueue_notification', 'advertiser_email_for_campaign',
                    'enqueue_from_deadline', 'enqueue_from_correction', 'enqueue_from_review_event', 'enqueue_from_confirmation', 'email_notice')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
grant execute on function public.ad_notify_claim(integer, integer), public.ad_notify_result(uuid, integer, text, text, text),
  public.ad_notify_provider_event(text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.ad_admin_retry_notification(uuid, text), public.ad_admin_cancel_notification(uuid, text) to authenticated;
