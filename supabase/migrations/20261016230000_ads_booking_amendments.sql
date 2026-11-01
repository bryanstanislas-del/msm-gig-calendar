-- Ads phase 1 -- booking amendment proposals + exact timestamp intervals
-- (forward migration on top of 20261016210000). STATUS: NOT APPLIED to any
-- remote database. Feature switch `ads_amendments_enabled` = OFF.
--
-- * Timestamp support ALONGSIDE calendar dates: ad_bookings.serve_from /
--   serve_until (both null = legacy calendar dates, i.e. 00:00 London on
--   start_date until 00:00 London on end_date + 1). Historical orders are
--   never altered: start_date/end_date, the purchase snapshot and the order
--   confirmation keep the ORIGINAL purchase; every change is an amendment
--   row plus an append-only interval history row.
-- * Correction-delay amendment (agreed terms 2026-10-16): proposed start =
--   next whole UK hour STRICTLY after the approval instant (UK offsets are
--   whole hours, so this is the next whole UTC hour). Purchased elapsed
--   duration preserved where capacity permits; never displaces another
--   active booking (confirmed, or an unexpired hold) -- the run is shortened
--   at that boundary instead. No negative or already-expired runs.
-- * Takes effect ONLY on the booking owner's recorded acceptance, which
--   re-checks capacity atomically (unit row locks, interval-level overlap
--   against every active booking's effective interval) and moves the
--   booking's inventory day rows to the London days the new interval
--   touches (conservative for day-based holds).
-- * Delivery, serve_until (WordPress hard expiry), impressions/clicks and
--   reports follow the EFFECTIVE interval. Lost-time refunds keep the
--   ORIGINAL purchased elapsed duration as the denominator.
-- GATES (support built, defaults keep current behaviour / blocked):
--   ads_amendments_enabled (OFF); amendment_offer_minutes (unset -> refuse:
--   pending-proposal expiry undecided; proposals never hold capacity);
--   replacement_pauses_previous_creative (OFF = earlier approved creative
--   keeps running during a replacement review, current behaviour);
--   24-hour packages: quote support only behind ads_hourly_packages_enabled
--   (OFF); holds for them are always refused (pricing not agreed).
--   Exact-hour rounding and DST: implemented as elapsed UTC arithmetic and
--   recorded in each proposal's `basis` as PROVISIONAL.

insert into public.ad_settings (key, bool_value, int_value, text_value, description) values
  ('ads_amendments_enabled', false, null, null, 'Booking amendment proposals (correction delay). Default OFF; policy gates in docs.'),
  ('amendment_offer_minutes', null, null, null, 'GATE: how long an amendment proposal stays open. Unset = proposals refused (undecided). Proposals never hold capacity.'),
  ('replacement_pauses_previous_creative', false, null, null, 'GATE: true = the earlier approved creative stops while a replacement is under review. Default false (current behaviour: it keeps running).'),
  ('ads_hourly_packages_enabled', false, null, null, 'GATE: proposed 24-hour elapsed packages (quote only). Holds are refused until pricing and terms are agreed.')
on conflict (key) do nothing;

alter table public.ad_bookings add column if not exists serve_from timestamptz;
alter table public.ad_bookings add column if not exists serve_until timestamptz;
alter table public.ad_bookings add column if not exists amended_at timestamptz;
alter table public.ad_bookings add constraint ad_bookings_serve_interval_check
  check ((serve_from is null) = (serve_until is null) and (serve_until is null or serve_until > serve_from));
comment on column public.ad_bookings.serve_from is 'Exact serving start [serve_from, serve_until) after an ACCEPTED amendment; null = legacy calendar dates. start_date/end_date keep the original order.';

-- ── Intervals ───────────────────────────────────────────────────────────
create or replace function ads_internal.original_range(p_booking uuid) returns tstzrange
language sql stable security definer set search_path = '' as $$
  select tstzrange(ads_internal.london_day_start(start_date), ads_internal.london_day_start(end_date + 1), '[)')
  from public.ad_bookings where id = p_booking
$$;

create or replace function ads_internal.effective_range(p_booking uuid) returns tstzrange
language sql stable security definer set search_path = '' as $$
  select case when serve_from is not null then tstzrange(serve_from, serve_until, '[)')
              else tstzrange(ads_internal.london_day_start(start_date), ads_internal.london_day_start(end_date + 1), '[)') end
  from public.ad_bookings where id = p_booking
$$;

-- Refund clipping / SLA use the served (effective) interval.
create or replace function ads_internal.booked_range(p_booking uuid) returns tstzrange
language sql stable security definer set search_path = '' as $$
  select ads_internal.effective_range(p_booking)
$$;

create or replace function ads_internal.days_touched(p tstzrange) returns date[]
language sql stable set search_path = '' as $$
  select array_agg(d::date order by d)
  from generate_series((lower(p) at time zone 'Europe/London')::date,
                       ((upper(p) - interval '1 microsecond') at time zone 'Europe/London')::date, interval '1 day') d
$$;

-- Bookings that occupy capacity (same rule as full_days).
create or replace function ads_internal.occupying(p_booking uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ad_bookings b where b.id = p_booking
                 and (b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now())))
