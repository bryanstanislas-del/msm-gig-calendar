-- Ads phase 1 -- manual, audited refund assessment + business cancellation
-- (agreed terms 2026-10-16). STATUS: NOT APPLIED to any remote database.
-- Forward migration on top of 20261016120000. Nothing here moves money:
-- refunds are proposed, approved and then issued MANUALLY in Stripe; the
-- processor outcome is recorded separately (idempotent). No live refunds.
--
--  * Priority fee: full fee when MSM missed the initial paid priority
--    deadline through its own fault (ad_review_sla says so), once per booking.
--  * Lost advertising time through MSM fault: placement charge (excl. the
--    priority fee) x lost elapsed seconds / purchased elapsed seconds, exact
--    integer arithmetic, final penny rounded half-up (GATE: rounding rule to
--    confirm), capped at the placement charge, overlaps with earlier
--    assessments removed (no double counting). Evidence required per interval.
--  * Contractual payment target: 14 days after approval (entitlement and
--    amount confirmed). Statutory cancellation rights are separate.
--  * Manual GATES (cannot be approved until policy exists): whole run lost,
--    multi-slot allocation, cancellation of undetermined/consumer status.
--  * Business cancellation: removal is distinct from the financial
--    assessment (no automatic unused-hours refund, no blanket "no refund").
--    Retained = delivered service + evidenced reasonable net loss (after
--    mitigation/saved costs/resale), max the booking price; no double
--    recovery. Consumer cancellation path is DISABLED pending a reviewed flow.
--  * Approved partial refunds no longer unfund a booking (delivery continues);
--    any refund beyond approved assessments still does.

create table public.ad_refund_assessments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.ad_bookings(id) on delete restrict,
  kind text not null check (kind in ('service_failure', 'cancellation')),
  status text not null check (status in ('proposed', 'manual_gate', 'approved', 'rejected')),
  total_pence integer not null check (total_pence >= 0),
  gates text[] not null default '{}',
  note text,
  proposed_by uuid,
  proposed_at timestamptz not null,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  target_pay_by timestamptz
);
comment on table public.ad_refund_assessments is 'Manual refund assessments. Approval confirms entitlement + amount (target payment within 14 days). Money is moved manually in Stripe; see ad_refund_processing_events.';

create table public.ad_refund_lines (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ad_refund_assessments(id) on delete restrict,
  kind text not null check (kind in ('priority_fee', 'lost_time', 'cancellation_balance')),
  pence integer not null check (pence >= 0),
  lost_seconds bigint,
  purchased_seconds bigint,
  lost_ranges tstzmultirange,
  evidence jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb
);

create table public.ad_refund_processing_events (
  id bigint generated always as identity primary key,
  assessment_id uuid not null references public.ad_refund_assessments(id) on delete restrict,
  status text not null check (status in ('submitted', 'succeeded', 'failed')),
  provider_refund_id text,
  idempotency_key text not null unique,
  note text,
  recorded_by uuid,
  occurred_at timestamptz not null
);
comment on table public.ad_refund_processing_events is 'Processor state for an APPROVED assessment, distinct from the approval itself. Append-only, idempotent on idempotency_key.';

create table public.ad_cancellation_cases (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.ad_bookings(id) on delete restrict,
  initiated_by text not null check (initiated_by in ('msm', 'advertiser')),
  party_type text not null check (party_type in ('business', 'consumer', 'undetermined')),
  removed_at timestamptz not null,
  removed_by uuid,
  reason text not null
);
comment on table public.ad_cancellation_cases is 'Campaign removal, recorded separately from any financial assessment. party_type is decided on the facts by MSM, never by a checkbox.';

create trigger ad_refund_lines_immutable before update or delete on public.ad_refund_lines
  for each row execute function ads_internal.block_mutation();
create trigger ad_refund_processing_events_immutable before update or delete on public.ad_refund_processing_events
  for each row execute function ads_internal.block_mutation();
create trigger ad_refund_assessments_no_delete before delete on public.ad_refund_assessments
  for each row execute function ads_internal.block_mutation();
create trigger ad_cancellation_cases_immutable before update or delete on public.ad_cancellation_cases
  for each row execute function ads_internal.block_mutation();

