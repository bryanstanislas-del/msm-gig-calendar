-- Ads phase 1 -- review fixes on 9fc02d8 (forward migration on top of
-- 20261016150000). STATUS: NOT APPLIED to any remote database.
--
-- 1. Booking-wide, cross-kind refund invariant. Every proposal and every
--    approval locks the booking row first (same lock order everywhere), so
--    concurrent proposals/approvals serialise.
--     * Separate caps stay: priority fee once and <= the snapshot fee;
--       lost time <= placement charge minus earlier lost time.
--     * Booking ceiling: non-rejected assessments may not exceed the amount
--       paid. A proposal that would exceed it is still RECORDED with its full
--       computed entitlement but gated `exceeds_booking_total` (manual
--       escalation; nothing is erased, nothing over-refunds).
--     * Cross-kind allocation (a service-failure assessment and a
--       cancellation assessment on the same booking, in either order) is
--       unresolved policy: the later proposal is gated
--       `cross_kind_allocation`, and approval refuses while any non-rejected
--       assessment of the other kind exists.
--     * Approval re-validates the booking-wide ceiling and both per-kind caps
--       against APPROVED assessments under the booking lock.
-- 2. Cancellation initiator is captured (msm | advertiser; legacy calls
--    record `undetermined`). Advertiser-cancellation retention (delivered
--    value + evidenced net loss) applies ONLY to advertiser-initiated
--    business cancellations. An MSM-initiated removal may retain no loss
--    (refused) and its assessment is always gated
--    `msm_initiated_cancellation` (refund of undelivered value and any other
--    lawful remedy need a manual decision). Undetermined initiator = gated.
-- 3. Deadline boundaries: end-of-day deadlines (standard initial review,
--    standard correction review, provisional replacement review) are stored
--    as the EXCLUSIVE next-day 00:00 instant -> met only if strictly before.
--    Exact-instant deadlines (12 h priority review, 3 working-hour priority
--    correction review, 3 working-hour correction response) are inclusive.
-- 4. charge.refunded: the partial-refund status note no longer claims
--    delivery is suspended when the refund is within approved assessments.