$$;

-- True if putting one more booking on p_range would exceed rotation_capacity
-- on any of p_units at any instant (max overlap evaluated at every boundary).
-- Callers must hold the unit row locks.
create or replace function ads_internal.interval_conflicts(p_units uuid[], p_range tstzrange, p_exclude uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with occ as (
    select distinct d.unit_id, d.booking_id, ads_internal.effective_range(d.booking_id) as r
    from public.ad_booking_inventory_days d
    where d.unit_id = any(p_units) and d.booking_id is distinct from p_exclude and ads_internal.occupying(d.booking_id)
  ), hit as (select * from occ where r && p_range),
  pts as (
    select u.id as unit_id, u.rotation_capacity, lower(p_range) as p from public.ad_inventory_units u where u.id = any(p_units)
    union
    select h.unit_id, u.rotation_capacity, lower(h.r) from hit h join public.ad_inventory_units u on u.id = h.unit_id where lower(h.r) <@ p_range
  )
  select exists (select 1 from pts where (select count(*) from hit h where h.unit_id = pts.unit_id and pts.p <@ h.r) >= pts.rotation_capacity)
$$;

create or replace function ads_internal.booking_units(p_booking uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct unit_id order by unit_id), '{}') from public.ad_booking_inventory_days where booking_id = p_booking
$$;

-- ── Delivery follows the effective interval (+ replacement gate) ────────
create or replace function ads_internal.eligible_creatives(p_placement text)
returns table (creative_version_id uuid, booking_id uuid, unit_id uuid, serve_until timestamptz,
               alt_text text, destination_url text, desktop_width int, desktop_height int,
               mobile_width int, mobile_height int, desktop_object_path text, mobile_object_path text)
language sql stable security definer set search_path = '' as $$
  select v.id, b.id, u.id, upper(ads_internal.effective_range(b.id)),
         v.alt_text, v.destination_url, v.desktop_width, v.desktop_height, v.mobile_width, v.mobile_height,
         v.desktop_object_path, v.mobile_object_path
  from public.ad_inventory_units u
  join public.ad_booking_inventory_days d on d.unit_id = u.id and d.day = ads_internal.london_today()
  join public.ad_bookings b on b.id = d.booking_id and b.status = 'confirmed'
  join public.ad_campaigns c on c.booking_id = b.id and not c.paused and c.approved_version_id is not null
  join public.ad_creative_versions v on v.id = c.approved_version_id and v.status = 'approved'
  where u.code = p_placement and u.active
    and ads_internal.setting_bool('ads_delivery_enabled')
    and ads_internal.booking_funded(b.id)
    and now() <@ ads_internal.effective_range(b.id)
    and not (coalesce(ads_internal.setting_bool('replacement_pauses_previous_creative'), false)
             and c.current_version_id is distinct from c.approved_version_id
             and exists (select 1 from public.ad_creative_versions cv where cv.id = c.current_version_id and cv.status = 'submitted'))
  order by b.confirmed_at, b.id
$$;