-- Exact lost-time amount; half-up on the final penny only; capped.
create or replace function ads_internal.lost_time_refund_pence(p_placement integer, p_purchased_seconds bigint, p_lost_seconds bigint)
returns integer language sql immutable set search_path = '' as $$
  select least(p_placement::bigint,
               (2 * p_placement::bigint * least(p_lost_seconds, p_purchased_seconds) + p_purchased_seconds) / (2 * p_purchased_seconds))::integer
$$;

create or replace function ads_internal.booked_range(p_booking uuid) returns tstzrange
language sql stable security definer set search_path = '' as $$
  select tstzrange(ads_internal.london_day_start(start_date), ads_internal.london_day_start(end_date + 1), '[)')
  from public.ad_bookings where id = p_booking
$$;

create or replace function ads_internal.multirange_seconds(p tstzmultirange) returns bigint
language sql immutable set search_path = '' as $$
  select coalesce(sum(extract(epoch from (upper(r) - lower(r))))::bigint, 0) from unnest(p) r
$$;

-- ── Propose a service-failure refund (server recomputes everything) ────
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
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if b.status not in ('confirmed', 'refunded', 'cancelled') then raise exception 'ADS_INVALID_STATE: only paid bookings can be assessed'; end if;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  placement := coalesce(s.placement_pence, s.total_pence - s.priority_fee_pence);
  booked := ads_internal.booked_range(b.id);
  purchased := extract(epoch from (upper(booked) - lower(booked)))::bigint;

  if coalesce(p_include_priority_fee, false) then
    sla := public.ad_review_sla(b.id);
    if not coalesce((sla ->> 'priority_fee_refund_assessment_needed')::boolean, false) then
      raise exception 'ADS_PRIORITY_REFUND_NOT_DUE: the initial priority deadline was not missed by MSM';
    end if;
    if exists (select 1 from public.ad_refund_lines l join public.ad_refund_assessments a on a.id = l.assessment_id
               where a.booking_id = b.id and a.status <> 'rejected' and l.kind = 'priority_fee') then
      raise exception 'ADS_ALREADY_ASSESSED: priority fee already in an assessment';
    end if;
    fee_pence := s.priority_fee_pence;
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
  fresh := (given * tstzmultirange(booked)) - earlier;            -- clipped, minus already-assessed time
  lost := ads_internal.multirange_seconds(fresh);
  if lost > 0 then
    select coalesce(sum(l.pence), 0) into already_lost_pence
      from public.ad_refund_lines l join public.ad_refund_assessments a on a.id = l.assessment_id
     where a.booking_id = b.id and a.status <> 'rejected' and l.kind = 'lost_time';
    lost_pence := least(ads_internal.lost_time_refund_pence(placement, purchased, lost), placement - already_lost_pence);
    if ads_internal.multirange_seconds(fresh + earlier) >= purchased then v_gates := v_gates || 'whole_run_lost'::text; end if;
  end if;
  if fee_pence + lost_pence = 0 then raise exception 'ADS_NOTHING_TO_REFUND'; end if;
  if cardinality(s.unit_codes) > 1 then v_gates := v_gates || 'multi_slot_allocation'::text; end if;

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

