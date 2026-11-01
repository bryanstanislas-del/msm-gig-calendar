-- Ads phase 1 -- review, corrections and optional priority review (agreed
-- terms 2026-10-16). STATUS: NOT APPLIED to any remote database. Additive
-- forward migration on top of 20261015120000 + 20261016090000. All switches
-- stay OFF (priority cover included).
--
-- Agreed rules implemented here (mirrored in src/ads/ukWorkingTime.js):
--  * The initial review clock starts once payment has CLEARED (booking
--    confirmed by a verified webhook) AND a complete creative version
--    (artwork + link + info) exists -- whichever happens last.
--  * Standard initial review: by 23:59:59 Europe/London on the next Mon-Fri
--    working day excl. England & Wales bank holidays (exclusive instant).
--  * Priority initial review (optional GBP 150, actively selected at hold,
--    only while MSM enables cover): within 12 ELAPSED hours.
--  * A review is an approval, a reasoned rejection, or a necessary
--    correction request. A holding acknowledgement never counts. A
--    correction request caused by MSM's own error is not a review outcome
--    and never counts as advertiser delay.
--  * Correction requests give reasons, the exact version and (once notice is
--    delivered) the response deadline: THREE WORKING HOURS (09:00-17:00
--    London Mon-Fri excl. E&W bank holidays) from successful delivery. A
--    known failed notice starts nothing. A late bounce after the window
--    started is recorded as an exception for MSM to decide (gate).
--  * Timely complete priority corrections: new review within 3 working
--    hours of receipt. Late priority and all standard corrections: end of
--    the next working day after receipt. No fee is charged again; nothing
--    is added for a missed response deadline.
--  * Creative versions stay immutable; any destination change is a new
--    version that needs review.
--
-- Explicit GATES (not invented here): whether an earlier approved creative
-- keeps running while a replacement/correction is reviewed (current
-- behaviour: it keeps serving); review duration for VOLUNTARY replacements
-- (provisionally the standard window, kind 'replacement_review_provisional');
-- what a late bounce does to an already-started window; whether an
-- in-account notice alone (without email) may start the response window
-- (not counted today).

-- ── Test-only clock (never used by API traffic) ─────────────────────────
-- API requests reach Postgres as session_user 'authenticator' (Supabase),
-- for which this always returns now(). Local tests (session_user postgres)
-- may set ads.test_now to drive deterministic deadlines.
create or replace function ads_internal.clock_now() returns timestamptz
language sql stable set search_path = '' as $$
  select case
    when session_user::text <> 'authenticator' and nullif(current_setting('ads.test_now', true), '') is not null
      then current_setting('ads.test_now', true)::timestamptz
    else now() end
$$;

-- ── England & Wales bank holidays 2028 (maintain annually from gov.uk) ──
insert into public.ad_uk_holidays (holiday_date, name) values
  ('2028-01-03', 'New Year''s Day (substitute day)'), ('2028-04-14', 'Good Friday'), ('2028-04-17', 'Easter Monday'),
  ('2028-05-01', 'Early May bank holiday'), ('2028-05-29', 'Spring bank holiday'), ('2028-08-28', 'Summer bank holiday'),
  ('2028-12-25', 'Christmas Day'), ('2028-12-26', 'Boxing Day')
on conflict (holiday_date) do nothing;

-- ── Working-hours clock ─────────────────────────────────────────────────
create or replace function ads_internal.add_uk_working_hours(p_from timestamptz, p_hours numeric)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  remaining interval := make_interval(secs => p_hours * 3600);
  cursor_at timestamptz := p_from;
  d date;
  open_at timestamptz;
  close_at timestamptz;
  guard integer := 0;
begin
  if p_hours is null or p_hours <= 0 then return p_from; end if;
  loop
    guard := guard + 1;
    if guard > 4000 then raise exception 'ADS_CLOCK: no working time found (holiday table?)'; end if;
    d := (cursor_at at time zone 'Europe/London')::date;
    open_at := (d + time '09:00') at time zone 'Europe/London';
    close_at := (d + time '17:00') at time zone 'Europe/London';
    if not ads_internal.is_working_day(d) or cursor_at >= close_at then
      cursor_at := (ads_internal.next_working_day_after(d) + time '09:00') at time zone 'Europe/London';
      continue;
    end if;
    if cursor_at < open_at then cursor_at := open_at; end if;
    if remaining <= (close_at - cursor_at) then return cursor_at + remaining; end if;
    remaining := remaining - (close_at - cursor_at);
    cursor_at := (ads_internal.next_working_day_after(d) + time '09:00') at time zone 'Europe/London';
  end loop;
end; $$;

-- ── Settings ────────────────────────────────────────────────────────────
alter table public.ad_settings add column if not exists text_value text;
insert into public.ad_settings (key, bool_value, int_value, text_value, description) values
  ('priority_fee_pence', null, 15000, null, 'Priority initial review fee in pence (agreed GBP 150). Charged once; never again for corrections.'),
  ('order_terms_version', null, null, 'DRAFT-NOT-APPROVED-2026-10-16',
   'Version label of the order terms recorded with every booking. DRAFT: the legal terms are not final and must not be published as final.')