-- ── Reports cover the effective interval's London days ──────────────────
create or replace function public.ad_report(p_booking_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
  eff tstzrange; orig tstzrange; d0 date; d1 date;
  f date; t date;
begin
  if not (ads_internal.owns_booking(p_booking_id) or public.is_admin_or_above()) then raise exception 'ADS_NOT_FOUND'; end if;
  select * into b from public.ad_bookings where id = p_booking_id;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  eff := ads_internal.effective_range(b.id);
  orig := ads_internal.original_range(b.id);
  d0 := (ads_internal.days_touched(eff))[1];
  d1 := (ads_internal.days_touched(eff))[array_length(ads_internal.days_touched(eff), 1)];
  f := greatest(coalesce(p_from, d0), d0);
  t := least(coalesce(p_to, d1), d1);
  return jsonb_build_object(
    'booking_id', b.id, 'status', b.status, 'product_name', s.product_name, 'placements', to_jsonb(s.unit_codes),
    'booked_start', b.start_date, 'booked_end', b.end_date, 'from', f, 'to', t, 'is_test', b.is_test,
    'original_from', lower(orig), 'original_until', upper(orig),
    'served_from', lower(eff), 'served_until', upper(eff), 'amended', b.serve_from is not null,
    'served_seconds', extract(epoch from upper(eff) - lower(eff))::bigint,
    'generated_at', now(),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date,
        'impressions', coalesce((select sum(m.impressions) from public.ad_metrics_daily m where m.booking_id = b.id and m.day = d::date), 0),
        'clicks',      coalesce((select sum(m.clicks)      from public.ad_metrics_daily m where m.booking_id = b.id and m.day = d::date), 0))
        order by d)
      from generate_series(f, t, interval '1 day') d
      where f <= t), '[]'::jsonb));
end; $$;

-- ── Amendment records ───────────────────────────────────────────────────
create table public.ad_booking_amendments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.ad_bookings(id) on delete restrict,
  reason text not null check (reason in ('correction_delay')),
  approved_version_id uuid references public.ad_creative_versions(id),
  approved_at timestamptz not null,
  original_from timestamptz not null,
  original_until timestamptz not null,
  proposed_from timestamptz not null,
  proposed_until timestamptz not null,
  purchased_seconds bigint not null check (purchased_seconds > 0),
  preserves_duration boolean not null,
  shortened_seconds bigint not null check (shortened_seconds >= 0),
  following_booking_id uuid references public.ad_bookings(id),
  basis jsonb not null,
  status text not null check (status in ('proposed', 'accepted', 'rejected', 'expired', 'withdrawn', 'superseded')),
  note text,
  proposed_by uuid,
  proposed_at timestamptz not null,
  expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid,
  check (proposed_until > proposed_from),
  check (original_until > original_from)
);
comment on table public.ad_booking_amendments is 'Proposed changes to a booking''s serving interval. Only the booking owner''s acceptance applies one (atomic capacity re-check). The interval columns are immutable; the original order is never rewritten.';
create unique index ad_booking_amendments_one_open on public.ad_booking_amendments (booking_id) where status = 'proposed';

create or replace function ads_internal.guard_amendment_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.booking_id, new.original_from, new.original_until, new.proposed_from, new.proposed_until, new.purchased_seconds,
      new.approved_at, new.basis, new.proposed_at, new.expires_at)
     is distinct from
     (old.booking_id, old.original_from, old.original_until, old.proposed_from, old.proposed_until, old.purchased_seconds,
      old.approved_at, old.basis, old.proposed_at, old.expires_at)
     or old.status <> 'proposed' then
    raise exception 'ADS_IMMUTABLE: amendment intervals are immutable; decided amendments are final';
  end if;
  return new;
end; $$;
create trigger ad_booking_amendments_guard before update on public.ad_booking_amendments
  for each row execute function ads_internal.guard_amendment_update();
create trigger ad_booking_amendments_no_delete before delete on public.ad_booking_amendments
  for each row execute function ads_internal.block_mutation();

create table public.ad_booking_interval_history (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.ad_bookings(id) on delete restrict,
  amendment_id uuid references public.ad_booking_amendments(id),
  kind text not null check (kind in ('original', 'amended')),
  serve_from timestamptz not null,
  serve_until timestamptz not null,
  recorded_at timestamptz not null,
  recorded_by uuid
);
comment on table public.ad_booking_interval_history is 'Append-only: the original interval and every accepted change.';
create trigger ad_booking_interval_history_immutable before update or delete on public.ad_booking_interval_history
  for each row execute function ads_internal.block_mutation();

-- ── Admin: propose (no capacity is held by a proposal) ──────────────────
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
  approved_at := v.reviewed_at;
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