-- ── 3. Deadline exclusivity ─────────────────────────────────────────────
create or replace function ads_internal.deadline_exclusive(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('initial_standard', 'correction_review_standard', 'replacement_review_provisional')
$$;

create or replace function ads_internal.deadline_met(p_kind text, p_at timestamptz, p_due timestamptz) returns boolean
language sql immutable set search_path = '' as $$
  select case when ads_internal.deadline_exclusive(p_kind) then p_at < p_due else p_at <= p_due end
$$;

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
  select * into d from public.ad_review_deadlines
   where campaign_id = c.id and kind in ('initial_standard', 'initial_priority') order by created_at desc, starts_at desc limit 1;
  select e.event_type, e.occurred_at into first_outcome from public.ad_review_events e
   where e.campaign_id = c.id
     and (e.event_type in ('approved', 'rejected')
          or (e.event_type = 'correction_requested' and e.details ->> 'cause' = 'advertiser_material'))
   order by e.occurred_at, e.id limit 1;
  met := case when d.id is null then null
              when first_outcome.occurred_at is not null then ads_internal.deadline_met(d.kind, first_outcome.occurred_at, d.due_at)
              when not ads_internal.deadline_met(d.kind, ads_internal.clock_now(), d.due_at) then false else null end;
  return jsonb_build_object(
    'booking_id', b.id, 'priority_review', b.priority_review,
    'initial_kind', d.kind, 'initial_started_at', d.starts_at, 'initial_due_at', d.due_at,
    'initial_due_exclusive', ads_internal.deadline_exclusive(d.kind),
    'first_review_outcome', first_outcome.event_type, 'first_review_outcome_at', first_outcome.occurred_at,
    'initial_review_met', met,
    'priority_fee_refund_assessment_needed', (b.priority_review and met is false),
    'deadlines', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'starts_at', x.starts_at, 'due_at', x.due_at,
                            'due_exclusive', ads_internal.deadline_exclusive(x.kind),
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

-- ── 1. Booking-wide refund accounting helpers ───────────────────────────
create or replace function ads_internal.refund_sum(p_booking uuid, p_statuses text[], p_kind text default null, p_line_kind text default null)
returns integer language sql stable security definer set search_path = '' as $$
  select case when p_line_kind is null then
           (select coalesce(sum(a.total_pence), 0) from public.ad_refund_assessments a
             where a.booking_id = p_booking and a.status = any (p_statuses) and (p_kind is null or a.kind = p_kind))
         else
           (select coalesce(sum(l.pence), 0) from public.ad_refund_lines l join public.ad_refund_assessments a on a.id = l.assessment_id
             where a.booking_id = p_booking and a.status = any (p_statuses) and l.kind = p_line_kind)
         end::integer
$$;

-- ── 2. Cancellation initiator ───────────────────────────────────────────
alter table public.ad_cancellation_cases drop constraint ad_cancellation_cases_initiated_by_check;
alter table public.ad_cancellation_cases add constraint ad_cancellation_cases_initiated_by_check
  check (initiated_by in ('msm', 'advertiser', 'undetermined'));
comment on column public.ad_cancellation_cases.initiated_by is 'Who actually initiated the cancellation, as recorded by MSM (advertiser request evidence goes in reason). undetermined = legacy removal; assessment gated.';

drop function public.ad_admin_cancel_booking(uuid, text, text);

create or replace function public.ad_admin_cancel_booking(p_booking_id uuid, p_reason text, p_party_type text, p_initiated_by text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.ad_bookings;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  if p_party_type not in ('business', 'consumer', 'undetermined') then raise exception 'ADS_BAD_PARTY_TYPE'; end if;
  if p_initiated_by is null or p_initiated_by not in ('msm', 'advertiser', 'undetermined') then raise exception 'ADS_BAD_INITIATOR'; end if;
  if p_party_type = 'consumer' then
    raise exception 'ADS_CONSUMER_CANCELLATION_PATH_DISABLED: consumer cancellation needs the reviewed consumer flow (not built)';
  end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  if b.status not in ('held', 'confirmed', 'payment_conflict') then raise exception 'ADS_INVALID_STATE'; end if;
  update public.ad_bookings set status = 'cancelled', closed_at = now(),
         status_reason = case p_initiated_by when 'advertiser' then 'Cancelled at the advertiser''s request'
                                             when 'msm' then 'Removed by MSM' else 'Removed' end
                         || ' (financial assessment separate)'
   where id = b.id;
  insert into public.ad_cancellation_cases (booking_id, initiated_by, party_type, removed_at, removed_by, reason)
  values (b.id, p_initiated_by, p_party_type, ads_internal.clock_now(), auth.uid(), btrim(p_reason));
  perform ads_internal.audit('admin', 'booking', b.id, 'removed',
    jsonb_build_object('reason', p_reason, 'party_type', p_party_type, 'initiated_by', p_initiated_by));
end; $$;

create or replace function public.ad_admin_cancel_booking(p_booking_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  select public.ad_admin_cancel_booking(p_booking_id, p_reason, 'undetermined', 'undetermined')
$$;

-- ── 1. Service-failure proposal with the cross-kind invariant ───────────
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
  purchased := extract(epoch from (upper(booked) - lower(booked)))::bigint;

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

-- ── 1+2. Cancellation proposal: initiator rules + cross-kind invariant ──
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
  v_gates text[] := '{}';
  aid uuid;
  live text[] := array['proposed', 'manual_gate', 'approved'];
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 or p_evidence is null or char_length(btrim(p_evidence)) < 10 then
    raise exception 'ADS_EVIDENCE_REQUIRED';
  end if;
  if p_delivered_value_pence is null or p_net_loss_pence is null or p_delivered_value_pence < 0 or p_net_loss_pence < 0 then
    raise exception 'ADS_BAD_AMOUNT';
  end if;
  select * into b from public.ad_bookings where id = p_booking_id for update;          -- booking lock first
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  select * into k from public.ad_cancellation_cases where booking_id = p_booking_id;
  if not found then raise exception 'ADS_INVALID_STATE: remove the campaign first'; end if;
  if k.initiated_by = 'undetermined' then
    raise exception 'ADS_MANUAL_GATE: record who initiated the cancellation before assessing it';
  end if;
  if k.initiated_by = 'advertiser' and k.party_type <> 'business' then
    raise exception 'ADS_MANUAL_GATE: cancellation assessment needs business status determined on the facts (consumer path disabled)';
  end if;
  if k.initiated_by = 'msm' and p_net_loss_pence > 0 then
    raise exception 'ADS_BAD_AMOUNT: MSM-initiated removal cannot retain advertiser-cancellation losses';
  end if;
  if exists (select 1 from public.ad_refund_assessments where booking_id = b.id and kind = 'cancellation' and status <> 'rejected') then
    raise exception 'ADS_ALREADY_ASSESSED: a cancellation assessment already exists';
  end if;
  select * into s from public.ad_purchase_snapshots where booking_id = b.id;
  paid := s.total_pence;
  retained := p_delivered_value_pence + p_net_loss_pence;
  if retained > paid then raise exception 'ADS_BAD_AMOUNT: retained amount cannot exceed the booking price'; end if;
  previously := ads_internal.refund_sum(b.id, live);
  if k.initiated_by = 'msm' then v_gates := v_gates || 'msm_initiated_cancellation'::text; end if;
  if previously > 0 then v_gates := v_gates || 'cross_kind_allocation'::text; end if;
  if paid - retained - previously < 0 then v_gates := v_gates || 'exceeds_booking_total'::text; end if;
  refund := greatest(paid - retained - previously, 0);
  insert into public.ad_refund_assessments (booking_id, kind, status, total_pence, gates, note, proposed_by, proposed_at)
  values (b.id, 'cancellation', case when cardinality(v_gates) > 0 then 'manual_gate' else 'proposed' end,
          refund, v_gates, btrim(p_note), auth.uid(), ads_internal.clock_now()) returning id into aid;
  insert into public.ad_refund_lines (assessment_id, kind, pence, evidence, details)
  values (aid, 'cancellation_balance', refund, jsonb_build_array(btrim(p_evidence)),
          jsonb_build_object('paid_pence', paid, 'delivered_value_pence', p_delivered_value_pence,
                             'net_loss_pence', p_net_loss_pence, 'previously_assessed_pence', previously,
                             'initiated_by', k.initiated_by, 'party_type', k.party_type,
                             'gross_balance_pence', paid - retained));
  perform ads_internal.audit('admin', 'booking', b.id, 'cancellation_assessment_proposed',
    jsonb_build_object('assessment_id', aid, 'refund_pence', refund, 'gates', v_gates));
  return aid;
end; $$;

-- ── 1. Decision re-validates the booking-wide invariant under lock ──────
create or replace function public.ad_admin_decide_refund(p_assessment_id uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.ad_refund_assessments;
  bid uuid;
  s public.ad_purchase_snapshots;
  t timestamptz := ads_internal.clock_now();
  approved text[] := array['approved'];
  placement integer;
begin
  if not public.is_admin_or_above() then raise exception 'ADS_FORBIDDEN'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'ADS_BAD_DECISION'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception 'ADS_REASON_REQUIRED'; end if;
  select booking_id into bid from public.ad_refund_assessments where id = p_assessment_id;
  if not found then raise exception 'ADS_NOT_FOUND'; end if;
  perform 1 from public.ad_bookings where id = bid for update;                            -- booking lock first
  select * into a from public.ad_refund_assessments where id = p_assessment_id for update;
  if a.status not in ('proposed', 'manual_gate') then raise exception 'ADS_INVALID_STATE: already decided'; end if;
  if p_decision = 'approve' then
    if a.status = 'manual_gate' or cardinality(a.gates) > 0 then
      raise exception 'ADS_MANUAL_GATE: % needs an agreed policy before approval', array_to_string(a.gates, ', ');
    end if;
    if exists (select 1 from public.ad_refund_assessments o where o.booking_id = bid and o.id <> a.id
               and o.kind <> a.kind and o.status <> 'rejected') then
      raise exception 'ADS_MANUAL_GATE: cross_kind_allocation - another kind of assessment is open or approved for this booking';
    end if;
    select * into s from public.ad_purchase_snapshots where booking_id = bid;
    placement := coalesce(s.placement_pence, s.total_pence - s.priority_fee_pence);
    if ads_internal.refund_sum(bid, approved) + a.total_pence > s.total_pence then
      raise exception 'ADS_REFUND_CEILING: approved refunds would exceed the amount paid';
    end if;
    if ads_internal.refund_sum(bid, approved, null, 'priority_fee')
       + (select coalesce(sum(pence), 0) from public.ad_refund_lines where assessment_id = a.id and kind = 'priority_fee') > s.priority_fee_pence then
      raise exception 'ADS_REFUND_CEILING: priority fee refunds would exceed the fee';
    end if;
    if ads_internal.refund_sum(bid, approved, null, 'lost_time')
       + (select coalesce(sum(pence), 0) from public.ad_refund_lines where assessment_id = a.id and kind = 'lost_time') > placement then
      raise exception 'ADS_REFUND_CEILING: lost-time refunds would exceed the placement charge';
    end if;
  end if;
  update public.ad_refund_assessments
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = t, decision_note = btrim(p_note),
         target_pay_by = case when p_decision = 'approve' then t + interval '14 days' end
   where id = a.id;
  perform ads_internal.audit('admin', 'booking', a.booking_id, 'refund_' || p_decision, jsonb_build_object('assessment_id', a.id, 'total_pence', a.total_pence));
end; $$;

-- ── Accurate partial-refund status note (copied forward from
--    20261015120000; only the partial-refund branch changes) ────────────
create or replace function public.ad_apply_stripe_event(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ev_id text := p_event->>'id';
  ev_type text := p_event->>'type';
  ev_live boolean := coalesce((p_event->>'livemode')::boolean, true);
  ev_booking uuid;
  pay public.ad_payments;
  b public.ad_bookings;
  s public.ad_purchase_snapshots;
  units uuid[];
  v_outcome text;
  inserted_id uuid;
  refunded integer;
begin
  if ev_id is null or ev_type is null then raise exception 'ADS_BAD_EVENT'; end if;
  begin
    ev_booking := nullif(p_event->>'booking_id', '')::uuid;
  exception when invalid_text_representation then ev_booking := null;
  end;

  insert into public.ad_payment_events (provider_event_id, event_type, livemode, provider_created_at,
    checkout_session_id, payment_intent_id, booking_id)
  values (ev_id, ev_type, ev_live, to_timestamp(nullif(p_event->>'created', '')::double precision),
    p_event->>'session_id', p_event->>'payment_intent_id', ev_booking)
  on conflict (provider_event_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then return jsonb_build_object('outcome', 'duplicate'); end if;

  if ev_live is distinct from ads_internal.setting_bool('stripe_livemode') then
    v_outcome := 'ignored_mode_mismatch';
  elsif ev_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    select * into pay from public.ad_payments where checkout_session_id = p_event->>'session_id' for update;
    if not found then
      -- Session row missing (e.g. server died after Stripe created it).
      -- Recreate it only from a booking we know, at the snapshot amount.
      select * into s from public.ad_purchase_snapshots where booking_id = ev_booking;
      if not found or (p_event->>'session_id') !~ '^cs_(test|live)_[A-Za-z0-9]+$' then
        v_outcome := 'ignored_unknown_session';
      else
        insert into public.ad_payments (booking_id, livemode, checkout_session_id, amount_pence, currency)
        values (s.booking_id, ev_live, p_event->>'session_id', s.total_pence, s.currency)
        returning * into pay;
      end if;
    end if;
    if v_outcome is null and ev_booking is distinct from pay.booking_id then
      v_outcome := 'ignored_booking_mismatch';
    end if;
    if v_outcome is null and (p_event->>'payment_status') is distinct from 'paid' then
      v_outcome := 'awaiting_async_payment';
    end if;
    if v_outcome is null and ((p_event->>'amount_total')::integer is distinct from pay.amount_pence
                            or lower(p_event->>'currency') is distinct from pay.currency) then
      update public.ad_payments set requires_refund = true where id = pay.id;
      v_outcome := 'amount_mismatch_flagged';
    end if;
    if v_outcome is null and pay.status in ('refunded', 'partially_refunded') then
      v_outcome := 'ignored_already_refunded';
    end if;
    if v_outcome is null and pay.status = 'paid' then
      v_outcome := 'already_applied';
    end if;
    if v_outcome is null then
      update public.ad_payments
        set status = 'paid', paid_at = now(),
            payment_intent_id = coalesce(payment_intent_id, nullif(p_event->>'payment_intent_id', ''))
        where id = pay.id;
      units := ads_internal.lock_units(array(select distinct unit_id from public.ad_booking_inventory_days
                                             where booking_id = pay.booking_id));
      select * into b from public.ad_bookings where id = pay.booking_id for update;
      if b.status = 'held' or b.status = 'expired' then
        if cardinality(ads_internal.full_days(
             units, b.start_date, b.end_date, b.id)) = 0 then
          update public.ad_bookings set status = 'confirmed', confirmed_at = now(), closed_at = null,
            funding_payment_id = pay.id,
            status_reason = case when b.status = 'expired' or b.hold_expires_at <= now()
                                 then 'Paid after hold lapsed; capacity still available' end
            where id = b.id;
          v_outcome := case when b.status = 'held' and b.hold_expires_at > now() then 'confirmed' else 'confirmed_late' end;
          perform ads_internal.refresh_review_state((select id from public.ad_campaigns where booking_id = b.id));
        else
          update public.ad_bookings set status = 'payment_conflict', closed_at = now(),
            status_reason = 'Paid after hold lapsed and inventory was resold; refund required' where id = b.id;
          update public.ad_payments set requires_refund = true where id = pay.id;
          v_outcome := 'payment_conflict_refund_required';
        end if;
      else
        -- confirmed (second payment), cancelled, refunded, payment_conflict
        update public.ad_payments set requires_refund = true where id = pay.id;
        v_outcome := 'unexpected_payment_refund_required';
      end if;
    end if;
  elsif ev_type in ('checkout.session.expired', 'checkout.session.async_payment_failed') then
    update public.ad_payments
      set status = case when ev_type = 'checkout.session.expired' then 'expired' else 'failed' end
      where checkout_session_id = p_event->>'session_id' and status = 'open';
    v_outcome := case when found then 'session_closed' else 'ignored_not_open' end;
  elsif ev_type = 'charge.refunded' then
    select * into pay from public.ad_payments where payment_intent_id = p_event->>'payment_intent_id' for update;
    if not found then
      -- Refund arrived before we learned the payment intent: make Stripe
      -- retry later (whole transaction, including the event row, rolls back).
      raise exception 'ADS_RETRY_LATER: unknown payment intent';
    end if;
    refunded := coalesce((p_event->>'amount_refunded')::integer, 0);
    update public.ad_payments
      set amount_refunded_pence = greatest(amount_refunded_pence, refunded),
          status = case when greatest(amount_refunded_pence, refunded) >= amount_pence then 'refunded' else 'partially_refunded' end,
          requires_refund = case when greatest(amount_refunded_pence, refunded) >= amount_pence then false else requires_refund end
      where id = pay.id returning * into pay;
    -- Only the FUNDING payment's refund changes the booking. A refunded
    -- duplicate/conflict payment leaves a funded booking untouched; an
    -- unfunded booking (payment_conflict/held/expired) closes as refunded.
    if pay.status = 'refunded' then
      update public.ad_bookings set status = 'refunded', closed_at = now(), status_reason = 'Payment refunded'
        where id = pay.booking_id
          and (funding_payment_id = pay.id
               or (funding_payment_id is null and status in ('payment_conflict', 'held', 'expired', 'cancelled')));
      v_outcome := case when found then 'refunded' else 'non_funding_payment_refunded' end;
    else
      -- Within APPROVED refund assessments (e.g. a missed priority fee) the
      -- booking stays funded and keeps running; beyond them it is suspended.
      update public.ad_bookings
        set status_reason = case when ads_internal.booking_funded(pay.booking_id)
              then 'Funding payment partially refunded within approved refund assessments: delivery and approval continue'
              else 'Funding payment partially refunded beyond approved refund assessments: delivery and approval suspended pending MSM decision' end
        where id = pay.booking_id and funding_payment_id = pay.id;
      v_outcome := case when found and ads_internal.booking_funded(pay.booking_id) then 'partially_refunded_within_approved'
                        else 'partially_refunded_flagged' end;
    end if;
  else
    v_outcome := 'ignored_type';
  end if;

  update public.ad_payment_events set outcome = v_outcome, booking_id = coalesce(booking_id, pay.booking_id)
    where id = inserted_id;
  perform ads_internal.audit('stripe', 'booking', coalesce(pay.booking_id, ev_booking), 'stripe_event',
    jsonb_build_object('event', ev_id, 'type', ev_type, 'outcome', v_outcome));
  return jsonb_build_object('outcome', v_outcome);
end; $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname in ('ad_admin_propose_refund', 'ad_admin_cancel_booking', 'ad_admin_propose_cancellation_refund',
                    'ad_admin_decide_refund', 'ad_review_sla'))
              or (n.nspname = 'ads_internal' and p.proname in ('deadline_exclusive', 'deadline_met', 'refund_sum')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
grant execute on function public.ad_admin_propose_refund(uuid, boolean, jsonb, text),
  public.ad_admin_cancel_booking(uuid, text), public.ad_admin_cancel_booking(uuid, text, text, text),
  public.ad_admin_propose_cancellation_refund(uuid, integer, integer, text, text),
  public.ad_admin_decide_refund(uuid, text, text), public.ad_review_sla(uuid)
  to authenticated;