on conflict (key) do nothing;
update public.ad_settings
   set description = 'Priority initial review cover (12 elapsed hours, fee priority_fee_pence). OFF until MSM confirms cover is staffed.'
 where key = 'ads_priority_review_enabled';

create or replace function public.ad_admin_set_setting(p_key text, p_bool boolean default null, p_int integer default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_key in ('ads_venue_gig_targeting_enabled', 'stripe_livemode') and coalesce(p_bool, false) then
    raise exception 'ADS_NOT_AVAILABLE_IN_PHASE_1: % cannot be enabled', p_key;
  end if;
  if p_key in ('hold_minutes') and (p_int is null or p_int not between 35 and 1440) then raise exception 'ADS_BAD_SETTING'; end if;
  if p_key in ('min_lead_days', 'max_advance_days', 'max_active_holds_per_advertiser') and (p_int is null or p_int not between 0 and 730) then
    raise exception 'ADS_BAD_SETTING';
  end if;
  if p_key = 'priority_fee_pence' and (p_int is null or p_int not between 0 and 100000) then raise exception 'ADS_BAD_SETTING'; end if;
  update public.ad_settings set bool_value = coalesce(p_bool, bool_value), int_value = coalesce(p_int, int_value),
    updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  perform ads_internal.audit('admin', 'setting', null, 'setting_changed', jsonb_build_object('key', p_key, 'bool', p_bool, 'int', p_int));
end; $$;

-- ── Booking / snapshot columns ──────────────────────────────────────────
alter table public.ad_bookings add column if not exists priority_review boolean not null default false;
alter table public.ad_purchase_snapshots drop constraint if exists ad_purchase_snapshots_priority_fee_pence_check;
alter table public.ad_purchase_snapshots add constraint ad_purchase_snapshots_priority_fee_pence_check check (priority_fee_pence >= 0);
alter table public.ad_purchase_snapshots add column if not exists priority_review boolean not null default false;
alter table public.ad_purchase_snapshots add column if not exists terms_version text;
alter table public.ad_purchase_snapshots add column if not exists placement_pence integer;
comment on column public.ad_purchase_snapshots.placement_pence is 'Placement charge excluding the priority fee (total_pence = placement_pence + priority_fee_pence). Null for rows created before 20261016120000 (then placement = total).';

-- ── Status values ───────────────────────────────────────────────────────
alter table public.ad_creative_versions drop constraint ad_creative_versions_status_check;
alter table public.ad_creative_versions add constraint ad_creative_versions_status_check
  check (status in ('submitted', 'approved', 'rejected', 'superseded', 'correction_requested'));
alter table public.ad_campaigns drop constraint ad_campaigns_review_status_check;
alter table public.ad_campaigns add constraint ad_campaigns_review_status_check
  check (review_status in ('awaiting_creative', 'awaiting_payment', 'under_review', 'approved', 'rejected', 'correction_requested'));

-- ── Correction requests, notices, deadlines, events, confirmations ─────
create table public.ad_correction_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete restrict,
  creative_version_id uuid not null references public.ad_creative_versions(id) on delete restrict,
  cause text not null check (cause in ('advertiser_material', 'msm_error')),
  reasons text[] not null check (cardinality(reasons) between 1 and 20),
  requested_at timestamptz not null,
  requested_by uuid,
  status text not null default 'awaiting_notice' check (status in ('awaiting_notice', 'awaiting_response', 'responded', 'withdrawn')),
  notice_delivered_at timestamptz,
  notice_channel text,
  notice_exception boolean not null default false,
  response_due_at timestamptz,
  response_version_id uuid references public.ad_creative_versions(id),
  responded_at timestamptz,
  timely boolean
);
comment on table public.ad_correction_requests is 'Necessary correction requests for one exact creative version. Response window = 3 UK working hours from SUCCESSFUL notice delivery (null until then). cause = msm_error never counts as advertiser delay or as a review outcome.';
create index ad_correction_requests_campaign_idx on public.ad_correction_requests (campaign_id, requested_at);

alter table public.ad_creative_versions add column if not exists correction_request_id uuid references public.ad_correction_requests(id);

create table public.ad_correction_notices (
  id uuid primary key default gen_random_uuid(),
  correction_request_id uuid not null references public.ad_correction_requests(id) on delete restrict,
  channel text not null check (channel in ('email', 'fallback')),
  status text not null check (status in ('sent', 'failed', 'bounced')),
  occurred_at timestamptz not null,
  provider_message_id text,
  idempotency_key text not null unique,
  note text,
  recorded_at timestamptz not null default now(),
  outcome text not null
);
comment on table public.ad_correction_notices is 'Append-only delivery evidence for correction notices (email provider events or admin-recorded fallback contact). Idempotent on idempotency_key.';

