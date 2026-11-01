-- Ads phase 1 -- outbox dispatch safety, amendment notifications and review
-- fixes (forward migration on top of 20261016230000). STATUS: NOT APPLIED to
-- any remote database. Email stays OFF (ads_email_enabled unchanged).
--
-- 1. Dispatch safety (independent review): Resend keeps an Idempotency-Key for
--    24 hours only, so "at most once" holds only inside that window.
--      * First dispatch is durable: before ANY provider call the worker
--        records the exact recipient and a SHA-256 of {from,to,subject,html,
--        text} (ad_notify_begin_dispatch). Later attempts must match exactly
--        (a changed sender/recipient/template/payload cannot silently go out
--        under the old key); payload, recipient and kind are frozen.
--      * Bounded: max 6 attempts, and no provider call later than 23 hours
--        after the first dispatch (1 hour margin under the 24 h retention).
--        Expired leases count as attempts and cannot bypass the cap.
--      * A row that MAY have reached the provider (dispatched, outcome
--        unknown or retryable) and can no longer be retried safely goes to
--        `needs_reconciliation` -- never re-sent blindly. MSM checks the
--        provider dashboard and records confirmed_sent / confirmed_not_sent;
--        only confirmed_not_sent re-queues it, under a NEW idempotency
--        generation. Never dispatched + exhausted = dead (safe to retry).
-- 2. Amendment notifications to the booking OWNER: proposed, accepted,
--    rejected, withdrawn, expired (superseded proposals are covered by the
--    newer proposal's email). Exact persisted intervals; delivery of these
--    emails never changes the amendment or its expiry (the offer expiry is
--    the configured amendment_offer_minutes from proposal time, unchanged).
--    ad_expire_amendments() marks lapsed offers expired (lazy expiry on
--    response still applies).
-- 3. Review fixes: review_outcome email shows the EFFECTIVE (amended) run;
--    amendment start uses the FIRST approval that let the advert serve, not
--    a later replacement approval; advertisers can no longer read internal
--    amendment notes or admin user ids (column privileges).

-- ── 1. Dispatch identity / reconciliation columns ───────────────────────
alter table public.ad_notification_outbox drop constraint ad_notification_outbox_status_check;
alter table public.ad_notification_outbox add constraint ad_notification_outbox_status_check
  check (status in ('pending', 'sending', 'accepted', 'delivered', 'bounced', 'complained', 'failed', 'dead', 'cancelled', 'needs_reconciliation'));
alter table public.ad_notification_outbox drop constraint ad_notification_outbox_kind_check;
alter table public.ad_notification_outbox add constraint ad_notification_outbox_kind_check
  check (kind in ('initial_priority_admin_alert', 'correction_request', 'correction_deadline', 'review_outcome', 'booking_confirmation',
                  'amendment_proposed', 'amendment_accepted', 'amendment_rejected', 'amendment_withdrawn', 'amendment_expired'));
alter table public.ad_notification_outbox add column if not exists amendment_id uuid references public.ad_booking_amendments(id) on delete restrict;
alter table public.ad_notification_outbox add column if not exists dispatch_generation integer not null default 1;
alter table public.ad_notification_outbox add column if not exists first_dispatched_at timestamptz;
alter table public.ad_notification_outbox add column if not exists dispatch_recipient text;
alter table public.ad_notification_outbox add column if not exists dispatch_content_sha256 text;
alter table public.ad_notification_outbox add column if not exists reconciliation_reason text;
comment on column public.ad_notification_outbox.first_dispatched_at is 'Set once per generation, BEFORE the first provider call. After 23 h no further provider call is made (Resend idempotency keys last 24 h).';

create or replace function ads_internal.dispatch_window() returns interval language sql immutable set search_path = '' as $$ select interval '23 hours' $$;
create or replace function ads_internal.max_send_attempts() returns integer language sql immutable set search_path = '' as $$ select 6 $$;

-- Frozen content/recipient; amendment_id may be set once; dispatch identity frozen per generation.
create or replace function ads_internal.guard_outbox_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.kind, new.dedupe_key, new.payload, new.recipient_role, new.recipient_email, new.booking_id, new.correction_request_id,
      new.creative_version_id, new.created_at)
     is distinct from
     (old.kind, old.dedupe_key, old.payload, old.recipient_role, old.recipient_email, old.booking_id, old.correction_request_id,
      old.creative_version_id, old.created_at)
     or (old.amendment_id is not null and new.amendment_id is distinct from old.amendment_id) then
    raise exception 'ADS_IMMUTABLE: notification content and recipient are frozen';
  end if;
  if new.dispatch_generation < old.dispatch_generation then raise exception 'ADS_IMMUTABLE: dispatch generation only increases'; end if;
  if new.dispatch_generation = old.dispatch_generation and old.first_dispatched_at is not null
     and (new.first_dispatched_at, new.dispatch_recipient, new.dispatch_content_sha256)
         is distinct from (old.first_dispatched_at, old.dispatch_recipient, old.dispatch_content_sha256) then
    raise exception 'ADS_IMMUTABLE: first dispatch identity is frozen for this generation';
  end if;
  return new;
