-- Regression proof for Phase 3C (individual Approve/Reject of staged
-- venue_enrichment_candidates rows) -- see migration
-- 20260918150000_venue_enrichment_candidates_review.sql for the full
-- rationale.
--
-- UNLIKE venue_enrichment_candidates_regression.sql, this file does NOT
-- redefine the base table or its two SECURITY DEFINER functions from
-- scratch: those two functions are ~80 lines of real behaviour each, and
-- re-embedding a second copy of them inside a test file would only ever
-- risk silently drifting from the actual migration over time, unlike a
-- CREATE TABLE statement (cheap, low-risk to duplicate verbatim). Instead
-- this file assumes it is run against a database that already has BOTH
-- 20260918120000_venue_enrichment_candidates.sql AND
-- 20260918150000_venue_enrichment_candidates_review.sql applied -- exactly
-- what `supabase start` + `supabase db reset` (or an equivalent throwaway
-- clone) gives you locally by construction, applying every migration in
-- this repo in order.
--
-- MUST NEVER be run directly against production, even wrapped in
-- BEGIN...ROLLBACK -- it creates real fixture rows and exercises role-
-- based RLS/RPC denial and allow paths, the same category of mutation
-- testing venue_enrichment_candidates_regression.sql's own header comment
-- already warns production must never be used for. Run it only against a
-- local/disposable database:
--   psql "$LOCAL_DATABASE_URL" -f supabase/tests/venue_enrichment_candidates_review_regression.sql
--
-- NOT executed against any database as part of this PR -- production
-- migration application requires separate, explicit authorisation after
-- review (see the PR description's own "migration safety" confirmation).
-- Written now so it is ready to run the moment this migration is applied
-- somewhere safe to do so.
--
-- Every check RAISEs EXCEPTION with a distinct message on failure, so a
-- clean "NOTICE: venue_enrichment_candidates Phase 3C review regression:
-- ALL CHECKS PASSED" (with the final ROLLBACK) is the signal, same
-- convention as this directory's other regression files. Uses
-- ZZTEST-prefixed names throughout.

begin;

do $$
declare
  u_admin uuid; u_fan uuid;
  p_admin uuid;
  v_id uuid;
  c_pending uuid;      -- approves cleanly (existing_value matches live venue value)
  c_stale uuid;        -- existing_value deliberately does NOT match live venue value
  c_reject_stale uuid; -- reject target whose existing_value also doesn't match (must not matter for reject)
  c_skip uuid;
  c_ambiguous uuid;
  c_applied uuid;
  c_capacity uuid;     -- proves the capacity::text cast avoids a false stale positive
  v_result jsonb;
  v_row public.venue_enrichment_candidates;
  v_after_venue public.venues;
  v_before_ts timestamptz;
  v_reviewed_at_first timestamptz;
  v_log_count int;
  v_rowcount int;
begin
  -- ── Fixtures ──────────────────────────────────────────────────────────
  insert into public.venues (name, city, postcode, capacity)
  values ('ZZTEST Venue 3C', 'ZZTEST City', 'SO14 3AB', 300)
  returning id into v_id;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_admin;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_fan;

  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Admin 3C', u_admin, false, 'unclaimed', false, 'band', 'admin') returning id into p_admin;
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Fan 3C', u_fan, false, 'unclaimed', false, 'band', null);

  -- Candidate rows inserted directly (bypassing RLS, as table owner in
  -- this test harness) so each fixture's exact shape is under this test's
  -- own control, matching venue_enrichment_candidates_regression.sql's
  -- own convention.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_id, 'phone', null, '02380000000', 'official_site', 'HIGH', 'ZZTEST', 'pending', 'ZZTEST-3C-BATCH-001') returning id into c_pending;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_id, 'postcode', 'SO14 1AA', 'SO14 9ZZ', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-3C-BATCH-001') returning id into c_stale;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_id, 'website', 'https://old.example.test', 'https://new.example.test', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-3C-BATCH-001') returning id into c_reject_stale;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, status, batch_id)
  values (v_id, 'facebook', null, null, 'skipped_no_source', 'ZZTEST-3C-BATCH-001') returning id into c_skip;

  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, status, batch_id)
  values (v_id, 'instagram', null, null, 'skipped_ambiguous', 'ZZTEST-3C-BATCH-001') returning id into c_ambiguous;

  -- 'applied' has no reviewer (matches the reviewed-pairing CHECK: only
  -- approved/rejected require reviewed_by/reviewed_at) -- there is no real
  -- workflow that can produce this status yet (no Apply engine exists),
  -- so it's crafted directly to prove the RPCs still refuse to touch it.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'twitter', null, 'https://twitter.test/venue', 'official_site', 'LOW', 'applied', 'ZZTEST-3C-BATCH-001') returning id into c_applied;

  -- capacity is the one non-text venues column -- existing_value '300'
  -- (text) must compare equal to the live integer 300 via the RPC's
  -- ::text cast, not be flagged stale purely from a type mismatch.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_id, 'capacity', '300', '350 (extended standing area)', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-3C-BATCH-001') returning id into c_capacity;

  -- ── 1/2. Anonymous cannot approve/reject: EXECUTE was never granted to
  --         anon, so this fails at the grant level (42501/insufficient_
  --         privilege) before the function body's own admin check ever
  --         runs. ─────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.approve_venue_enrichment_candidate(c_pending);
    raise exception 'FAIL 1: anon was able to call approve_venue_enrichment_candidate, expected EXECUTE to be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reject_venue_enrichment_candidate(c_pending);
    raise exception 'FAIL 2: anon was able to call reject_venue_enrichment_candidate, expected EXECUTE to be denied';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── 3/4. Non-admin authenticated user cannot approve/reject: EXECUTE IS
  --         granted to `authenticated`, so this reaches the function body
  --         and fails the internal is_admin_or_above() check instead --
  --         a distinct failure mode from 1/2 above, and worth telling
  --         apart (a mis-granted EXECUTE would silently turn this into
  --         the wrong kind of "pass"). ────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_fan)::text, true);
  set local role authenticated;
  begin
    perform public.approve_venue_enrichment_candidate(c_pending);
    raise exception 'FAIL 3: non-admin authenticated user was able to approve, expected the function''s own admin check to raise';
  exception when others then
    if sqlerrm not like '%Only admins can review%' then
      raise exception 'FAIL 3b: non-admin approve failed for the wrong reason: %', sqlerrm;
    end if;
  end;
  begin
    perform public.reject_venue_enrichment_candidate(c_pending);
    raise exception 'FAIL 4: non-admin authenticated user was able to reject, expected the function''s own admin check to raise';
  exception when others then
    if sqlerrm not like '%Only admins can review%' then
      raise exception 'FAIL 4b: non-admin reject failed for the wrong reason: %', sqlerrm;
    end if;
  end;
  reset role;
  -- Confirm neither denied attempt above mutated anything.
  select * into v_row from public.venue_enrichment_candidates where id = c_pending;
  if v_row.status <> 'pending' or v_row.reviewed_by is not null then
    raise exception 'FAIL 3c/4c: a denied non-admin call mutated candidate %, expected no change', c_pending;
  end if;

  -- ── 5/6/7. Admin pending -> approved succeeds; reviewed_by/reviewed_at
  --           are server-stamped. ────────────────────────────────────────
  v_before_ts := clock_timestamp();
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.approve_venue_enrichment_candidate(c_pending) into v_result;
  reset role;

  if v_result->>'outcome' <> 'approved' then
    raise exception 'FAIL 5: admin approve of a pending candidate with no live drift returned outcome %, expected approved', v_result->>'outcome';
  end if;

  select * into v_row from public.venue_enrichment_candidates where id = c_pending;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 5b: candidate % status is % after approval, expected approved', c_pending, v_row.status;
  end if;
  if v_row.reviewed_by is distinct from u_admin then
    raise exception 'FAIL 6: reviewed_by is %, expected the calling admin''s own auth.uid() (%)', v_row.reviewed_by, u_admin;
  end if;
  if v_row.reviewed_at is null or v_row.reviewed_at < v_before_ts then
    raise exception 'FAIL 7: reviewed_at (%) was not stamped with a server-side "now()" at/after the call time (%)', v_row.reviewed_at, v_before_ts;
  end if;
  v_reviewed_at_first := v_row.reviewed_at;

  -- ── 8/9. Caller cannot forge reviewer / supply arbitrary status: proven
  --         structurally -- the function signatures have no such
  --         parameters at all, not merely a validation that rejects one. ──
  if exists (
    select 1 from pg_proc
    where proname = 'approve_venue_enrichment_candidate'
      and pg_get_function_identity_arguments(oid) <> 'p_candidate_id uuid, p_review_notes text'
  ) then
    raise exception 'FAIL 8: approve_venue_enrichment_candidate''s signature has drifted from (p_candidate_id uuid, p_review_notes text) -- re-check it has no reviewer/status parameter';
  end if;
  if exists (
    select 1 from pg_proc
    where proname = 'reject_venue_enrichment_candidate'
      and pg_get_function_identity_arguments(oid) <> 'p_candidate_id uuid, p_review_notes text'
  ) then
    raise exception 'FAIL 9: reject_venue_enrichment_candidate''s signature has drifted from (p_candidate_id uuid, p_review_notes text) -- re-check it has no reviewer/status parameter';
  end if;

  -- ── 10/11. skipped_no_source / skipped_ambiguous cannot be approved. ───
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  begin
    perform public.approve_venue_enrichment_candidate(c_skip);
    raise exception 'FAIL 10: a skipped_no_source candidate was approved, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be pending%' then raise exception 'FAIL 10b: wrong failure reason: %', sqlerrm; end if;
  end;
  begin
    perform public.approve_venue_enrichment_candidate(c_ambiguous);
    raise exception 'FAIL 11: a skipped_ambiguous candidate was approved, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be pending%' then raise exception 'FAIL 11b: wrong failure reason: %', sqlerrm; end if;
  end;

  -- ── 12. applied cannot be reviewed (neither direction). ────────────────
  begin
    perform public.approve_venue_enrichment_candidate(c_applied);
    raise exception 'FAIL 12: an applied candidate was approved, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be pending%' then raise exception 'FAIL 12b: wrong failure reason: %', sqlerrm; end if;
  end;
  begin
    perform public.reject_venue_enrichment_candidate(c_applied);
    raise exception 'FAIL 12c: an applied candidate was rejected, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be pending%' then raise exception 'FAIL 12d: wrong failure reason: %', sqlerrm; end if;
  end;

  -- ── 13/14. Stale live venue prevents approval; the candidate becomes
  --           stale_conflict DURABLY (not rolled back) and does NOT set
  --           reviewed_by/reviewed_at. ─────────────────────────────────────
  select public.approve_venue_enrichment_candidate(c_stale) into v_result;
  if v_result->>'outcome' <> 'stale_conflict' then
    raise exception 'FAIL 13: approving a candidate whose existing_value ("SO14 1AA") no longer matches the live venue postcode ("SO14 3AB") returned outcome %, expected stale_conflict', v_result->>'outcome';
  end if;
  if (v_result->>'live_value') <> 'SO14 3AB' then
    raise exception 'FAIL 13b: stale_conflict result reported live_value %, expected the venue''s actual current postcode', v_result->>'live_value';
  end if;

  select * into v_row from public.venue_enrichment_candidates where id = c_stale;
  if v_row.status <> 'stale_conflict' then
    raise exception 'FAIL 14: candidate % status is % after the stale approval attempt, expected stale_conflict to have been durably written', c_stale, v_row.status;
  end if;
  if v_row.reviewed_by is not null or v_row.reviewed_at is not null then
    raise exception 'FAIL 15: stale_conflict candidate % has reviewed_by/reviewed_at set -- a system-detected block must not look like a human decision', c_stale;
  end if;

  -- ── 16. Capacity's ::text cast avoids a false stale positive when the
  --        text snapshot and the live integer represent the same value. ──
  select public.approve_venue_enrichment_candidate(c_capacity) into v_result;
  if v_result->>'outcome' <> 'approved' then
    raise exception 'FAIL 16: capacity candidate (existing_value ''300'' vs live integer 300) returned outcome %, expected approved (no false stale positive from the type difference)', v_result->>'outcome';
  end if;

  -- ── 17. Reject succeeds even when the live value has changed -- no
  --        stale check applies to reject at all. ────────────────────────
  select public.reject_venue_enrichment_candidate(c_reject_stale) into v_result;
  if v_result->>'outcome' <> 'rejected' then
    raise exception 'FAIL 17: rejecting a candidate with a stale existing_value returned outcome %, expected rejected (reject performs no live-value check)', v_result->>'outcome';
  end if;

  -- ── 18/19. public.venues is unchanged after both an approve and a
  --           reject (and after the stale-conflict attempt). ─────────────
  select * into v_after_venue from public.venues where id = v_id;
  if v_after_venue.postcode is distinct from 'SO14 3AB'
     or v_after_venue.capacity is distinct from 300
     or v_after_venue.website is distinct from null
     or v_after_venue.phone is distinct from null then
    raise exception 'FAIL 18/19: public.venues row for % was modified by an approve/reject/stale-conflict call -- Phase 3C must never write to public.venues', v_id;
  end if;

  -- ── 20/21. Same-action retry is idempotent: re-approving an already-
  --           approved candidate does not raise, does not re-stamp
  --           reviewed_at, and does not duplicate its activity_log entry. ─
  select public.approve_venue_enrichment_candidate(c_pending) into v_result;
  if v_result->>'outcome' <> 'already_in_requested_state' then
    raise exception 'FAIL 20: re-approving an already-approved candidate returned outcome %, expected already_in_requested_state', v_result->>'outcome';
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_pending;
  if v_row.reviewed_at is distinct from v_reviewed_at_first then
    raise exception 'FAIL 20b: an idempotent retry re-stamped reviewed_at (was %, now %) -- a safe retry must not mutate an already-decided row', v_reviewed_at_first, v_row.reviewed_at;
  end if;
  select count(*) into v_log_count from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id = c_pending and action = 'venue_enrichment_candidate_approved';
  if v_log_count <> 1 then
    raise exception 'FAIL 21: expected exactly 1 venue_enrichment_candidate_approved activity_log row for candidate % after an idempotent retry, found %', c_pending, v_log_count;
  end if;

  -- ── 22. Opposite-action retry does not mutate: rejecting an already-
  --        approved candidate must raise and leave it untouched. ─────────
  begin
    perform public.reject_venue_enrichment_candidate(c_pending);
    raise exception 'FAIL 22: rejecting an already-approved candidate succeeded, expected the state-machine guard to raise';
  exception when others then
    if sqlerrm not like '%must be pending%' then raise exception 'FAIL 22b: wrong failure reason: %', sqlerrm; end if;
  end;
  select * into v_row from public.venue_enrichment_candidates where id = c_pending;
  if v_row.status <> 'approved' or v_row.reviewed_at is distinct from v_reviewed_at_first then
    raise exception 'FAIL 22c: an opposite-action retry mutated candidate % (status=%), expected no change', c_pending, v_row.status;
  end if;

  -- ── 23/24/25. activity_log rows exist for approve, reject, and
  --              stale_conflict, each naming the right action/entity. ─────
  if not exists (select 1 from public.activity_log where entity_type = 'venue_enrichment_candidate' and entity_id = c_pending and action = 'venue_enrichment_candidate_approved' and performed_by = u_admin) then
    raise exception 'FAIL 23: no venue_enrichment_candidate_approved activity_log row found for candidate %', c_pending;
  end if;
  if not exists (select 1 from public.activity_log where entity_type = 'venue_enrichment_candidate' and entity_id = c_reject_stale and action = 'venue_enrichment_candidate_rejected' and performed_by = u_admin) then
    raise exception 'FAIL 24: no venue_enrichment_candidate_rejected activity_log row found for candidate %', c_reject_stale;
  end if;
  if not exists (select 1 from public.activity_log where entity_type = 'venue_enrichment_candidate' and entity_id = c_stale and action = 'venue_enrichment_candidate_stale_conflict_detected' and performed_by = u_admin) then
    raise exception 'FAIL 25: no venue_enrichment_candidate_stale_conflict_detected activity_log row found for candidate %', c_stale;
  end if;
  -- What must NOT be logged: researched content itself.
  if exists (
    select 1 from public.activity_log
    where entity_type = 'venue_enrichment_candidate'
      and entity_id in (c_pending, c_stale, c_reject_stale)
      and (entity_name ilike '%02380000000%' or entity_name ilike '%SO14%' or entity_name ilike '%example.test%')
  ) then
    raise exception 'FAIL 25b: a venue_enrichment_candidate activity_log entity_name leaked researched content (suggested_value/existing_value), expected only field/batch_id';
  end if;

  -- ── 26/27. Normal authenticated (admin) role cannot directly UPDATE or
  --           DELETE a candidate row -- RLS has no policy for either
  --           command any more, so the statement silently affects 0 rows
  --           (Postgres RLS semantics: a command with no applicable
  --           policy matches zero rows, it does not raise), never an
  --           actual mutation. ──────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  update public.venue_enrichment_candidates set status = 'rejected' where id = c_capacity;
  get diagnostics v_rowcount = row_count;
  reset role;
  if v_rowcount <> 0 then
    raise exception 'FAIL 26: an authenticated admin''s direct UPDATE affected % row(s) on venue_enrichment_candidates, expected 0 -- review writes must be forced through the RPCs', v_rowcount;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_capacity;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 26b: candidate % status changed to % via a direct UPDATE that should have affected 0 rows', c_capacity, v_row.status;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  delete from public.venue_enrichment_candidates where id = c_skip;
  get diagnostics v_rowcount = row_count;
  reset role;
  if v_rowcount <> 0 then
    raise exception 'FAIL 27: an authenticated admin''s direct DELETE affected % row(s) on venue_enrichment_candidates, expected 0', v_rowcount;
  end if;
  if not exists (select 1 from public.venue_enrichment_candidates where id = c_skip) then
    raise exception 'FAIL 27b: candidate % was deleted via a direct DELETE that should have affected 0 rows', c_skip;
  end if;

  -- ── 28. Admin SELECT still works (Phase 3B's own read screen is
  --        unaffected by the RLS hardening). ─────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  if not exists (select 1 from public.venue_enrichment_candidates where venue_id = v_id) then
    raise exception 'FAIL 28: admin SELECT on venue_enrichment_candidates returned nothing, expected the ZZTEST fixture rows to be visible';
  end if;
  reset role;

  -- ── 29. The intended staging INSERT path remains compatible: an admin
  --        can still insert a new pending candidate directly (the shape
  --        a future "start a new research batch" admin feature would use;
  --        Phase 2B's own actual insert used a privileged SQL-editor
  --        context, not this RLS path, so this specifically re-confirms
  --        the narrowed policy set didn't accidentally remove INSERT
  --        too). ──────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'description', 'ZZTEST description', 'official_site', 'HIGH', 'pending', 'ZZTEST-3C-BATCH-002')
  returning * into v_row;
  reset role;
  if v_row.id is null then
    raise exception 'FAIL 29: an admin INSERT on venue_enrichment_candidates was denied, expected ALLOW under venue_enrichment_candidates_admin_insert';
  end if;

  -- ── Cleanup ──────────────────────────────────────────────────────────
  delete from public.venue_enrichment_candidates where venue_id = v_id;
  delete from public.venues where id = v_id;

  raise notice 'venue_enrichment_candidates Phase 3C review regression: ALL CHECKS PASSED';
end $$;

rollback;
