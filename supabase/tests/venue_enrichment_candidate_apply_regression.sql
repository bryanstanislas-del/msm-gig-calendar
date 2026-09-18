-- Regression proof for Phase 4B (individual Apply of an already-APPROVED
-- venue_enrichment_candidates row to the live public.venues row it
-- targets) -- see migration
-- 20260918170000_venue_enrichment_candidate_apply.sql for the full
-- rationale.
--
-- Same convention as venue_enrichment_candidates_review_regression.sql
-- (Phase 3C): does NOT redefine the base table or apply_venue_enrichment_
-- candidate() from scratch. Assumes it is run against a database that
-- already has ALL FOUR of 20260918120000_venue_enrichment_candidates.sql,
-- 20260918150000_venue_enrichment_candidates_review.sql,
-- 20260918160000_venue_enrichment_review_revoke_public.sql, AND
-- 20260918170000_venue_enrichment_candidate_apply.sql applied -- exactly
-- what `supabase start` + `supabase db reset` gives locally by
-- construction.
--
-- MUST NEVER be run directly against production, even wrapped in
-- BEGIN...ROLLBACK -- this file mutates real public.venues rows (albeit
-- ZZTEST fixtures) and exercises role-based RLS/RPC denial and allow
-- paths, exactly the category of test venue_enrichment_candidates_
-- regression.sql's and venue_enrichment_candidates_review_regression.sql's
-- own header comments already warn production must never be used for.
-- Run it only against a local/disposable database:
--   psql "$LOCAL_DATABASE_URL" -f supabase/tests/venue_enrichment_candidate_apply_regression.sql
--
-- NOT executed against any database as part of this PR -- production
-- migration application requires separate, explicit authorisation after
-- review. Written now so it is ready to run the moment this migration is
-- applied somewhere safe to do so.
--
-- Every check RAISEs EXCEPTION with a distinct message on failure, so a
-- clean "NOTICE: venue_enrichment_candidate_apply Phase 4B regression: ALL
-- CHECKS PASSED" (with the final ROLLBACK) is the signal. Uses
-- ZZTEST-prefixed names throughout. Checks are numbered to match the
-- Phase 4B implementation task's own 36-scenario list; a few numbers share
-- one code block where they are naturally the same assertion (e.g. 1/34,
-- 2/35, 3/36 each assert the same grant via two independent methods --
-- see the "Grant-layer ACL" section near the end for why both a
-- behavioural role-switch AND a static has_function_privilege() check are
-- both kept, deliberately not relying on has_function_privilege() alone
-- nor on role-switching alone).

begin;

do $$
declare
  u_admin uuid; u_fan uuid;
  p_admin uuid; p_fan uuid;
  v_id uuid;          -- ordinary unclaimed ZZTEST venue
  v_claimed uuid;      -- claimed ZZTEST venue
  v_orphan uuid;        -- venue deliberately orphaned mid-test (see check 29)
  v_field_venue uuid;
  c_approved uuid;      -- applies cleanly (existing_value matches live venue value)
  c_pending uuid;
  c_rejected uuid;
  c_skip_no_source uuid;
  c_skip_ambiguous uuid;
  c_stale_conflict uuid; -- already stale_conflict before this test even starts
  c_applied_already uuid;
  c_stale_at_apply uuid;  -- existing_value deliberately does NOT match live venue value
  c_capacity_ok uuid;
  c_capacity_invalid uuid;
  c_claimed uuid;
  c_orphan uuid;
  v_field_candidate uuid;
  v_missing_id uuid := gen_random_uuid();
  v_result jsonb;
  v_row public.venue_enrichment_candidates;
  v_venue_before public.venues;
  v_after_venue public.venues;
  v_before_ts timestamptz;
  v_log_count int;
  v_rowcount int;
  v_field_actual text;
  rec record;