create table public.ad_review_deadlines (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete restrict,
  creative_version_id uuid references public.ad_creative_versions(id),
  correction_request_id uuid references public.ad_correction_requests(id),
  kind text not null check (kind in ('initial_standard', 'initial_priority', 'correction_response',
                                     'correction_review_priority', 'correction_review_standard', 'replacement_review_provisional')),
  starts_at timestamptz not null,
  due_at timestamptz not null,
  basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (due_at >= starts_at)
);
comment on table public.ad_review_deadlines is 'Immutable record of every review/response deadline as computed when it started (due_at exclusive for end-of-day rules).';
create index ad_review_deadlines_campaign_idx on public.ad_review_deadlines (campaign_id, created_at);

create table public.ad_review_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete restrict,
  creative_version_id uuid references public.ad_creative_versions(id),
  correction_request_id uuid references public.ad_correction_requests(id),
  event_type text not null,
  occurred_at timestamptz not null,
  actor_kind text not null check (actor_kind in ('advertiser', 'admin', 'system', 'stripe', 'mailer')),
  actor_user_id uuid,
  details jsonb not null default '{}'::jsonb
);
create index ad_review_events_campaign_idx on public.ad_review_events (campaign_id, occurred_at);

create table public.ad_booking_confirmations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.ad_bookings(id) on delete restrict,
  confirmed_at timestamptz not null,
  total_pence integer not null,
  placement_pence integer not null,
  priority_fee_pence integer not null,
  priority_review boolean not null,
  currency text not null,
  terms_version text,
  review_rule text not null,
  booked_from timestamptz not null,
  booked_until timestamptz not null
);
comment on table public.ad_booking_confirmations is 'Durable order confirmation written once when payment is verified: price split, priority choice, review rule and terms version. booked_until is exclusive.';

create trigger ad_correction_notices_immutable before update or delete on public.ad_correction_notices
  for each row execute function ads_internal.block_mutation();
create trigger ad_review_deadlines_immutable before update or delete on public.ad_review_deadlines
  for each row execute function ads_internal.block_mutation();
create trigger ad_review_events_immutable before update or delete on public.ad_review_events
  for each row execute function ads_internal.block_mutation();
create trigger ad_booking_confirmations_immutable before update or delete on public.ad_booking_confirmations
  for each row execute function ads_internal.block_mutation();
create trigger ad_correction_requests_no_delete before delete on public.ad_correction_requests
  for each row execute function ads_internal.block_mutation();

create or replace function ads_internal.guard_version_correction_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.correction_request_id is distinct from old.correction_request_id then
    raise exception 'ADS_IMMUTABLE: a version''s correction link cannot change';
  end if;
  return new;
end; $$;
create trigger ad_creative_versions_correction_link_immutable before update on public.ad_creative_versions
  for each row execute function ads_internal.guard_version_correction_link();

