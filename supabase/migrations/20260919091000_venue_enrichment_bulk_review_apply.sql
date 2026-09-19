-- Venue Data Enrichment, Phase 5D: venue-level bulk Approve/Apply.
--
-- SCOPE: adds exactly two new SECURITY DEFINER functions,
-- approve_all_safe_candidates_for_venue and
-- apply_all_approved_candidates_for_venue. Neither existing individual RPC
-- (approve_venue_enrichment_candidate / reject_venue_enrichment_candidate /
-- apply_venue_enrichment_candidate, all three from the Phase 3C/4B
-- migrations) is modified in any way by this migration -- both new
-- functions below WORK BY CALLING THE EXISTING ONES, once per eligible
-- candidate, inside their own transaction, rather than re-implementing the
-- stale-check/field-allow-list/activity_log logic a second time. This is a
-- deliberate design choice, not an oversight: every safety property the
-- individual RPCs already have (admin gate, stale-at-approve/apply
-- re-check, exact 14-field allow-list, one activity_log row per real
-- transition, idempotency) is inherited for free and can never drift from
-- the single-candidate behaviour, because it IS the single-candidate
-- behaviour, invoked in a loop.
--
-- THIS IS NOT GLOBAL BULK APPROVAL. Both functions are strictly
-- venue-scoped (p_venue_id is a required, non-optional parameter; the
-- ONLY candidates ever touched are the ones with that exact venue_id) and
-- administrator-initiated (same is_admin_or_above() gate as every other
-- RPC in this feature, checked FIRST, before any row is read).
--
-- ── Eligibility (see 20260919090000_venue_enrichment_manual_review_flag.sql
-- for the full rationale) -- BOTH functions below refuse to process a
-- venue's candidates AT ALL (zero candidates touched, one venue-level
-- activity_log entry recording the refusal) when:
--   - the venue does not exist
--   - the venue is claimed
--   - the venue carries venue_enrichment_manual_review = true
-- This is a genuinely NEW protection for the bulk-approve path specifically
-- -- the existing single-candidate approve_venue_enrichment_candidate has
-- never needed a claimed-venue check (approving a suggestion never writes
-- to public.venues), but the venue-scoped bulk operation this migration
-- adds is held to the same claimed-venue standard as Apply, out of caution
-- for a feature that can affect many fields on one venue at once.
--
-- ── Transaction semantics (the Phase 5D task's own "CRITICAL MULTI-FIELD
-- TRANSACTION TEST" requirement) -- read this before touching either
-- function body:
--   A STALE CANDIDATE (an EXPECTED business condition: the live venue value
--   moved on since research) is handled by the delegated single-candidate
--   RPC returning a normal 'stale_conflict' JSON result, not by raising --
--   exactly the individual RPCs' own existing behaviour. The loop below
--   simply tallies that outcome and continues to the next candidate. A
--   stale candidate for venue V never prevents another, non-stale
--   candidate for the SAME venue V from being processed in the same bulk
--   call.
--
--   AN UNEXPECTED SQL ERROR (the delegated RPC actually RAISEs -- e.g. the
--   defensive "venue not found" branch, or apply_venue_enrichment_
--   candidate's own uncaught ::integer cast failure on a malformed capacity
--   suggested_value) is NOT caught anywhere in the loop below. Because the
--   entire bulk function body runs as one Postgres statement/transaction,
--   an uncaught exception aborts and rolls back EVERYTHING this bulk call
--   has done so far -- including candidates already approved/applied
--   earlier in the very same loop iteration. This is deliberate: it is the
--   only way to guarantee the three invariants the task calls out --
--   "candidate says applied but venue field was not changed" and "venue
--   field changed but candidate did not become applied" are both
--   structurally impossible (a rolled-back transaction has neither), and
--   "unrelated venues are affected" is already impossible independently
--   (the loop only ever selects candidates with venue_id = p_venue_id).
--   venue_enrichment_bulk_review_apply_regression.sql's "CRITICAL
--   MULTI-FIELD TRANSACTION TEST" section proves both halves of this
--   directly: a stale sibling candidate does not block its safe siblings,
--   and an unexpected failure on one candidate rolls back every candidate
--   (safe or otherwise) touched earlier in that same bulk call, leaving
--   public.venues completely untouched for that venue.
--
-- ── Idempotency: calling either bulk function again after a first call
-- re-selects only the candidates still in the relevant starting status
-- (pending for approve, approved for apply) -- candidates the first call
-- already moved to approved/applied/stale_conflict are no longer selected
-- at all on a second call, so eligible_count naturally drops to 0 for them
-- and nothing is re-processed or re-logged. This is a direct, structural
-- consequence of the WHERE clause plus the delegated RPCs' own existing
-- idempotency, not new logic.

create or replace function public.approve_all_safe_candidates_for_venue(
  p_venue_id uuid,
  p_review_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_venue public.venues;
  v_candidate_id uuid;
  v_result jsonb;
  v_eligible_count int := 0;
  v_approved_count int := 0;
  v_stale_count int := 0;
  v_skipped_count int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can review venue enrichment candidates';
  end if;

  -- Row-locked for the remainder of this transaction, exactly like every
  -- other RPC in this feature that touches a venue row -- a concurrent
  -- claim, unclaim, or manual-review-flag change on this SAME venue blocks
  -- here until this call commits or rolls back.
  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue is null then
    raise exception 'Venue % not found', p_venue_id;
  end if;

  if v_venue.claimed then
    insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
    values ('venue_enrichment_bulk_approve_blocked_claimed_venue', 'venue', p_venue_id, v_venue.name, auth.uid());
    return jsonb_build_object(
      'outcome', 'blocked_claimed_venue',
      'venue_id', p_venue_id,
      'eligible_count', 0, 'approved_count', 0, 'stale_count', 0, 'skipped_count', 0,
      'candidates', '[]'::jsonb
    );
  end if;

  if v_venue.venue_enrichment_manual_review then
    insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
    values ('venue_enrichment_bulk_approve_blocked_manual_review', 'venue', p_venue_id, v_venue.name, auth.uid());
    return jsonb_build_object(
      'outcome', 'blocked_manual_review',
      'venue_id', p_venue_id,
      'eligible_count', 0, 'approved_count', 0, 'stale_count', 0, 'skipped_count', 0,
      'candidates', '[]'::jsonb
    );
  end if;

  -- Exact venue scoping + exact candidate status check: ONLY this venue's
  -- OWN pending candidates are ever considered. Ordered by field for a
  -- deterministic, human-readable candidates[] result order -- not a
  -- correctness requirement.
  for v_candidate_id in
    select id from public.venue_enrichment_candidates
    where venue_id = p_venue_id and status = 'pending'
    order by field
  loop
    v_eligible_count := v_eligible_count + 1;

    -- Delegates to the existing, unmodified single-candidate RPC -- same
    -- admin gate (redundant here but harmless; defence in depth), same
    -- stale/current-value validation, same reviewed_by/reviewed_at
    -- stamping, same one-activity_log-row-per-transition behaviour, same
    -- idempotency. No dynamic SQL anywhere in this function.
    select public.approve_venue_enrichment_candidate(v_candidate_id, p_review_notes) into v_result;

    if v_result->>'outcome' = 'approved' then
      v_approved_count := v_approved_count + 1;
    elsif v_result->>'outcome' = 'stale_conflict' then
      v_stale_count := v_stale_count + 1;
    else
      -- already_in_requested_state / already_reviewed -- a safe no-op the
      -- delegated RPC itself already handled idempotently.
      v_skipped_count := v_skipped_count + 1;
    end if;

    v_details := v_details || jsonb_build_object(
      'candidate_id', v_candidate_id,
      'outcome', v_result->>'outcome'
    );
  end loop;

  return jsonb_build_object(
    'outcome', 'completed',
    'venue_id', p_venue_id,
    'eligible_count', v_eligible_count,
    'approved_count', v_approved_count,
    'stale_count', v_stale_count,
    'skipped_count', v_skipped_count,
    'candidates', v_details
  );
end;
$function$;

create or replace function public.apply_all_approved_candidates_for_venue(
  p_venue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_venue public.venues;
  v_candidate_id uuid;
  v_result jsonb;
  v_eligible_count int := 0;
  v_applied_count int := 0;
  v_stale_count int := 0;
  v_skipped_count int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can apply venue enrichment candidates';
  end if;

  select * into v_venue from public.venues where id = p_venue_id for update;
  if v_venue is null then
    raise exception 'Venue % not found', p_venue_id;
  end if;

  if v_venue.claimed then
    insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
    values ('venue_enrichment_bulk_apply_blocked_claimed_venue', 'venue', p_venue_id, v_venue.name, auth.uid());
    return jsonb_build_object(
      'outcome', 'blocked_claimed_venue',
      'venue_id', p_venue_id,
      'eligible_count', 0, 'applied_count', 0, 'stale_count', 0, 'skipped_count', 0,
      'candidates', '[]'::jsonb
    );
  end if;

  if v_venue.venue_enrichment_manual_review then
    insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
    values ('venue_enrichment_bulk_apply_blocked_manual_review', 'venue', p_venue_id, v_venue.name, auth.uid());
    return jsonb_build_object(
      'outcome', 'blocked_manual_review',
      'venue_id', p_venue_id,
      'eligible_count', 0, 'applied_count', 0, 'stale_count', 0, 'skipped_count', 0,
      'candidates', '[]'::jsonb
    );
  end if;

  -- Exact venue scoping + exact candidate status check: ONLY this venue's
  -- OWN approved candidates are ever considered.
  for v_candidate_id in
    select id from public.venue_enrichment_candidates
    where venue_id = p_venue_id and status = 'approved'
    order by field
  loop
    v_eligible_count := v_eligible_count + 1;

    -- Delegates to the existing, unmodified single-candidate Apply RPC --
    -- same admin gate, same apply-time stale re-check, same claimed-venue
    -- re-check (structurally unreachable here since this function already
    -- refused above if v_venue.claimed, but left in the delegate as its
    -- own independent defence in depth rather than assumed), same explicit
    -- 14-field allow-list (no dynamic SQL, here or in the delegate), same
    -- "becomes applied only after the venues UPDATE already succeeded"
    -- ordering, same one-activity_log-row-per-transition behaviour, same
    -- idempotency.
    select public.apply_venue_enrichment_candidate(v_candidate_id) into v_result;

    if v_result->>'outcome' = 'applied' then
      v_applied_count := v_applied_count + 1;
    elsif v_result->>'outcome' = 'stale_conflict' then
      v_stale_count := v_stale_count + 1;
    else
      -- already_in_requested_state / already_reviewed / blocked_claimed_venue
      -- (the last is structurally unreachable given the venue-level check
      -- above, but classified here rather than assumed impossible).
      v_skipped_count := v_skipped_count + 1;
    end if;

    v_details := v_details || jsonb_build_object(
      'candidate_id', v_candidate_id,
      'outcome', v_result->>'outcome'
    );
  end loop;

  return jsonb_build_object(
    'outcome', 'completed',
    'venue_id', p_venue_id,
    'eligible_count', v_eligible_count,
    'applied_count', v_applied_count,
    'stale_count', v_stale_count,
    'skipped_count', v_skipped_count,
    'candidates', v_details
  );
end;
$function$;

-- ── Grants ────────────────────────────────────────────────────────────────
-- Same three-statement pattern the Phase 4B apply migration itself learned
-- from Phase 3C's two separate corrective production migrations: the
-- authenticated grant, the anon revoke, AND the PUBLIC revoke, all in this
-- one migration, not split across a later hardening follow-up.
grant execute on function public.approve_all_safe_candidates_for_venue(uuid, text) to authenticated;
revoke execute on function public.approve_all_safe_candidates_for_venue(uuid, text) from anon;
revoke execute on function public.approve_all_safe_candidates_for_venue(uuid, text) from public;

grant execute on function public.apply_all_approved_candidates_for_venue(uuid) to authenticated;
revoke execute on function public.apply_all_approved_candidates_for_venue(uuid) from anon;
revoke execute on function public.apply_all_approved_candidates_for_venue(uuid) from public;

comment on function public.approve_all_safe_candidates_for_venue(uuid, text) is
  'Phase 5D: admin-only venue-scoped bulk approval of every PENDING venue_enrichment_candidates row for one venue. Refuses (zero candidates touched) if the venue is claimed, manual-review-flagged, or missing. Delegates per-candidate to the unmodified approve_venue_enrichment_candidate, so stale-value protection, provenance, and per-candidate activity_log behaviour are identical to individual approval. An unexpected error rolls back the whole call (including any candidates already approved earlier in the same call); a stale sibling candidate does not block the rest.';
comment on function public.apply_all_approved_candidates_for_venue(uuid) is
  'Phase 5D: admin-only venue-scoped bulk application of every APPROVED venue_enrichment_candidates row for one venue. Refuses (zero candidates touched) if the venue is claimed, manual-review-flagged, or missing. Delegates per-candidate to the unmodified apply_venue_enrichment_candidate, so the exact 14-field allow-list, apply-time stale re-check, and per-candidate activity_log behaviour are identical to individual apply. An unexpected error rolls back the whole call (including any fields already applied earlier in the same call); a stale sibling candidate does not block the rest.';