begin
  -- ── Fixtures ──────────────────────────────────────────────────────────
  insert into public.venues (name, city, postcode, phone, capacity, claimed, claim_status)
  values ('ZZTEST Venue 4B', 'ZZTEST City', 'SO14 3AB', null, 300, false, 'unclaimed')
  returning id into v_id;

  insert into public.venues (name, city, phone, claimed, claim_status)
  values ('ZZTEST Claimed Venue 4B', 'ZZTEST City', null, true, 'claimed')
  returning id into v_claimed;

  insert into public.venues (name, city, phone, claimed, claim_status)
  values ('ZZTEST Orphan Venue 4B', 'ZZTEST City', null, false, 'unclaimed')
  returning id into v_orphan;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_admin;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_fan;

  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Admin 4B', u_admin, false, 'unclaimed', false, 'band', 'admin') returning id into p_admin;
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Fan 4B', u_fan, false, 'unclaimed', false, 'band', null) returning id into p_fan;

  v_before_ts := clock_timestamp();

  -- c_approved: phone existing_value NULL matches the venue's live phone
  -- (NULL) -- a clean, safe apply.
  insert into public.venue_enrichment_candidates
    (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at, review_notes)
  values (v_id, 'phone', null, '02380000001', 'official_site', 'HIGH', 'ZZTEST', 'approved', 'ZZTEST-4B-BATCH-001', u_admin, v_before_ts, 'looked right')
  returning id into c_approved;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_id, 'website', null, 'https://zztest.example.test', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-4B-BATCH-001') returning id into c_pending;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_id, 'instagram', null, 'https://instagram.test/zztest', 'official_site', 'MEDIUM', 'ZZTEST', 'rejected', 'ZZTEST-4B-BATCH-001', u_admin, now()) returning id into c_rejected;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, status, batch_id)
  values (v_id, 'facebook', null, null, 'skipped_no_source', 'ZZTEST-4B-BATCH-001') returning id into c_skip_no_source;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, status, batch_id)
  values (v_id, 'twitter', null, null, 'skipped_ambiguous', 'ZZTEST-4B-BATCH-001') returning id into c_skip_ambiguous;

  -- Crafted directly (the reviewed-pairing constraint allows stale_conflict
  -- with NULL reviewed_by/reviewed_at, matching how approval-time
  -- staleness leaves it) to prove Apply also refuses an already-
  -- stale_conflict row outright.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_id, 'seo_title', 'old title', 'ZZTEST new title', 'generated', 'MEDIUM', 'ZZTEST', 'stale_conflict', 'ZZTEST-4B-BATCH-001') returning id into c_stale_conflict;

  -- 'applied' crafted directly with reviewer metadata set, matching what a
  -- real apply would leave behind -- used only for the idempotent-retry
  -- check, not to prove the state was reached via a real transition.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_id, 'description', null, 'ZZTEST description', 'generated', 'MEDIUM', 'ZZTEST', 'applied', 'ZZTEST-4B-BATCH-001', u_admin, now()) returning id into c_applied_already;

  -- c_stale_at_apply: existing_value 'SO14 1AA' does NOT match the venue's
  -- actual live postcode ('SO14 3AB' set above) -- proves the apply-time
  -- re-check fires even though this candidate is already 'approved'.
  insert into public.venue_enrichment_candidates
    (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_id, 'postcode', 'SO14 1AA', 'SO14 9ZZ', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-4B-BATCH-001', u_admin, v_before_ts)
  returning id into c_stale_at_apply;

  -- c_capacity_ok: existing_value '300' (text) must compare equal to the
  -- live integer 300 via the same ::text cast approve already uses --
  -- proves apply's own re-check has no false stale positive here either.
  insert into public.venue_enrichment_candidates
    (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_id, 'capacity', '300', '350', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-4B-BATCH-001', u_admin, v_before_ts)
  returning id into c_capacity_ok;

  -- c_capacity_invalid: suggested_value cannot be cast to integer -- must
  -- abort/rollback the whole apply attempt, no partial write.
  -- Distinct batch_id from c_capacity_ok above -- both target the same
  -- (venue_id, field), and venue_enrichment_candidates_unique_per_batch
  -- only allows one row per (venue_id, field, batch_id).
  insert into public.venue_enrichment_candidates
    (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_id, 'capacity', '300', 'not-a-number', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-4B-BATCH-002', u_admin, v_before_ts)
  returning id into c_capacity_invalid;

  -- c_claimed: targets the claimed venue -- existing_value NULL matches
  -- its live phone (NULL), so the ONLY reason this must not apply is the
  -- claimed gate, not staleness.
  insert into public.venue_enrichment_candidates
    (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_claimed, 'phone', null, '07000000000', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-4B-BATCH-001', u_admin, v_before_ts)
  returning id into c_claimed;

  -- c_orphan: targets v_orphan, which is deliberately deleted (bypassing
  -- FK RESTRICT via a trigger-disable, see check 29 below) after this
  -- insert so apply must hit its defensive "venue not found" branch --
  -- otherwise structurally unreachable, since the real FK prevents a
  -- venue from ever being deleted while a candidate still references it.
  insert into public.venue_enrichment_candidates
    (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_orphan, 'phone', null, '07111111111', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-4B-BATCH-001', u_admin, v_before_ts)
  returning id into c_orphan;

  -- ── 2. anon cannot execute -- fails at the grant level (42501/
  --       insufficient_privilege) before the function body's own admin
  --       check ever runs. ─────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.apply_venue_enrichment_candidate(c_approved);
    raise exception 'FAIL 2: anon was able to call apply_venue_enrichment_candidate, expected EXECUTE to be denied';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── 3/4. authenticated has execute (reaches the function body) but a
  --         non-admin is rejected INTERNALLY, not at the grant layer -- a
  --         mis-granted EXECUTE would silently turn this into the wrong
  --         kind of "pass", so the two failure modes are told apart. ──────
  perform set_config('request.jwt.claims', json_build_object('sub', u_fan)::text, true);
  set local role authenticated;
  begin
    perform public.apply_venue_enrichment_candidate(c_approved);
    raise exception 'FAIL 4: non-admin authenticated user was able to apply, expected the function''s own admin check to raise';
  exception when others then
    if sqlerrm not like '%Only admins can apply%' then
      raise exception 'FAIL 4b: non-admin apply failed for the wrong reason: %', sqlerrm;
    end if;
  end;
  reset role;
  select * into v_row from public.venue_enrichment_candidates where id = c_approved;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 4c: a denied non-admin apply attempt mutated candidate %, expected no change', c_approved;
  end if;

  -- ── 14/15/16/17. pending/rejected/skipped_no_source/skipped_ambiguous
  --                 cannot be applied. ────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  begin
    perform public.apply_venue_enrichment_candidate(c_pending);
    raise exception 'FAIL 14: a pending candidate was applied, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be approved%' then raise exception 'FAIL 14b: wrong failure reason: %', sqlerrm; end if;
  end;
  begin
    perform public.apply_venue_enrichment_candidate(c_rejected);
    raise exception 'FAIL 15: a rejected candidate was applied, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be approved%' then raise exception 'FAIL 15b: wrong failure reason: %', sqlerrm; end if;
  end;
  begin
    perform public.apply_venue_enrichment_candidate(c_skip_no_source);
    raise exception 'FAIL 16: a skipped_no_source candidate was applied, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be approved%' then raise exception 'FAIL 16b: wrong failure reason: %', sqlerrm; end if;
  end;
  begin
    perform public.apply_venue_enrichment_candidate(c_skip_ambiguous);
    raise exception 'FAIL 17: a skipped_ambiguous candidate was applied, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be approved%' then raise exception 'FAIL 17b: wrong failure reason: %', sqlerrm; end if;
  end;

  -- ── 18. stale_conflict cannot apply. ────────────────────────────────────
  begin
    perform public.apply_venue_enrichment_candidate(c_stale_conflict);
    raise exception 'FAIL 18: a stale_conflict candidate was applied, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be approved%' then raise exception 'FAIL 18b: wrong failure reason: %', sqlerrm; end if;
  end;

  -- ── 28. Missing candidate rejected. ─────────────────────────────────────
  begin
    perform public.apply_venue_enrichment_candidate(v_missing_id);
    raise exception 'FAIL 28: applying a non-existent candidate id succeeded, expected "not found"';
  exception when others then
    if sqlerrm not like '%not found%' then raise exception 'FAIL 28b: wrong failure reason: %', sqlerrm; end if;
  end;

  -- ── 22/23. Claimed venue blocks apply; the block leaves the candidate
  --           exactly 'approved' (not moved to any terminal state). ───────
  select public.apply_venue_enrichment_candidate(c_claimed) into v_result;
  if v_result->>'outcome' <> 'blocked_claimed_venue' then
    raise exception 'FAIL 22: applying a candidate against a claimed venue returned outcome %, expected blocked_claimed_venue', v_result->>'outcome';
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_claimed;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 23: candidate % status is % after a claimed-venue block, expected it to remain approved', c_claimed, v_row.status;
  end if;
  select * into v_after_venue from public.venues where id = v_claimed;
  if v_after_venue.phone is not null then
    raise exception 'FAIL 22c: public.venues row for the claimed venue % was modified despite the claimed-venue block', v_claimed;
  end if;
  -- ── 24. Claimed block audit written. ────────────────────────────────────
  if not exists (
    select 1 from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id = c_claimed
      and action = 'venue_enrichment_candidate_apply_blocked_claimed_venue' and performed_by = u_admin
  ) then
    raise exception 'FAIL 24: no venue_enrichment_candidate_apply_blocked_claimed_venue activity_log row found for candidate %', c_claimed;
  end if;

  -- ── 19/20/21. Live drift at apply time: no venues write, candidate moves
  --              to stale_conflict, and the stale-at-apply audit event is
  --              written -- reviewer/provenance metadata is deliberately
  --              NOT destroyed (unlike the approval-time stale branch,
  --              where reviewed_by/reviewed_at were never set to begin
  --              with). ─────────────────────────────────────────────────
  select public.apply_venue_enrichment_candidate(c_stale_at_apply) into v_result;
  if v_result->>'outcome' <> 'stale_conflict' then
    raise exception 'FAIL 19: applying a candidate whose existing_value ("SO14 1AA") no longer matches the live venue postcode ("SO14 3AB") returned outcome %, expected stale_conflict', v_result->>'outcome';
  end if;
  if (v_result->>'live_value') <> 'SO14 3AB' then
    raise exception 'FAIL 19b: stale_conflict result reported live_value %, expected the venue''s actual current postcode', v_result->>'live_value';
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_stale_at_apply;
  if v_row.status <> 'stale_conflict' then
    raise exception 'FAIL 20: candidate % status is % after the apply-time stale attempt, expected stale_conflict to have been durably written', c_stale_at_apply, v_row.status;
  end if;
  if v_row.reviewed_by is distinct from u_admin or v_row.reviewed_at is distinct from v_before_ts then
    raise exception 'FAIL 20c: apply-time stale_conflict destroyed reviewer/provenance metadata on candidate % (reviewed_by=%, reviewed_at=%), expected them retained from the original approval', c_stale_at_apply, v_row.reviewed_by, v_row.reviewed_at;
  end if;
  select * into v_after_venue from public.venues where id = v_id;
  if v_after_venue.postcode is distinct from 'SO14 3AB' then
    raise exception 'FAIL 19c: public.venues postcode for % was modified by a stale apply attempt, expected untouched', v_id;
  end if;
  if not exists (
    select 1 from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id = c_stale_at_apply
      and action = 'venue_enrichment_candidate_stale_at_apply_detected' and performed_by = u_admin
  ) then
    raise exception 'FAIL 21: no venue_enrichment_candidate_stale_at_apply_detected activity_log row found for candidate %', c_stale_at_apply;
  end if;

  -- ── 25/26. capacity: valid conversion succeeds; an invalid one rolls
  --           back the ENTIRE attempt cleanly (no partial write, candidate
  --           stays approved, public.venues.capacity untouched). ──────────
  select public.apply_venue_enrichment_candidate(c_capacity_ok) into v_result;
  if v_result->>'outcome' <> 'applied' then
    raise exception 'FAIL 25: capacity candidate (existing_value ''300'' vs live integer 300) returned outcome %, expected applied', v_result->>'outcome';
  end if;
  select * into v_after_venue from public.venues where id = v_id;
  if v_after_venue.capacity is distinct from 350 then
    raise exception 'FAIL 25b: public.venues.capacity for % is %, expected 350 after applying c_capacity_ok', v_id, v_after_venue.capacity;
  end if;

  begin
    perform public.apply_venue_enrichment_candidate(c_capacity_invalid);
    raise exception 'FAIL 26: applying a non-numeric capacity suggested_value succeeded, expected the ::integer cast to raise and roll back';
  exception when others then
    if sqlerrm not like '%invalid input syntax%' then
      raise exception 'FAIL 26b: capacity conversion failed for an unexpected reason: %', sqlerrm;
    end if;
  end;
  select * into v_row from public.venue_enrichment_candidates where id = c_capacity_invalid;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 26c: candidate % status is % after a rolled-back capacity conversion failure, expected it to remain approved', c_capacity_invalid, v_row.status;
  end if;
  select * into v_after_venue from public.venues where id = v_id;
  if v_after_venue.capacity is distinct from 350 then
    raise exception 'FAIL 26d: public.venues.capacity for % changed to % from a rolled-back apply attempt, expected it to remain 350 (unaffected by the failed c_capacity_invalid attempt)', v_id, v_after_venue.capacity;
  end if;

  -- ── 5/6/7/8/9/10/11. Admin safe approved apply succeeds: exact field
  --                     updated, no unrelated field updated, candidate
  --                     becomes applied, reviewer/provenance retained,
  --                     success activity_log written exactly once. ───────
  select * into v_venue_before from public.venues where id = v_id;
  select public.apply_venue_enrichment_candidate(c_approved) into v_result;
  if v_result->>'outcome' <> 'applied' then
    raise exception 'FAIL 5: admin apply of a safe approved candidate returned outcome %, expected applied', v_result->>'outcome';
  end if;
  if (v_result->>'applied_value') <> '02380000001' then
    raise exception 'FAIL 5b: apply result applied_value is %, expected 02380000001', v_result->>'applied_value';
  end if;

  select * into v_after_venue from public.venues where id = v_id;
  if v_after_venue.phone is distinct from '02380000001' then
    raise exception 'FAIL 6: public.venues.phone for % is %, expected 02380000001', v_id, v_after_venue.phone;
  end if;
  if v_after_venue.postcode is distinct from v_venue_before.postcode
     or v_after_venue.website is distinct from v_venue_before.website
     or v_after_venue.address is distinct from v_venue_before.address
     or v_after_venue.capacity is distinct from v_venue_before.capacity
     or v_after_venue.facebook is distinct from v_venue_before.facebook
     or v_after_venue.instagram is distinct from v_venue_before.instagram
     or v_after_venue.twitter is distinct from v_venue_before.twitter
     or v_after_venue.description is distinct from v_venue_before.description
     or v_after_venue.photo_url is distinct from v_venue_before.photo_url
     or v_after_venue.seo_title is distinct from v_venue_before.seo_title
     or v_after_venue.seo_description is distinct from v_venue_before.seo_description
     or v_after_venue.seo_search_phrases is distinct from v_venue_before.seo_search_phrases
     or v_after_venue.contact_email is distinct from v_venue_before.contact_email
  then
    raise exception 'FAIL 7: applying candidate % (field=phone) changed an unrelated public.venues column', c_approved;
  end if;

  select * into v_row from public.venue_enrichment_candidates where id = c_approved;
  if v_row.status <> 'applied' then
    raise exception 'FAIL 8: candidate % status is % after a successful apply, expected applied', c_approved, v_row.status;
  end if;
  if v_row.reviewed_by is distinct from u_admin or v_row.reviewed_at is distinct from v_before_ts then
    raise exception 'FAIL 9: successful apply lost reviewer metadata on candidate % (reviewed_by=%, reviewed_at=%), expected the original approval''s own values retained', c_approved, v_row.reviewed_by, v_row.reviewed_at;
  end if;
  if v_row.review_notes is distinct from 'looked right' or v_row.suggested_value is distinct from '02380000001' or v_row.source_type is distinct from 'official_site' or v_row.confidence is distinct from 'HIGH' then
    raise exception 'FAIL 10: successful apply lost provenance on candidate % (review_notes=%, suggested_value=%, source_type=%, confidence=%), expected all retained unchanged', c_approved, v_row.review_notes, v_row.suggested_value, v_row.source_type, v_row.confidence;
  end if;

  select count(*) into v_log_count from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id = c_approved and action = 'venue_enrichment_candidate_applied';
  if v_log_count <> 1 then
    raise exception 'FAIL 11: expected exactly 1 venue_enrichment_candidate_applied activity_log row for candidate %, found %', c_approved, v_log_count;
  end if;
  -- What must NOT be logged: researched content itself.
  if exists (
    select 1 from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id = c_approved
      and entity_name ilike '%02380000001%'
  ) then
    raise exception 'FAIL 11b: the applied activity_log entity_name leaked the applied suggested_value, expected only field/batch_id';
  end if;

  -- ── 12/13. Retry already-applied is idempotent, and does not duplicate
  --           the activity_log. ──────────────────────────────────────────
  select public.apply_venue_enrichment_candidate(c_approved) into v_result;
  if v_result->>'outcome' <> 'already_in_requested_state' then
    raise exception 'FAIL 12: re-applying an already-applied candidate returned outcome %, expected already_in_requested_state', v_result->>'outcome';
  end if;
  select public.apply_venue_enrichment_candidate(c_applied_already) into v_result;
  if v_result->>'outcome' <> 'already_in_requested_state' then
    raise exception 'FAIL 12c: applying a candidate crafted directly as already-applied returned outcome %, expected already_in_requested_state', v_result->>'outcome';
  end if;
  select count(*) into v_log_count from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id = c_approved and action = 'venue_enrichment_candidate_applied';
  if v_log_count <> 1 then
    raise exception 'FAIL 13: an idempotent apply retry duplicated the activity_log -- expected still exactly 1 row for candidate %, found %', c_approved, v_log_count;
  end if;

  -- ── 30/31. Direct ordinary authenticated UPDATE/DELETE on
  --           venue_enrichment_candidates remains blocked -- Phase 4B adds
  --           no UPDATE/DELETE RLS policy, so this is unaffected by this
  --           migration (re-confirmed here, not only in the Phase 3C
  --           regression file). ────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  update public.venue_enrichment_candidates set status = 'rejected' where id = c_capacity_ok;
  get diagnostics v_rowcount = row_count;
  reset role;
  if v_rowcount <> 0 then
    raise exception 'FAIL 30: an authenticated admin''s direct UPDATE affected % row(s) on venue_enrichment_candidates, expected 0', v_rowcount;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  delete from public.venue_enrichment_candidates where id = c_skip_no_source;
  get diagnostics v_rowcount = row_count;
  reset role;
  if v_rowcount <> 0 then
    raise exception 'FAIL 31: an authenticated admin''s direct DELETE affected % row(s) on venue_enrichment_candidates, expected 0', v_rowcount;
  end if;

  -- ── 29. Missing venue handled defensively. venue_id's own FK (ON DELETE
  --        RESTRICT) makes this structurally unreachable via ordinary SQL
  --        while a referencing candidate row exists -- triggers on the
  --        REFERENCED table (public.venues) are disabled here, for this
  --        transaction only, purely to exercise apply's own defensive
  --        "venue not found" branch; everything is rolled back at the end
  --        of this file regardless. ──────────────────────────────────────
  alter table public.venues disable trigger all;
  delete from public.venues where id = v_orphan;
  alter table public.venues enable trigger all;
  if exists (select 1 from public.venues where id = v_orphan) then
    raise exception 'FAIL 29 setup: v_orphan venue % was not actually removed, cannot exercise the missing-venue branch', v_orphan;
  end if;
  begin
    perform public.apply_venue_enrichment_candidate(c_orphan);
    raise exception 'FAIL 29: applying a candidate whose venue no longer exists succeeded, expected "not found"';
  exception when others then
    if sqlerrm not like '%not found%' then raise exception 'FAIL 29b: wrong failure reason: %', sqlerrm; end if;
  end;

  -- ── 32. All 14 allowed fields exercise the correct target column, and
  --        applying one field never touches any of the other 13 on the
  --        same dedicated venue. ──────────────────────────────────────────
  for rec in select * from (values
    ('address', '999 Test Street, ZZTEST'),
    ('postcode', 'SO99 9ZZ'),
    ('website', 'https://zztest-field.example.test'),
    ('phone', '01111 999999'),
    ('contact_email', 'zztest@example.test'),
    ('facebook', 'https://facebook.test/zztest'),
    ('instagram', 'https://instagram.test/zztest'),
    ('twitter', 'https://x.test/zztest'),
    ('capacity', '525'),
    ('description', 'ZZTEST description value'),
    ('photo_url', 'https://img.test/zztest.jpg'),
    ('seo_title', 'ZZTEST SEO Title'),
    ('seo_description', 'ZZTEST SEO Description'),
    ('seo_search_phrases', 'zztest phrase one, zztest phrase two')
  ) as t(field, testvalue)
  loop
    insert into public.venues (name, city) values ('ZZTEST Field Venue 4B ' || rec.field, 'ZZTEST City') returning id into v_field_venue;
    insert into public.venue_enrichment_candidates
      (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
    values (v_field_venue, rec.field, null, rec.testvalue, 'official_site', 'HIGH', 'ZZTEST', 'approved', 'ZZTEST-4B-FIELD-BATCH', u_admin, v_before_ts)
    returning id into v_field_candidate;

    perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
    set local role authenticated;
    select public.apply_venue_enrichment_candidate(v_field_candidate) into v_result;
    reset role;

    if v_result->>'outcome' <> 'applied' then
      raise exception 'FAIL 32 (%): apply did not succeed, outcome %', rec.field, v_result->>'outcome';
    end if;

    execute format('select %I::text from public.venues where id = $1', rec.field) into v_field_actual using v_field_venue;
    if v_field_actual is distinct from rec.testvalue then
      raise exception 'FAIL 32 (%): venues.% is %, expected %', rec.field, rec.field, v_field_actual, rec.testvalue;
    end if;

    select * into v_after_venue from public.venues where id = v_field_venue;
    if (rec.field <> 'address' and v_after_venue.address is not null)
       or (rec.field <> 'postcode' and v_after_venue.postcode is not null)
       or (rec.field <> 'website' and v_after_venue.website is not null)
       or (rec.field <> 'phone' and v_after_venue.phone is not null)
       or (rec.field <> 'contact_email' and v_after_venue.contact_email is not null)
       or (rec.field <> 'facebook' and v_after_venue.facebook is not null)
       or (rec.field <> 'instagram' and v_after_venue.instagram is not null)
       or (rec.field <> 'twitter' and v_after_venue.twitter is not null)
       or (rec.field <> 'capacity' and v_after_venue.capacity is not null)
       or (rec.field <> 'description' and v_after_venue.description is not null)
       or (rec.field <> 'photo_url' and v_after_venue.photo_url is not null)
       or (rec.field <> 'seo_title' and v_after_venue.seo_title is not null)
       or (rec.field <> 'seo_description' and v_after_venue.seo_description is not null)
       or (rec.field <> 'seo_search_phrases' and v_after_venue.seo_search_phrases is not null)
    then
      raise exception 'FAIL 32b (%): applying this field changed an unrelated public.venues column', rec.field;
    end if;
  end loop;

  -- ── 27. blank/null comparison behaves correctly (same normalisation as
  --        Phase 3C's approval-time check) -- a whitespace-only
  --        existing_value must be treated as equivalent to a NULL live
  --        value, not flagged stale. ─────────────────────────────────────
  insert into public.venues (name, city, description) values ('ZZTEST Blank Venue 4B', 'ZZTEST City', null) returning id into v_field_venue;
  insert into public.venue_enrichment_candidates
    (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_field_venue, 'description', '   ', 'ZZTEST blank-equivalence description', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-4B-FIELD-BATCH', u_admin, v_before_ts)
  returning id into v_field_candidate;
  select public.apply_venue_enrichment_candidate(v_field_candidate) into v_result;
  if v_result->>'outcome' <> 'applied' then
    raise exception 'FAIL 27: whitespace-only existing_value ("   ") vs NULL live value was flagged %, expected applied (blank/whitespace-equivalent, not stale)', v_result->>'outcome';
  end if;

  -- ── 33. Function resolves the exact expected signature. ────────────────
  if exists (
    select 1 from pg_proc
    where proname = 'apply_venue_enrichment_candidate'
      and pg_get_function_identity_arguments(oid) <> 'p_candidate_id uuid'
  ) then
    raise exception 'FAIL 33: apply_venue_enrichment_candidate''s signature has drifted from (p_candidate_id uuid) -- re-check it has no field/venue_id/suggested_value parameter';
  end if;

  -- ── 1/2/3 (re-confirmed) / 34/35/36. Grant-layer ACL matches the
  --           intended security model exactly, verified with
  --           has_function_privilege() -- the PostgreSQL-native, robust
  --           method (not pg_proc.proacl text pattern matching, which the
  --           Phase 3C PR #43 review already flagged as the weaker of the
  --           two options). This is the ONLY way to test the PUBLIC grant
  --           specifically (there is no real role to SET ROLE into for
  --           PUBLIC), and independently re-confirms anon/authenticated
  --           alongside the earlier behavioural role-switch checks above
  --           (checks 2-4), which prove the same grants a different way. ──
  if has_function_privilege('public', 'public.apply_venue_enrichment_candidate(uuid)', 'execute') then
    raise exception 'FAIL 1 / FAIL 34: PUBLIC has EXECUTE on apply_venue_enrichment_candidate, expected none';
  end if;
  if has_function_privilege('anon', 'public.apply_venue_enrichment_candidate(uuid)', 'execute') then
    raise exception 'FAIL 35: anon has EXECUTE on apply_venue_enrichment_candidate (has_function_privilege), expected none';
  end if;
  if not has_function_privilege('authenticated', 'public.apply_venue_enrichment_candidate(uuid)', 'execute') then
    raise exception 'FAIL 3 / FAIL 36: authenticated does NOT have EXECUTE on apply_venue_enrichment_candidate, expected granted';
  end if;

  -- ── Cleanup (defensive -- the outer ROLLBACK at the end of this file
  --            already reverts everything; kept for symmetry with the
  --            Phase 3C regression file and in case this DO block is ever
  --            copy-pasted somewhere without that outer ROLLBACK). ───────
  delete from public.venue_enrichment_candidates
    where venue_id in (v_id, v_claimed, v_orphan) or id = c_orphan or batch_id = 'ZZTEST-4B-FIELD-BATCH';
  delete from public.venues where id in (v_id, v_claimed)
    or name like 'ZZTEST Field Venue 4B %' or name = 'ZZTEST Blank Venue 4B';

  raise notice 'venue_enrichment_candidate_apply Phase 4B regression: ALL CHECKS PASSED';
end $$;

rollback;