end; $$;

create trigger ad_notification_outbox_guard before update on public.ad_notification_outbox
  for each row execute function ads_internal.guard_outbox_update();

create or replace function ads_internal.to_reconciliation(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ad_notification_outbox set status = 'needs_reconciliation', reconciliation_reason = p_reason, lease_until = null where id = p_id;
  perform ads_internal.notify_event(p_id, 'needs_reconciliation', jsonb_build_object('reason', p_reason));
end; $$;

-- Claim: never past the attempt cap or the dispatch window; expired leases count.
create or replace function public.ad_notify_claim(p_limit integer, p_lease_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t timestamptz := ads_internal.clock_now(); out jsonb := '[]'::jsonb; o public.ad_notification_outbox;
begin
  if not coalesce(ads_internal.setting_bool('ads_email_enabled'), false) then return out; end if;
  if p_limit is null or p_limit not between 1 and 50 or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'ADS_BAD_REQUEST';
  end if;
  -- Settle rows that can no longer be dispatched safely.
  for o in select * from public.ad_notification_outbox
            where ((status = 'pending' and next_attempt_at <= t) or (status = 'sending' and lease_until < t))
              and (attempts >= ads_internal.max_send_attempts()
                   or (first_dispatched_at is not null and t >= first_dispatched_at + ads_internal.dispatch_window()))
            for update skip locked loop
    if o.first_dispatched_at is not null then
      perform ads_internal.to_reconciliation(o.id, case when o.attempts >= ads_internal.max_send_attempts()
        then 'attempts exhausted after a dispatch with unknown outcome' else 'provider idempotency window elapsed with unknown outcome' end);
    else
      update public.ad_notification_outbox set status = 'dead', lease_until = null, failed_at = t,
             last_error = coalesce(last_error, 'attempts exhausted before any dispatch') where id = o.id;
      perform ads_internal.notify_event(o.id, 'dead', jsonb_build_object('reason', 'attempts exhausted before any dispatch'));
    end if;
  end loop;
  for o in select * from public.ad_notification_outbox
            where ((status = 'pending' and next_attempt_at <= t) or (status = 'sending' and lease_until < t))
              and attempts < ads_internal.max_send_attempts()
              and (first_dispatched_at is null or t < first_dispatched_at + ads_internal.dispatch_window())
            order by next_attempt_at, created_at limit p_limit for update skip locked loop
    if o.status = 'sending' then perform ads_internal.notify_event(o.id, 'lease_expired', jsonb_build_object('attempt', o.attempts)); end if;
    update public.ad_notification_outbox set status = 'sending', attempts = attempts + 1, lease_until = t + make_interval(secs => p_lease_seconds)
     where id = o.id returning * into o;
    perform ads_internal.notify_event(o.id, 'claimed', jsonb_build_object('attempt', o.attempts, 'generation', o.dispatch_generation));
    out := out || jsonb_build_array(jsonb_build_object('id', o.id, 'kind', o.kind, 'attempt', o.attempts, 'recipient_role', o.recipient_role,
             'recipient_email', o.recipient_email, 'payload', o.payload,
             'dispatch_recipient', o.dispatch_recipient, 'dispatch_content_sha256', o.dispatch_content_sha256,
             'idempotency_key', 'msm-ads-notify-' || o.id || '-g' || o.dispatch_generation));
  end loop;
  return out;
end; $$;

-- Must be called (and return 'proceed') immediately before every provider call.
create or replace function public.ad_notify_begin_dispatch(p_id uuid, p_attempt integer, p_recipient text, p_content_sha256 text) returns text
language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox; t timestamptz := ads_internal.clock_now();
begin
  if p_recipient is null or char_length(p_recipient) not between 3 and 254 or p_content_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'ADS_BAD_REQUEST'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status <> 'sending' or o.attempts <> p_attempt or o.lease_until is null or o.lease_until <= t then return 'stale'; end if;
  if o.first_dispatched_at is null then
    update public.ad_notification_outbox set first_dispatched_at = t, dispatch_recipient = p_recipient, dispatch_content_sha256 = p_content_sha256 where id = o.id;
    perform ads_internal.notify_event(o.id, 'dispatch_started', jsonb_build_object('attempt', p_attempt, 'generation', o.dispatch_generation, 'sha256', p_content_sha256));
    return 'proceed';
  end if;
  if o.dispatch_recipient is distinct from p_recipient or o.dispatch_content_sha256 is distinct from p_content_sha256 then
    perform ads_internal.to_reconciliation(o.id, 'recipient or content changed after the first dispatch');
    return 'blocked';
  end if;
  if t >= o.first_dispatched_at + ads_internal.dispatch_window() then
    perform ads_internal.to_reconciliation(o.id, 'provider idempotency window elapsed with unknown outcome');
    return 'blocked';
  end if;
  perform ads_internal.notify_event(o.id, 'dispatch_retry', jsonb_build_object('attempt', p_attempt, 'generation', o.dispatch_generation));
  return 'proceed';
end; $$;

create or replace function public.ad_notify_result(p_id uuid, p_attempt integer, p_outcome text, p_provider_message_id text, p_error text)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox; t timestamptz := ads_internal.clock_now();
begin
  if p_outcome not in ('accepted', 'retryable_error', 'permanent_error') then raise exception 'ADS_BAD_REQUEST'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status <> 'sending' or o.attempts <> p_attempt then return 'stale'; end if;
  if p_outcome = 'accepted' then
    if o.first_dispatched_at is null then raise exception 'ADS_BAD_REQUEST: accepted without a recorded dispatch'; end if;
    if p_provider_message_id is null or char_length(p_provider_message_id) not between 6 and 200 then raise exception 'ADS_BAD_REQUEST: provider id'; end if;
    update public.ad_notification_outbox set status = 'accepted', provider_message_id = p_provider_message_id, accepted_at = t,
           lease_until = null, last_error = null where id = o.id;
    perform ads_internal.notify_event(o.id, 'accepted', jsonb_build_object('attempt', p_attempt, 'provider_message_id', p_provider_message_id));
    return 'accepted';
  end if;
  if p_outcome = 'retryable_error' then
    if o.attempts < ads_internal.max_send_attempts()
       and (o.first_dispatched_at is null or t + interval '5 minutes' * power(2, o.attempts - 1) < o.first_dispatched_at + ads_internal.dispatch_window()) then
      update public.ad_notification_outbox set status = 'pending', lease_until = null, last_error = left(p_error, 500),
             next_attempt_at = t + least(interval '6 hours', interval '5 minutes' * power(2, o.attempts - 1)) where id = o.id;
      perform ads_internal.notify_event(o.id, 'send_error_retry', jsonb_build_object('attempt', p_attempt, 'error', left(p_error, 500)));
      return 'retry_scheduled';
    end if;
    update public.ad_notification_outbox set last_error = left(p_error, 500) where id = o.id;
    if o.first_dispatched_at is not null then
      perform ads_internal.to_reconciliation(o.id, 'retries exhausted after a dispatch with unknown outcome');
      return 'needs_reconciliation';
    end if;
  end if;
  update public.ad_notification_outbox set status = case when p_outcome = 'permanent_error' then 'failed' else 'dead' end,
         lease_until = null, last_error = left(p_error, 500), failed_at = t where id = o.id returning * into o;
  perform ads_internal.notify_event(o.id, o.status, jsonb_build_object('attempt', p_attempt, 'error', left(p_error, 500)));
  perform ads_internal.email_notice(o, 'failed', t, 'outbox-failed-' || o.id || '-' || o.dispatch_generation || '-' || p_attempt, 'Email not sent: ' || coalesce(p_error, ''));
  return o.status;
end; $$;

-- Admin retry only where a re-send cannot duplicate: never dispatched, or a
-- provider-rejected (failed) send still inside the window. Anything that may
-- have been delivered goes through reconciliation instead.
create or replace function public.ad_admin_retry_notification(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox; t timestamptz := ads_internal.clock_now();
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status not in ('dead', 'failed') then raise exception 'ADS_INVALID_STATE: only failed or dead notifications can be retried'; end if;
  if o.first_dispatched_at is not null and (o.status = 'dead' or t >= o.first_dispatched_at + ads_internal.dispatch_window()) then
    raise exception 'ADS_RECONCILE_FIRST: this email may already have been sent; check the provider and use reconciliation';
  end if;
  update public.ad_notification_outbox set status = 'pending', next_attempt_at = t, last_error = null, attempts = 0 where id = o.id;
  perform ads_internal.notify_event(o.id, 'admin_retry', jsonb_build_object('note', btrim(p_note), 'by', auth.uid()));
end; $$;

create or replace function public.ad_admin_reconcile_notification(p_id uuid, p_resolution text, p_provider_message_id text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox; t timestamptz := ads_internal.clock_now();
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_resolution not in ('confirmed_sent', 'confirmed_not_sent') then raise exception 'ADS_BAD_REQUEST'; end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then raise exception 'ADS_REASON_REQUIRED: say what was checked in the provider dashboard'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status <> 'needs_reconciliation' then raise exception 'ADS_INVALID_STATE'; end if;
  if p_resolution = 'confirmed_sent' then
    if p_provider_message_id is not null and char_length(p_provider_message_id) not between 6 and 200 then raise exception 'ADS_BAD_REQUEST: provider id'; end if;
    update public.ad_notification_outbox set status = 'accepted', accepted_at = t, provider_message_id = coalesce(p_provider_message_id, provider_message_id),
           reconciliation_reason = null where id = o.id;
  else
    update public.ad_notification_outbox set status = 'pending', next_attempt_at = t, attempts = 0, dispatch_generation = dispatch_generation + 1,
           first_dispatched_at = null, dispatch_recipient = null, dispatch_content_sha256 = null, reconciliation_reason = null, last_error = null
     where id = o.id;
  end if;
  perform ads_internal.notify_event(o.id, 'reconciled_' || p_resolution,
    jsonb_build_object('note', btrim(p_note), 'by', auth.uid(), 'provider_message_id', p_provider_message_id, 'previous_generation', o.dispatch_generation));
end; $$;

create or replace function public.ad_admin_cancel_notification(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.ad_notification_outbox;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into o from public.ad_notification_outbox where id = p_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if o.status not in ('pending', 'dead', 'failed', 'needs_reconciliation') then raise exception 'ADS_INVALID_STATE'; end if;
  update public.ad_notification_outbox set status = 'cancelled' where id = o.id;
  perform ads_internal.notify_event(o.id, 'admin_cancelled', jsonb_build_object('note', btrim(p_note), 'by', auth.uid(), 'from_status', o.status));
end; $$;

-- ── 2. Amendment notifications (owner recipient) ────────────────────────
create or replace function ads_internal.enqueue_from_amendment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare adv public.ad_advertisers; k text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' then return null; end if;
    k := 'amendment_proposed';
  elsif old.status = 'proposed' and new.status in ('accepted', 'rejected', 'withdrawn', 'expired') then
    k := 'amendment_' || new.status;
  else
    return null;                                  -- superseded: the newer proposal's email covers it
  end if;
  select a.* into adv from public.ad_bookings b join public.ad_advertisers a on a.id = b.advertiser_id where b.id = new.booking_id;
  perform ads_internal.enqueue_notification(k, k || ':' || new.id, new.booking_id, null, null, 'advertiser', adv.contact_email,
    jsonb_build_object('booking_id', new.booking_id, 'amendment_id', new.id, 'advertiser', adv.display_name, 'status', new.status,
                       'original_from', new.original_from, 'original_until', new.original_until,
                       'proposed_from', new.proposed_from, 'proposed_until', new.proposed_until,
                       'purchased_seconds', new.purchased_seconds, 'preserves_duration', new.preserves_duration,
                       'shortened_seconds', new.shortened_seconds, 'proposed_at', new.proposed_at,
                       'expires_at', new.expires_at, 'decided_at', new.decided_at));
  update public.ad_notification_outbox set amendment_id = new.id where dedupe_key = k || ':' || new.id and amendment_id is null;
  return null;
end; $$;
create trigger ad_booking_amendments_enqueue after insert or update of status on public.ad_booking_amendments
  for each row execute function ads_internal.enqueue_from_amendment();

create or replace function public.ad_expire_amendments() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; t timestamptz := ads_internal.clock_now();
begin
  if auth.role() is distinct from 'service_role' and not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  with x as (update public.ad_booking_amendments set status = 'expired', decided_at = t
             where status = 'proposed' and expires_at <= t returning id)
  select count(*) into n from x;
  return n;
end; $$;

-- ── 3a. review_outcome email: effective (possibly amended) run ──────────
create or replace function ads_internal.enqueue_from_review_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; vno integer; reason text; eff tstzrange;
begin
  if new.event_type not in ('approved', 'rejected') then return null; end if;
  select * into r from ads_internal.advertiser_email_for_campaign(new.campaign_id);
  select version_no, rejection_reason into vno, reason from public.ad_creative_versions where id = new.creative_version_id;
  eff := ads_internal.effective_range(r.booking_id);
  perform ads_internal.enqueue_notification('review_outcome', 'review_outcome:' || new.id,
    r.booking_id, null, new.creative_version_id, 'advertiser', r.email,
    jsonb_build_object('booking_id', r.booking_id, 'advertiser', r.display_name, 'version_no', vno, 'version_id', new.creative_version_id,
                       'outcome', new.event_type, 'decided_at', new.occurred_at,
                       'reason', case when new.event_type = 'rejected' then reason end,
                       'booked_from', lower(eff), 'booked_until', upper(eff)));
  return null;
end; $$;

-- ── 3b. Amendment start: FIRST approval that let the advert serve ──────
create or replace function ads_internal.first_approval_at(p_campaign uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select min(occurred_at) from public.ad_review_events where campaign_id = p_campaign and event_type = 'approved'
$$;

create or replace function public.ad_admin_propose_amendment(p_booking_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.ad_bookings; c public.ad_campaigns; v public.ad_creative_versions;
  t timestamptz := ads_internal.clock_now();
  eff tstzrange; orig tstzrange; units uuid[];
  approved_at timestamptz; v_start timestamptz; v_end timestamptz; dur interval; purchased bigint;
  offer integer; following uuid; aid uuid; cap timestamptz;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if not coalesce(ads_internal.setting_bool('ads_amendments_enabled'), false) then raise exception 'ADS_AMENDMENTS_DISABLED'; end if;
  offer := ads_internal.setting_int('amendment_offer_minutes');
  if offer is null or offer not between 15 and 10080 then
    raise exception 'ADS_POLICY_GATE: amendment offer expiry is not decided (set amendment_offer_minutes after approval)';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if b.status <> 'confirmed' or not ads_internal.booking_funded(b.id) then raise exception 'ADS_INVALID_STATE: only paid, funded bookings'; end if;
  select * into c from public.ad_campaigns where booking_id = b.id;
  select * into v from public.ad_creative_versions where id = c.approved_version_id;
  if v.id is null then raise exception 'ADS_INVALID_STATE: no approved version yet (propose after approval)'; end if;
  approved_at := coalesce(ads_internal.first_approval_at(c.id), v.reviewed_at);   -- first approval that let it serve
  eff := ads_internal.effective_range(b.id);
  orig := ads_internal.original_range(b.id);
  if approved_at <= lower(eff) then raise exception 'ADS_NO_AMENDMENT_NEEDED: approved before the run started'; end if;
  units := ads_internal.lock_units(ads_internal.booking_units(b.id));
  purchased := extract(epoch from upper(orig) - lower(orig))::bigint;
  dur := make_interval(secs => purchased);
  v_start := date_trunc('hour', approved_at) + interval '1 hour';          -- strictly after; whole UK hour
  v_end := v_start + dur;
  -- Never displace another active booking: shrink to the boundary.
  while v_end > v_start and ads_internal.interval_conflicts(units, tstzrange(v_start, v_end, '[)'), b.id) loop
    select max(lower(ads_internal.effective_range(d.booking_id))) into cap
      from public.ad_booking_inventory_days d
     where d.unit_id = any(units) and d.booking_id <> b.id and ads_internal.occupying(d.booking_id)
       and ads_internal.effective_range(d.booking_id) && tstzrange(v_start, v_end, '[)')
       and lower(ads_internal.effective_range(d.booking_id)) < v_end;
    if cap is null or cap <= v_start then v_end := v_start; else v_end := cap; end if;
  end loop;
  if v_end <= v_start or v_end <= t then
    raise exception 'ADS_NO_CAPACITY: no positive, unexpired run is possible after %', v_start;
  end if;
  if v_end < v_start + dur then
    select d.booking_id into following from public.ad_booking_inventory_days d
     where d.unit_id = any(units) and d.booking_id <> b.id and ads_internal.occupying(d.booking_id)
       and lower(ads_internal.effective_range(d.booking_id)) = v_end limit 1;
  end if;
  update public.ad_booking_amendments set status = 'superseded', decided_at = t, decided_by = auth.uid()
   where booking_id = b.id and status = 'proposed';
  insert into public.ad_booking_amendments (booking_id, reason, approved_version_id, approved_at, original_from, original_until,
    proposed_from, proposed_until, purchased_seconds, preserves_duration, shortened_seconds, following_booking_id, basis,
    status, note, proposed_by, proposed_at, expires_at)
  values (b.id, 'correction_delay', v.id, approved_at, lower(eff), upper(eff), v_start, v_end, purchased,
    v_end = v_start + dur, extract(epoch from (v_start + dur) - v_end)::bigint, following,
    jsonb_build_object('start_rule', 'next_whole_uk_hour_strictly_after_approval', 'duration_basis', 'original_purchased_elapsed_seconds',
                       'policy_status', 'PROVISIONAL: exact-hour rounding and DST handling are review gates', 'capacity_held', false,
                       'offer_minutes', offer),
    'proposed', btrim(p_note), auth.uid(), t, t + make_interval(mins => offer))
  returning id into aid;
  perform ads_internal.audit('admin', 'booking', b.id, 'amendment_proposed',
    jsonb_build_object('amendment_id', aid, 'from', v_start, 'until', v_end, 'shortened_seconds', extract(epoch from (v_start + dur) - v_end)));
  return aid;
end; $$;

-- ── 3c. Advertisers must not read internal notes or admin user ids ─────
revoke select on public.ad_booking_amendments, public.ad_booking_interval_history from authenticated;
grant select (id, booking_id, reason, approved_version_id, approved_at, original_from, original_until, proposed_from, proposed_until,
  purchased_seconds, preserves_duration, shortened_seconds, following_booking_id, basis, status, proposed_at, expires_at, decided_at)
  on public.ad_booking_amendments to authenticated;
grant select (id, booking_id, amendment_id, kind, serve_from, serve_until, recorded_at) on public.ad_booking_interval_history to authenticated;

create or replace function public.ad_admin_list_amendments(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_admin_or_above() then coalesce((select jsonb_agg(to_jsonb(a) order by a.proposed_at desc)
    from public.ad_booking_amendments a where a.booking_id = p_booking_id), '[]'::jsonb) end
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname in ('ad_notify_claim', 'ad_notify_begin_dispatch', 'ad_notify_result',
                    'ad_admin_retry_notification', 'ad_admin_reconcile_notification', 'ad_admin_cancel_notification',
                    'ad_expire_amendments', 'ad_admin_propose_amendment', 'ad_admin_list_amendments'))
              or (n.nspname = 'ads_internal' and p.proname in ('dispatch_window', 'max_send_attempts', 'guard_outbox_update', 'to_reconciliation',
                    'enqueue_from_amendment', 'enqueue_from_review_event', 'first_approval_at')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
grant execute on function public.ad_notify_claim(integer, integer), public.ad_notify_begin_dispatch(uuid, integer, text, text),
  public.ad_notify_result(uuid, integer, text, text, text), public.ad_expire_amendments() to service_role;
grant execute on function public.ad_admin_retry_notification(uuid, text), public.ad_admin_reconcile_notification(uuid, text, text, text),
  public.ad_admin_cancel_notification(uuid, text), public.ad_expire_amendments(), public.ad_admin_propose_amendment(uuid, text),
  public.ad_admin_list_amendments(uuid) to authenticated;