-- ── Owner: accept / reject (recorded agreement; atomic recheck) ─────────
create or replace function public.ad_respond_amendment(p_amendment_id uuid, p_decision text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a public.ad_booking_amendments; b public.ad_bookings; t timestamptz := ads_internal.clock_now();
  units uuid[]; u uuid; eff tstzrange; newr tstzrange; bid uuid;
begin
  if p_decision not in ('accept', 'reject') then raise exception 'ADS_BAD_DECISION'; end if;
  select booking_id into bid from public.ad_booking_amendments where id = p_amendment_id;
  if bid is null or not ads_internal.owns_booking(bid) then raise exception 'ADS_NOT_FOUND'; end if;   -- owner only (admins cannot accept for them)
  select * into b from public.ad_bookings where id = bid for update;                                    -- booking lock first
  select * into a from public.ad_booking_amendments where id = p_amendment_id for update;
  if a.status <> 'proposed' then raise exception 'ADS_INVALID_STATE: amendment is %', a.status; end if;
  if a.expires_at <= t then
    update public.ad_booking_amendments set status = 'expired', decided_at = t where id = a.id;
    return 'expired';
  end if;
  if p_decision = 'reject' then
    update public.ad_booking_amendments set status = 'rejected', decided_at = t, decided_by = auth.uid() where id = a.id;
    perform ads_internal.audit('advertiser', 'booking', b.id, 'amendment_rejected', jsonb_build_object('amendment_id', a.id));
    return 'rejected';
  end if;
  eff := ads_internal.effective_range(b.id);
  if b.status <> 'confirmed' or not ads_internal.booking_funded(b.id) then raise exception 'ADS_INVALID_STATE: booking no longer active'; end if;
  if lower(eff) <> a.original_from or upper(eff) <> a.original_until then raise exception 'ADS_STALE_AMENDMENT: the booking changed since this proposal'; end if;
  if a.proposed_until <= t then raise exception 'ADS_STALE_AMENDMENT: the proposed run has already ended'; end if;
  newr := tstzrange(a.proposed_from, a.proposed_until, '[)');
  units := ads_internal.lock_units(ads_internal.booking_units(b.id));
  if ads_internal.interval_conflicts(units, newr, b.id) then
    raise exception 'ADS_CAPACITY_UNAVAILABLE: the proposed interval is no longer free';
  end if;
  if not exists (select 1 from public.ad_booking_interval_history where booking_id = b.id) then
    insert into public.ad_booking_interval_history (booking_id, kind, serve_from, serve_until, recorded_at, recorded_by)
    values (b.id, 'original', lower(eff), upper(eff), t, auth.uid());
  end if;
  update public.ad_bookings set serve_from = a.proposed_from, serve_until = a.proposed_until, amended_at = t where id = b.id;
  delete from public.ad_booking_inventory_days where booking_id = b.id;
  foreach u in array units loop
    insert into public.ad_booking_inventory_days (booking_id, unit_id, day)
    select b.id, u, d from unnest(ads_internal.days_touched(newr)) d;
  end loop;
  insert into public.ad_booking_interval_history (booking_id, amendment_id, kind, serve_from, serve_until, recorded_at, recorded_by)
  values (b.id, a.id, 'amended', a.proposed_from, a.proposed_until, t, auth.uid());
  update public.ad_booking_amendments set status = 'accepted', decided_at = t, decided_by = auth.uid() where id = a.id;
  perform ads_internal.audit('advertiser', 'booking', b.id, 'amendment_accepted',
    jsonb_build_object('amendment_id', a.id, 'from', a.proposed_from, 'until', a.proposed_until));
  return 'accepted';
end; $$;

create or replace function public.ad_admin_withdraw_amendment(p_amendment_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.ad_booking_amendments;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into a from public.ad_booking_amendments where id = p_amendment_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if a.status <> 'proposed' then raise exception 'ADS_INVALID_STATE'; end if;
  update public.ad_booking_amendments set status = 'withdrawn', decided_at = ads_internal.clock_now(), decided_by = auth.uid() where id = a.id;
  perform ads_internal.audit('admin', 'booking', a.booking_id, 'amendment_withdrawn', jsonb_build_object('amendment_id', a.id, 'note', btrim(p_note)));
end; $$;

-- ── Proposed 24-hour packages: quote support only, behind a gate ────────
create or replace function public.ad_quote_elapsed(p_product_id uuid, p_start_at timestamptz, p_hours integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.ad_products; r tstzrange; units uuid[]; earliest timestamptz;
begin
  if not coalesce(ads_internal.setting_bool('ads_hourly_packages_enabled'), false) then
    raise exception 'ADS_POLICY_GATE: 24-hour elapsed packages are not approved (calendar-date packages only)';
  end if;
  if p_hours is null or p_hours <= 0 or p_hours % 24 <> 0 then raise exception 'ADS_INVALID_DATES: whole 24-hour multiples only'; end if;
  if p_start_at is null or p_start_at <> date_trunc('hour', p_start_at) then raise exception 'ADS_INVALID_DATES: packages start on a whole UK hour'; end if;
  select * into p from public.ad_products where id = p_product_id and active;
  if not found then raise exception 'ADS_PRODUCT_UNAVAILABLE'; end if;
  earliest := ads_internal.london_day_start(ads_internal.earliest_standard_start(ads_internal.clock_now()));
  if p_start_at < earliest then raise exception 'ADS_INVALID_DATES: earliest standard start is %', earliest; end if;
  r := tstzrange(p_start_at, p_start_at + make_interval(hours => p_hours), '[)');
  select coalesce(array_agg(pu.unit_id), '{}') into units from public.ad_product_units pu where pu.product_id = p.id;
  return jsonb_build_object('start_at', lower(r), 'end_at', upper(r), 'elapsed_hours', p_hours,
    'london_days_touched', to_jsonb(ads_internal.days_touched(r)),
    'available', not ads_internal.interval_conflicts(units, r, null),
    'price', null, 'pricing_gate', 'Pricing and terms for elapsed-hour packages are not agreed; holds are refused.');
end; $$;

create or replace function public.ad_create_hold_elapsed(p_product_id uuid, p_start_at timestamptz, p_hours integer, p_priority boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'ADS_POLICY_GATE: 24-hour elapsed packages cannot be booked until Bryan confirms they replace inclusive calendar dates and pricing is agreed';
end; $$;

-- ── Lost-time refunds keep the ORIGINAL purchased duration ──────────────
-- (copied forward from 20261016180000; only the `purchased :=` line changes)
create or replace function public.ad_admin_propose_refund(p_booking_id uuid, p_include_priority_fee boolean, p_lost jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
  sla jsonb;
  aid uuid;
  t timestamptz := ads_internal.clock_now();
  booked tstzrange;
  given tstzmultirange := '{}';
  earlier tstzmultirange := '{}';
  fresh tstzmultirange;
  placement integer;
  purchased bigint;
  lost bigint;
  already_lost_pence integer;
  lost_pence integer := 0;
  fee_pence integer := 0;
  v_gates text[] := '{}';
  item jsonb;
  evidence jsonb := '[]'::jsonb;
  live text[] := array['proposed', 'manual_gate', 'approved'];
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;          -- booking lock first
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if b.status not in ('confirmed', 'refunded', 'cancelled') then raise exception 'ADS_INVALID_STATE: only paid bookings can be assessed'; end if;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  placement := coalesce(s.placement_pence, s.total_pence - s.priority_fee_pence);
  booked := ads_internal.booked_range(b.id);
  purchased := extract(epoch from (upper(ads_internal.original_range(b.id)) - lower(ads_internal.original_range(b.id))))::bigint;  -- original purchase

  if coalesce(p_include_priority_fee, false) then
    sla := public.ad_review_sla(b.id);
    if not coalesce((sla ->> 'priority_fee_refund_assessment_needed')::boolean, false) then
      raise exception 'ADS_PRIORITY_REFUND_NOT_DUE: the initial priority deadline was not missed by MSM';
    end if;
    if ads_internal.refund_sum(b.id, live, null, 'priority_fee') > 0 then
      raise exception 'ADS_ALREADY_ASSESSED: priority fee already in an assessment';
    end if;
    fee_pence := s.priority_fee_pence;                                                   -- fee cap: the fee, once
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_lost, '[]'::jsonb)) loop
    if char_length(coalesce(item ->> 'evidence', '')) < 10 then raise exception 'ADS_EVIDENCE_REQUIRED: each lost interval needs evidence'; end if;
    if (item ->> 'from')::timestamptz >= (item ->> 'until')::timestamptz then raise exception 'ADS_BAD_INTERVAL'; end if;
    given := given + tstzmultirange(tstzrange((item ->> 'from')::timestamptz, (item ->> 'until')::timestamptz, '[)'));
    evidence := evidence || jsonb_build_array(item);
  end loop;
  select coalesce(range_agg(r), '{}') into earlier
    from public.ad_refund_lines l join public.ad_refund_assessments a on a.id = l.assessment_id, unnest(l.lost_ranges) r
   where a.booking_id = b.id and a.status <> 'rejected' and l.kind = 'lost_time';
  fresh := (given * tstzmultirange(booked)) - earlier;
  lost := ads_internal.multirange_seconds(fresh);
  if lost > 0 then
    already_lost_pence := ads_internal.refund_sum(b.id, live, null, 'lost_time');
    lost_pence := least(ads_internal.lost_time_refund_pence(placement, purchased, lost), placement - already_lost_pence);  -- placement cap
    if ads_internal.multirange_seconds(fresh + earlier) >= purchased then v_gates := v_gates || 'whole_run_lost'::text; end if;
  end if;
  if fee_pence + lost_pence = 0 then raise exception 'ADS_NOTHING_TO_REFUND'; end if;
  if cardinality(s.unit_codes) > 1 then v_gates := v_gates || 'multi_slot_allocation'::text; end if;
  if exists (select 1 from public.ad_refund_assessments where booking_id = b.id and kind = 'cancellation' and status = any (live)) then
    v_gates := v_gates || 'cross_kind_allocation'::text;
  end if;
  if ads_internal.refund_sum(b.id, live) + fee_pence + lost_pence > s.total_pence then
    v_gates := v_gates || 'exceeds_booking_total'::text;
  end if;

  insert into public.ad_refund_assessments (booking_id, kind, status, total_pence, gates, note, proposed_by, proposed_at)
  values (b.id, 'service_failure', case when cardinality(v_gates) > 0 then 'manual_gate' else 'proposed' end,
          fee_pence + lost_pence, v_gates, btrim(p_note), auth.uid(), t)
  returning id into aid;
  if fee_pence > 0 then
    insert into public.ad_refund_lines (assessment_id, kind, pence, details)
    values (aid, 'priority_fee', fee_pence, jsonb_build_object('initial_due_at', sla ->> 'initial_due_at', 'first_review_outcome_at', sla ->> 'first_review_outcome_at'));
  end if;
  if lost_pence > 0 then
    insert into public.ad_refund_lines (assessment_id, kind, pence, lost_seconds, purchased_seconds, lost_ranges, evidence, details)
    values (aid, 'lost_time', lost_pence, lost, purchased, fresh, evidence,
            jsonb_build_object('placement_pence', placement, 'rounding', 'half_up_final_penny',
                               'exact_numerator', placement::numeric * lost, 'exact_denominator', purchased));
  end if;
  perform ads_internal.audit('admin', 'booking', b.id, 'refund_proposed', jsonb_build_object('assessment_id', aid, 'total_pence', fee_pence + lost_pence, 'gates', v_gates));
  return aid;
end; $$;

-- ── RLS / grants ────────────────────────────────────────────────────────
alter table public.ad_booking_amendments enable row level security;
alter table public.ad_booking_interval_history enable row level security;
create policy ad_booking_amendments_select on public.ad_booking_amendments for select to authenticated
  using (ads_internal.owns_booking(booking_id) or public.is_admin_or_above());
create policy ad_booking_interval_history_select on public.ad_booking_interval_history for select to authenticated
  using (ads_internal.owns_booking(booking_id) or public.is_admin_or_above());
revoke all on public.ad_booking_amendments, public.ad_booking_interval_history from anon, authenticated, service_role;
grant select on public.ad_booking_amendments, public.ad_booking_interval_history to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname in ('ad_admin_propose_amendment', 'ad_respond_amendment', 'ad_admin_withdraw_amendment',
                    'ad_quote_elapsed', 'ad_create_hold_elapsed', 'ad_report', 'ad_admin_propose_refund'))
              or (n.nspname = 'ads_internal' and p.proname in ('original_range', 'effective_range', 'booked_range', 'days_touched', 'occupying',
                    'interval_conflicts', 'booking_units', 'eligible_creatives', 'guard_amendment_update')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
grant execute on function public.ad_admin_propose_amendment(uuid, text), public.ad_respond_amendment(uuid, text),
  public.ad_admin_withdraw_amendment(uuid, text), public.ad_quote_elapsed(uuid, timestamptz, integer),
  public.ad_create_hold_elapsed(uuid, timestamptz, integer, boolean), public.ad_report(uuid, date, date),
  public.ad_admin_propose_refund(uuid, boolean, jsonb, text) to authenticated;