-- ── Business cancellation: removal, then (separately) assessment ──────
create or replace function public.ad_admin_cancel_booking(p_booking_id uuid, p_reason text, p_party_type text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.ad_bookings;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  if p_party_type not in ('business', 'consumer', 'undetermined') then raise exception 'ADS_BAD_PARTY_TYPE'; end if;
  if p_party_type = 'consumer' then
    raise exception 'ADS_CONSUMER_CANCELLATION_PATH_DISABLED: consumer cancellation needs the reviewed consumer flow (not built)';
  end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if b.status not in ('held', 'confirmed', 'payment_conflict') then raise exception 'ADS_INVALID_STATE'; end if;
  update public.ad_bookings set status = 'cancelled', closed_at = now(), status_reason = 'Removed by MSM (financial assessment separate)' where id = b.id;
  -- Removal is NOT an automatic refund: no requires_refund flag here.
  insert into public.ad_cancellation_cases (booking_id, initiated_by, party_type, removed_at, removed_by, reason)
  values (b.id, 'msm', p_party_type, ads_internal.clock_now(), auth.uid(), btrim(p_reason));
  perform ads_internal.audit('admin', 'booking', b.id, 'removed', jsonb_build_object('reason', p_reason, 'party_type', p_party_type));
end; $$;

-- 2-argument form (existing UI): party type undetermined -> assessment gated.
create or replace function public.ad_admin_cancel_booking(p_booking_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  select public.ad_admin_cancel_booking(p_booking_id, p_reason, 'undetermined')
$$;

create or replace function public.ad_admin_propose_cancellation_refund(
  p_booking_id uuid, p_delivered_value_pence integer, p_net_loss_pence integer, p_evidence text, p_note text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
  k public.ad_cancellation_cases;
  paid integer;
  retained integer;
  previously integer;
  refund integer;
  aid uuid;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 or p_evidence is null or char_length(btrim(p_evidence)) < 10 then
    raise exception 'ADS_EVIDENCE_REQUIRED';
  end if;
  if p_delivered_value_pence is null or p_net_loss_pence is null or p_delivered_value_pence < 0 or p_net_loss_pence < 0 then
    raise exception 'ADS_BAD_AMOUNT';
  end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;
  select * into k from public.ad_cancellation_cases where booking_id = p_booking_id;
  if not found then raise exception 'ADS_INVALID_STATE: remove the campaign first'; end if;
  if k.party_type <> 'business' then
    raise exception 'ADS_MANUAL_GATE: cancellation assessment needs business status determined on the facts (consumer path disabled)';
  end if;
  if exists (select 1 from public.ad_refund_assessments where booking_id = b.id and kind = 'cancellation' and status <> 'rejected') then
    raise exception 'ADS_ALREADY_ASSESSED: a cancellation assessment already exists';
  end if;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  paid := s.total_pence;
  retained := p_delivered_value_pence + p_net_loss_pence;
  if retained > paid then raise exception 'ADS_BAD_AMOUNT: retained amount cannot exceed the booking price'; end if;
  select coalesce(sum(total_pence), 0) into previously from public.ad_refund_assessments
   where booking_id = b.id and status in ('proposed', 'approved', 'manual_gate');
  refund := greatest(paid - retained - previously, 0);           -- no double recovery
  insert into public.ad_refund_assessments (booking_id, kind, status, total_pence, note, proposed_by, proposed_at)
  values (b.id, 'cancellation', 'proposed', refund, btrim(p_note), auth.uid(), ads_internal.clock_now()) returning id into aid;
  insert into public.ad_refund_lines (assessment_id, kind, pence, evidence, details)
  values (aid, 'cancellation_balance', refund, jsonb_build_array(btrim(p_evidence)),
          jsonb_build_object('paid_pence', paid, 'delivered_value_pence', p_delivered_value_pence,
                             'net_loss_pence', p_net_loss_pence, 'previously_assessed_pence', previously));
  perform ads_internal.audit('admin', 'booking', b.id, 'cancellation_assessment_proposed', jsonb_build_object('assessment_id', aid, 'refund_pence', refund));
  return aid;
end; $$;

-- ── Decision (approval confirms entitlement + amount) ───────────────────
create or replace function public.ad_admin_decide_refund(p_assessment_id uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.ad_refund_assessments; t timestamptz := ads_internal.clock_now();
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'ADS_BAD_DECISION'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select * into a from public.ad_refund_assessments where id = p_assessment_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if a.status = 'manual_gate' and p_decision = 'approve' then
    raise exception 'ADS_MANUAL_GATE: % needs an agreed policy before approval', array_to_string(a.gates, ', ');
  end if;
  if a.status not in ('proposed', 'manual_gate') then raise exception 'ADS_INVALID_STATE: already decided'; end if;
  update public.ad_refund_assessments
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = t, decision_note = btrim(p_note),
         target_pay_by = case when p_decision = 'approve' then t + interval '14 days' end
   where id = a.id;
  perform ads_internal.audit('admin', 'booking', a.booking_id, 'refund_' || p_decision, jsonb_build_object('assessment_id', a.id, 'total_pence', a.total_pence));
end; $$;

-- ── Processor state (recorded after a MANUAL refund in Stripe) ──────────
create or replace function public.ad_admin_record_refund_processing(
  p_assessment_id uuid, p_status text, p_provider_refund_id text, p_idempotency_key text, p_note text
) returns text language plpgsql security definer set search_path = '' as $$
declare a public.ad_refund_assessments;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_status not in ('submitted', 'succeeded', 'failed') then raise exception 'ADS_BAD_STATUS'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then raise exception 'ADS_BAD_KEY'; end if;
  if exists (select 1 from public.ad_refund_processing_events where idempotency_key = p_idempotency_key) then return 'duplicate'; end if;
  select * into a from public.ad_refund_assessments where id = p_assessment_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if a.status <> 'approved' then raise exception 'ADS_INVALID_STATE: only approved assessments can be processed'; end if;
  if p_status in ('submitted', 'succeeded') and (p_provider_refund_id is null or p_provider_refund_id !~ '^re_[A-Za-z0-9]+$') then
    raise exception 'ADS_BAD_PROVIDER_ID: record the Stripe refund id (re_...)';
  end if;
  if exists (select 1 from public.ad_refund_processing_events where assessment_id = a.id and status = 'succeeded') then
    raise exception 'ADS_INVALID_STATE: already succeeded';
  end if;
  insert into public.ad_refund_processing_events (assessment_id, status, provider_refund_id, idempotency_key, note, recorded_by, occurred_at)
  values (a.id, p_status, p_provider_refund_id, p_idempotency_key, p_note, auth.uid(), ads_internal.clock_now());
  perform ads_internal.audit('admin', 'booking', a.booking_id, 'refund_processing_' || p_status, jsonb_build_object('assessment_id', a.id, 'provider_refund_id', p_provider_refund_id));
  return 'recorded';
end; $$;

create or replace function ads_internal.approved_refund_total(p_booking uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(total_pence), 0)::integer from public.ad_refund_assessments where booking_id = p_booking and status = 'approved'
$$;

-- ── Funding invariant, approved-refund aware (replaces earlier version) ─
create or replace function ads_internal.booking_funded(p_booking_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ad_bookings b
    join public.ad_payments p on p.id = b.funding_payment_id and p.booking_id = b.id
    join public.ad_purchase_snapshots s on s.booking_id = b.id
    where b.id = p_booking_id and b.status = 'confirmed'
      and p.status in ('paid', 'partially_refunded')
      and p.amount_refunded_pence < p.amount_pence
      and p.amount_refunded_pence <= ads_internal.approved_refund_total(b.id)
      and p.amount_pence = s.total_pence and p.currency = s.currency)
$$;

-- ── RLS / grants: admin-only (advertiser-facing refund status = gap) ────
alter table public.ad_refund_assessments enable row level security;
alter table public.ad_refund_lines enable row level security;
alter table public.ad_refund_processing_events enable row level security;
alter table public.ad_cancellation_cases enable row level security;
create policy ad_refund_assessments_admin on public.ad_refund_assessments for select to authenticated using (public.is_admin_or_above());
create policy ad_refund_lines_admin on public.ad_refund_lines for select to authenticated using (public.is_admin_or_above());
create policy ad_refund_processing_admin on public.ad_refund_processing_events for select to authenticated using (public.is_admin_or_above());
create policy ad_cancellation_cases_admin on public.ad_cancellation_cases for select to authenticated using (public.is_admin_or_above());
revoke all on public.ad_refund_assessments, public.ad_refund_lines, public.ad_refund_processing_events, public.ad_cancellation_cases from anon, authenticated;
grant select on public.ad_refund_assessments, public.ad_refund_lines, public.ad_refund_processing_events, public.ad_cancellation_cases to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname in ('ad_admin_propose_refund', 'ad_admin_cancel_booking', 'ad_admin_propose_cancellation_refund',
                    'ad_admin_decide_refund', 'ad_admin_record_refund_processing'))
              or (n.nspname = 'ads_internal' and p.proname in ('lost_time_refund_pence', 'booked_range', 'multirange_seconds',
                    'approved_refund_total', 'booking_funded')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
grant execute on function public.ad_admin_propose_refund(uuid, boolean, jsonb, text),
  public.ad_admin_cancel_booking(uuid, text), public.ad_admin_cancel_booking(uuid, text, text),
  public.ad_admin_propose_cancellation_refund(uuid, integer, integer, text, text),
  public.ad_admin_decide_refund(uuid, text, text), public.ad_admin_record_refund_processing(uuid, text, text, text, text)
  to authenticated;