create or replace function ads_internal.review_event(
  p_campaign uuid, p_version uuid, p_request uuid, p_type text, p_actor_kind text, p_details jsonb default '{}'::jsonb, p_at timestamptz default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.ad_review_events (campaign_id, creative_version_id, correction_request_id, event_type, occurred_at, actor_kind, actor_user_id, details)
  values (p_campaign, p_version, p_request, p_type, coalesce(p_at, ads_internal.clock_now()), p_actor_kind, auth.uid(), coalesce(p_details, '{}'::jsonb));
$$;

-- A new version submitted while a correction request is open answers it.
-- BEFORE INSERT links the version; AFTER INSERT (row exists, FK valid)
-- records the response -- both before the review clock is computed.
create or replace function ads_internal.link_correction_response() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  select id into rid from public.ad_correction_requests
   where campaign_id = new.campaign_id and status in ('awaiting_notice', 'awaiting_response')
   order by requested_at desc limit 1;
  if rid is not null then new.correction_request_id := rid; end if;
  return new;
end; $$;
create trigger ad_creative_versions_link_correction before insert on public.ad_creative_versions
  for each row execute function ads_internal.link_correction_response();

create or replace function ads_internal.record_correction_response() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.ad_correction_requests; v_timely boolean;
begin
  if new.correction_request_id is null then return null; end if;
  select * into r from public.ad_correction_requests where id = new.correction_request_id for update;
  -- A window that never started (notice not delivered) cannot be missed.
  v_timely := r.response_due_at is null or new.submitted_at <= r.response_due_at;
  update public.ad_correction_requests
     set status = 'responded', responded_at = new.submitted_at, response_version_id = new.id, timely = v_timely
   where id = r.id;
  perform ads_internal.review_event(new.campaign_id, new.id, r.id, 'correction_received', 'advertiser',
    jsonb_build_object('timely', v_timely, 'response_due_at', r.response_due_at), new.submitted_at);
  return null;
end; $$;
create trigger ad_creative_versions_record_correction after insert on public.ad_creative_versions
  for each row execute function ads_internal.record_correction_response();

-- Versions get their submission time from the (test-injectable) clock.
alter table public.ad_creative_versions alter column submitted_at set default ads_internal.clock_now();

-- ── Review clock (replaces the earlier version) ─────────────────────────
create or replace function ads_internal.refresh_review_state(p_campaign_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.ad_campaigns;
  b public.ad_bookings;
  v public.ad_creative_versions;
  r public.ad_correction_requests;
  new_status text;
  t timestamptz := ads_internal.clock_now();
  v_kind text;
  v_due timestamptz;
  had_outcome boolean;
begin
  select * into c from public.ad_campaigns where id = p_campaign_id for update;
  select * into b from public.ad_bookings where id = c.booking_id;
  if c.current_version_id is null then
    new_status := 'awaiting_creative';
  else
    select * into v from public.ad_creative_versions where id = c.current_version_id;
    if v.status = 'approved' then new_status := 'approved';
    elsif v.status = 'rejected' then new_status := 'rejected';
    elsif v.status = 'correction_requested' then new_status := 'correction_requested';
    elsif b.status = 'confirmed' then
      new_status := 'under_review';
      if v.review_clock_started_at is null then
        -- Clock starts now: payment cleared AND complete material, whichever was last.
        had_outcome := exists (select 1 from public.ad_creative_versions x
                               where x.campaign_id = c.id and x.id <> v.id and x.reviewed_at is not null)
                    or exists (select 1 from public.ad_correction_requests q where q.campaign_id = c.id);
        if v.correction_request_id is not null then
          select * into r from public.ad_correction_requests where id = v.correction_request_id;
          if b.priority_review and r.timely then
            v_kind := 'correction_review_priority'; v_due := ads_internal.add_uk_working_hours(t, 3);
          else
            v_kind := 'correction_review_standard'; v_due := ads_internal.review_due_before(t);
          end if;
        elsif not had_outcome then
          if b.priority_review then v_kind := 'initial_priority'; v_due := t + interval '12 hours';
          else v_kind := 'initial_standard'; v_due := ads_internal.review_due_before(t); end if;
        else
          v_kind := 'replacement_review_provisional'; v_due := ads_internal.review_due_before(t); -- GATE: duration undecided
        end if;
        update public.ad_creative_versions set review_clock_started_at = t, review_due_before = v_due where id = v.id;
        insert into public.ad_review_deadlines (campaign_id, creative_version_id, correction_request_id, kind, starts_at, due_at, basis)
        values (c.id, v.id, v.correction_request_id, v_kind, t, v_due,
                jsonb_build_object('payment_cleared_at', b.confirmed_at, 'material_complete_at', v.submitted_at, 'priority', b.priority_review));
        perform ads_internal.review_event(c.id, v.id, v.correction_request_id, 'review_clock_started', 'system',
          jsonb_build_object('kind', v_kind, 'due_at', v_due), t);
      end if;
    else
      new_status := 'awaiting_payment';
    end if;
  end if;
  if new_status is distinct from c.review_status then
    update public.ad_campaigns set review_status = new_status where id = c.id;
  end if;
end; $$;

-- ── Admin review: approve / reasoned reject (replaces earlier version) ──
create or replace function public.ad_admin_review(p_version_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.ad_creative_versions;
  c public.ad_campaigns;
  b public.ad_bookings;
  t timestamptz := ads_internal.clock_now();
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'ADS_BAD_DECISION'; end if;
  select * into v from public.ad_creative_versions where id = p_version_id;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  select * into c from public.ad_campaigns where id = v.campaign_id for update;
  select * into b from public.ad_bookings where id = c.booking_id;
  if c.current_version_id is distinct from v.id or v.status <> 'submitted' then
    raise exception 'ADS_STALE_VERSION: only the latest submitted version can be reviewed';
  end if;
  if p_decision = 'approve' then
    if b.status <> 'confirmed' then raise exception 'ADS_NOT_PAID: booking must be paid and confirmed before approval'; end if;
    if not ads_internal.booking_funded(b.id) then
      raise exception 'ADS_NOT_FUNDED: the payment funding this booking has been (partly) refunded';
    end if;
    update public.ad_creative_versions set status = 'superseded' where id = c.approved_version_id and id <> v.id;
    update public.ad_creative_versions set status = 'approved', reviewed_at = t where id = v.id;
    update public.ad_campaigns set approved_version_id = v.id, review_status = 'approved' where id = c.id;
  else
    if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
    update public.ad_creative_versions set status = 'rejected', reviewed_at = t, rejection_reason = btrim(p_reason) where id = v.id;
    update public.ad_campaigns set review_status = 'rejected' where id = c.id;
  end if;
  perform ads_internal.review_event(c.id, v.id, null, case when p_decision = 'approve' then 'approved' else 'rejected' end, 'admin',
    jsonb_build_object('reason', p_reason, 'due_before', v.review_due_before), t);
  perform ads_internal.audit('admin', 'creative_version', v.id, 'review_' || p_decision,
    jsonb_build_object('campaign_id', c.id, 'reason', p_reason));
end; $$;

-- ── Admin: necessary correction request ─────────────────────────────────
create or replace function public.ad_admin_request_correction(p_version_id uuid, p_cause text, p_reasons text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.ad_creative_versions;
  c public.ad_campaigns;
  b public.ad_bookings;
  rid uuid;
  t timestamptz := ads_internal.clock_now();
  reasons text[];
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_cause not in ('advertiser_material', 'msm_error') then raise exception 'ADS_BAD_CAUSE'; end if;
  reasons := array(select btrim(x) from unnest(coalesce(p_reasons, '{}')) x where btrim(x) <> '');
  if cardinality(reasons) = 0 or cardinality(reasons) > 20
     or exists (select 1 from unnest(reasons) x where char_length(x) < 5 or char_length(x) > 1000) then
    raise exception 'ADS_REASON_REQUIRED: give each necessary correction (5-1000 characters)';
  end if;
  select * into v from public.ad_creative_versions where id = p_version_id;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  select * into c from public.ad_campaigns where id = v.campaign_id for update;
  select * into b from public.ad_bookings where id = c.booking_id;
  if c.current_version_id is distinct from v.id or v.status <> 'submitted' then
    raise exception 'ADS_STALE_VERSION: only the latest submitted version can be reviewed';
  end if;
  if b.status <> 'confirmed' then raise exception 'ADS_NOT_PAID: review starts after payment clears'; end if;
  insert into public.ad_correction_requests (campaign_id, creative_version_id, cause, reasons, requested_at, requested_by)
  values (c.id, v.id, p_cause, reasons, t, auth.uid()) returning id into rid;
  update public.ad_creative_versions set status = 'correction_requested', reviewed_at = t where id = v.id;
  update public.ad_campaigns set review_status = 'correction_requested' where id = c.id;
  perform ads_internal.review_event(c.id, v.id, rid, 'correction_requested', 'admin',
    jsonb_build_object('cause', p_cause, 'reasons', to_jsonb(reasons), 'due_before', v.review_due_before), t);
  perform ads_internal.audit('admin', 'creative_version', v.id, 'correction_requested', jsonb_build_object('request_id', rid, 'cause', p_cause));
  return rid;
end; $$;

-- ── Correction notice delivery (mailer via service role, or admin fallback)
create or replace function ads_internal.apply_correction_notice(
  p_request_id uuid, p_channel text, p_status text, p_occurred_at timestamptz, p_provider_message_id text,
  p_idempotency_key text, p_note text, p_actor_kind text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  r public.ad_correction_requests;
  at_ts timestamptz := least(coalesce(p_occurred_at, ads_internal.clock_now()), ads_internal.clock_now());
  v_outcome text;
  v_due timestamptz;
begin
  if p_channel not in ('email', 'fallback') or p_status not in ('sent', 'failed', 'bounced') then raise exception 'ADS_BAD_NOTICE'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then raise exception 'ADS_BAD_NOTICE: idempotency key'; end if;
  if exists (select 1 from public.ad_correction_notices where idempotency_key = p_idempotency_key) then return 'duplicate'; end if;
  select * into r from public.ad_correction_requests where id = p_request_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;

  if p_status = 'sent' then
    if r.notice_delivered_at is null and r.status = 'awaiting_notice' then
      v_due := ads_internal.add_uk_working_hours(at_ts, 3);
      update public.ad_correction_requests
         set notice_delivered_at = at_ts, notice_channel = p_channel, response_due_at = v_due, status = 'awaiting_response'
       where id = r.id;
      insert into public.ad_review_deadlines (campaign_id, creative_version_id, correction_request_id, kind, starts_at, due_at, basis)
      values (r.campaign_id, r.creative_version_id, r.id, 'correction_response', at_ts, v_due,
              jsonb_build_object('channel', p_channel, 'working_hours', 3));
      v_outcome := 'response_window_started';
    else
      v_outcome := 'already_delivered_or_closed';
    end if;
  elsif r.notice_delivered_at is null then
    v_outcome := 'failed_before_delivery_no_window';
  else
    update public.ad_correction_requests set notice_exception = true where id = r.id;
    v_outcome := 'late_failure_exception_flagged'; -- GATE: MSM decides whether the window restarts
  end if;

  insert into public.ad_correction_notices (correction_request_id, channel, status, occurred_at, provider_message_id, idempotency_key, note, outcome)
  values (r.id, p_channel, p_status, at_ts, p_provider_message_id, p_idempotency_key, p_note, v_outcome);
  perform ads_internal.review_event(r.campaign_id, r.creative_version_id, r.id, 'correction_notice_' || p_status, p_actor_kind,
    jsonb_build_object('channel', p_channel, 'outcome', v_outcome, 'response_due_at', v_due), at_ts);
  return v_outcome;
end; $$;

create or replace function public.ad_record_correction_notice(
  p_request_id uuid, p_status text, p_occurred_at timestamptz, p_provider_message_id text, p_idempotency_key text
) returns text language sql security definer set search_path = '' as $$
  select ads_internal.apply_correction_notice(p_request_id, 'email', p_status, p_occurred_at, p_provider_message_id, p_idempotency_key, null, 'mailer')
$$;

create or replace function public.ad_admin_record_correction_notice(p_request_id uuid, p_status text, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED: describe the fallback contact'; end if;
  return ads_internal.apply_correction_notice(p_request_id, 'fallback', p_status, ads_internal.clock_now(), null,
    'admin-' || gen_random_uuid()::text, btrim(p_note), 'admin');
end; $$;

-- ── Review SLA summary (owner or admin) ─────────────────────────────────
create or replace function public.ad_review_sla(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.ad_campaigns;
  b public.ad_bookings;
  d public.ad_review_deadlines;
  first_outcome record;
  met boolean;
begin
  if not (ads_internal.owns_booking(p_booking_id) or public.is_admin_or_above()) then raise exception 'ADS_NOT_FOUND'; end if;
  select * into b from public.ad_bookings where id = p_booking_id;
  select * into c from public.ad_campaigns where booking_id = b.id;
  -- Initial deadline in force when MSM first reviewed (latest initial row).
  select * into d from public.ad_review_deadlines
   where campaign_id = c.id and kind in ('initial_standard', 'initial_priority') order by created_at desc, starts_at desc limit 1;
  select e.event_type, e.occurred_at into first_outcome from public.ad_review_events e
   where e.campaign_id = c.id
     and (e.event_type in ('approved', 'rejected')
          or (e.event_type = 'correction_requested' and e.details ->> 'cause' = 'advertiser_material'))
   order by e.occurred_at, e.id limit 1;
  met := case when d.id is null then null
              when first_outcome.occurred_at is not null then first_outcome.occurred_at <= d.due_at
              when ads_internal.clock_now() > d.due_at then false else null end;
  return jsonb_build_object(
    'booking_id', b.id, 'priority_review', b.priority_review,
    'initial_kind', d.kind, 'initial_started_at', d.starts_at, 'initial_due_at', d.due_at,
    'first_review_outcome', first_outcome.event_type, 'first_review_outcome_at', first_outcome.occurred_at,
    'initial_review_met', met,
    'priority_fee_refund_assessment_needed', (b.priority_review and met is false),
    'deadlines', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'starts_at', x.starts_at, 'due_at', x.due_at,
                            'version_id', x.creative_version_id, 'correction_request_id', x.correction_request_id) order by x.created_at)
                          from public.ad_review_deadlines x where x.campaign_id = c.id), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'version_id', q.creative_version_id,
                            'version_no', (select version_no from public.ad_creative_versions where id = q.creative_version_id),
                            'reasons', to_jsonb(q.reasons), 'status', q.status, 'notice_delivered_at', q.notice_delivered_at,
                            'response_due_at', q.response_due_at, 'responded_at', q.responded_at, 'timely', q.timely,
                            'notice_exception', q.notice_exception,
                            'cause', case when public.is_admin_or_above() then q.cause end) order by q.requested_at)
                          from public.ad_correction_requests q where q.campaign_id = c.id), '[]'::jsonb));
end; $$;

-- ── Priority option at hold / quote (replace with optional p_priority) ──
create or replace function public.ad_quote(p_product_id uuid, p_start date, p_end date, p_priority boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb;
  fee integer := 0;
  t timestamptz := ads_internal.clock_now();
begin
  if coalesce(p_priority, false) then
    if not ads_internal.setting_bool('ads_priority_review_enabled') then raise exception 'ADS_PRIORITY_UNAVAILABLE: priority review is not offered at the moment'; end if;
    fee := coalesce(ads_internal.setting_int('priority_fee_pence'), 15000);
  end if;
  base := public.ad_quote(p_product_id, p_start, p_end);
  return base || jsonb_build_object(
    'placement_pence', (base ->> 'total_pence')::integer,
    'priority_review', coalesce(p_priority, false),
    'priority_fee_pence', fee,
    'priority_available', ads_internal.setting_bool('ads_priority_review_enabled'),
    'total_pence', (base ->> 'total_pence')::integer + fee,
    'review_rule', case when coalesce(p_priority, false)
                        then 'Initial review within 12 elapsed hours after payment clears and complete artwork, link and info are received'
                        else 'Initial review by 23:59:59 UK time on the next working day (Mon-Fri, excl. England & Wales bank holidays) after payment clears and complete artwork, link and info are received' end,
    'review_due_if_ready_now', case when coalesce(p_priority, false) then t + interval '12 hours' else ads_internal.review_due_before(t) end,
    'terms_version', (select text_value from public.ad_settings where key = 'order_terms_version'));
end; $$;

create or replace function public.ad_create_hold(p_product_id uuid, p_start date, p_end date, p_priority boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  adv public.ad_advertisers;
  p public.ad_products;
  days integer;
  units uuid[];
  v_full date[];
  active_holds integer;
  bid uuid;
  fee integer := 0;
  terms text := (select text_value from public.ad_settings where key = 'order_terms_version');
begin
  if uid is null then raise exception 'ADS_AUTH_REQUIRED'; end if;
  if not ads_internal.setting_bool('ads_portal_enabled') then raise exception 'ADS_DISABLED: advertising portal is not enabled'; end if;
  if coalesce(p_priority, false) then
    if not ads_internal.setting_bool('ads_priority_review_enabled') then raise exception 'ADS_PRIORITY_UNAVAILABLE: priority review is not offered at the moment'; end if;
    fee := coalesce(ads_internal.setting_int('priority_fee_pence'), 15000);
  end if;
  select * into adv from public.ad_advertisers where owner_user_id = uid;
  if not found then raise exception 'ADS_NO_ADVERTISER: create an advertiser profile first'; end if;
  if adv.status <> 'active' then raise exception 'ADS_ADVERTISER_SUSPENDED'; end if;
  select * into p from public.ad_products where id = p_product_id and active;
  if not found then raise exception 'ADS_PRODUCT_UNAVAILABLE'; end if;
  days := ads_internal.validate_booking_dates(p, p_start, p_end);

  units := ads_internal.lock_units(array(select unit_id from public.ad_product_units where product_id = p.id));
  if cardinality(units) = 0 or exists (select 1 from public.ad_inventory_units where id = any(units) and not active) then
    raise exception 'ADS_PRODUCT_UNAVAILABLE: inventory not active';
  end if;
  update public.ad_bookings set status = 'expired', closed_at = now(), status_reason = 'Hold lapsed unpaid'
    where status = 'held' and hold_expires_at <= now()
      and id in (select booking_id from public.ad_booking_inventory_days where unit_id = any(units));
  select count(*) into active_holds from public.ad_bookings
    where advertiser_id = adv.id and status = 'held' and hold_expires_at > now();
  if active_holds >= coalesce(ads_internal.setting_int('max_active_holds_per_advertiser'), 3) then raise exception 'ADS_TOO_MANY_HOLDS'; end if;
  v_full := ads_internal.full_days(units, p_start, p_end, null);
  if cardinality(v_full) > 0 then raise exception 'ADS_CAPACITY_UNAVAILABLE' using detail = array_to_string(v_full, ','); end if;

  insert into public.ad_bookings (advertiser_id, product_id, start_date, end_date, status, hold_expires_at, is_test, created_by, priority_review)
  values (adv.id, p.id, p_start, p_end, 'held',
          now() + make_interval(mins => coalesce(ads_internal.setting_int('hold_minutes'), 60)), p.is_test, uid, coalesce(p_priority, false))
  returning id into bid;
  insert into public.ad_booking_inventory_days (booking_id, unit_id, day)
  select bid, u, gs::date from unnest(units) u cross join generate_series(p_start, p_end, interval '1 day') gs;
  insert into public.ad_purchase_snapshots (booking_id, product_id, product_code, product_name, unit_codes,
    start_date, end_date, billable_days, price_per_day_pence, priority_fee_pence, total_pence, currency, is_test,
    priority_review, terms_version, placement_pence, pricing_version)
  select bid, p.id, p.code, p.name,
         (select array_agg(code order by code) from public.ad_inventory_units where id = any(units)),
         p_start, p_end, days, p.price_per_day_pence, fee, days * p.price_per_day_pence + fee, p.currency, p.is_test,
         coalesce(p_priority, false), terms, days * p.price_per_day_pence, 'phase1-test-v2';
  insert into public.ad_campaigns (booking_id, advertiser_id) values (bid, adv.id);
  perform ads_internal.audit('advertiser', 'booking', bid, 'hold_created',
    jsonb_build_object('product', p.code, 'start', p_start, 'end', p_end, 'placement_pence', days * p.price_per_day_pence,
                       'priority_fee_pence', fee, 'terms_version', terms));
  return bid;
end; $$;

-- The 3-argument entry points now delegate (standard review, no fee).
create or replace function public.ad_create_hold(p_product_id uuid, p_start date, p_end date) returns uuid
language sql security definer set search_path = '' as $$
  select public.ad_create_hold(p_product_id, p_start, p_end, false)
$$;

create or replace function public.ad_prepare_checkout(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
begin
  if not ads_internal.setting_bool('ads_checkout_enabled') then raise exception 'ADS_DISABLED: checkout is not enabled'; end if;
  if not ads_internal.owns_booking(p_booking_id) then raise exception 'ADS_NOT_FOUND'; end if;
  select * into b from public.ad_bookings where id = p_booking_id;
  if b.status <> 'held' or b.hold_expires_at <= now() then raise exception 'ADS_INVALID_STATE: hold is not active'; end if;
  if b.hold_expires_at < now() + interval '31 minutes' then
    raise exception 'ADS_HOLD_TOO_SHORT: less than 31 minutes left on this hold; cancel it and create a new one';
  end if;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  return jsonb_build_object(
    'booking_id', b.id, 'total_pence', s.total_pence, 'currency', s.currency, 'is_test', s.is_test,
    'product_name', s.product_name, 'start_date', s.start_date, 'end_date', s.end_date,
    'hold_expires_at', b.hold_expires_at,
    'placement_pence', coalesce(s.placement_pence, s.total_pence - s.priority_fee_pence),
    'priority_fee_pence', s.priority_fee_pence, 'priority_review', s.priority_review);
end; $$;

-- ── Durable confirmation when payment is verified ───────────────────────
create or replace function ads_internal.write_booking_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.ad_purchase_snapshots;
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed'
     and not exists (select 1 from public.ad_booking_confirmations where booking_id = new.id) then
    select * into s from public.ad_purchase_snapshots where booking_id = new.id;
    insert into public.ad_booking_confirmations (booking_id, confirmed_at, total_pence, placement_pence, priority_fee_pence,
      priority_review, currency, terms_version, review_rule, booked_from, booked_until)
    values (new.id, coalesce(new.confirmed_at, now()), s.total_pence, coalesce(s.placement_pence, s.total_pence - s.priority_fee_pence),
      s.priority_fee_pence, s.priority_review, s.currency, s.terms_version,
      case when s.priority_review then 'priority: initial review within 12 elapsed hours of payment cleared + complete material'
           else 'standard: initial review by 23:59:59 UK time next working day after payment cleared + complete material' end,
      ads_internal.london_day_start(new.start_date), ads_internal.london_day_start(new.end_date + 1));
  end if;
  return new;
end; $$;
create trigger ad_bookings_write_confirmation after update of status on public.ad_bookings
  for each row execute function ads_internal.write_booking_confirmation();

-- ── RLS + grants ────────────────────────────────────────────────────────
alter table public.ad_correction_requests enable row level security;
alter table public.ad_correction_notices enable row level security;
alter table public.ad_review_deadlines enable row level security;
alter table public.ad_review_events enable row level security;
alter table public.ad_booking_confirmations enable row level security;

-- Advertisers see their own requests (reasons, exact version, deadline) but
-- NOT the internal cause classification (column-level grants below).
create policy ad_corrections_select on public.ad_correction_requests for select to authenticated
  using (ads_internal.owns_campaign(campaign_id) or public.is_admin_or_above());
create policy ad_deadlines_select on public.ad_review_deadlines for select to authenticated
  using (ads_internal.owns_campaign(campaign_id) or public.is_admin_or_above());
create policy ad_confirmations_select on public.ad_booking_confirmations for select to authenticated
  using (ads_internal.owns_booking(booking_id) or public.is_admin_or_above());
create policy ad_notices_admin on public.ad_correction_notices for select to authenticated using (public.is_admin_or_above());
create policy ad_review_events_admin on public.ad_review_events for select to authenticated using (public.is_admin_or_above());

revoke all on public.ad_correction_requests, public.ad_correction_notices, public.ad_review_deadlines,
  public.ad_review_events, public.ad_booking_confirmations from anon, authenticated;
grant select (id, campaign_id, creative_version_id, reasons, requested_at, status, notice_delivered_at, notice_channel,
  notice_exception, response_due_at, response_version_id, responded_at, timely) on public.ad_correction_requests to authenticated;
grant select on public.ad_review_deadlines, public.ad_booking_confirmations, public.ad_correction_notices, public.ad_review_events to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname in ('ad_admin_set_setting', 'ad_admin_review', 'ad_admin_request_correction',
                    'ad_record_correction_notice', 'ad_admin_record_correction_notice', 'ad_review_sla', 'ad_quote',
                    'ad_create_hold', 'ad_prepare_checkout'))
              or (n.nspname = 'ads_internal' and p.proname in ('clock_now', 'add_uk_working_hours', 'review_event',
                    'link_correction_response', 'record_correction_response', 'refresh_review_state', 'apply_correction_notice', 'write_booking_confirmation',
                    'guard_version_correction_link')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;

grant execute on function public.ad_admin_set_setting(text, boolean, integer), public.ad_admin_review(uuid, text, text),
  public.ad_admin_request_correction(uuid, text, text[]), public.ad_admin_record_correction_notice(uuid, text, text),
  public.ad_review_sla(uuid), public.ad_quote(uuid, date, date), public.ad_quote(uuid, date, date, boolean),
  public.ad_create_hold(uuid, date, date), public.ad_create_hold(uuid, date, date, boolean), public.ad_prepare_checkout(uuid)
  to authenticated;
grant execute on function public.ad_record_correction_notice(uuid, text, timestamptz, text, text) to service_role;
-- clock_now is used in a column default (evaluated as the inserting role).
grant execute on function ads_internal.clock_now() to authenticated, service_role;
