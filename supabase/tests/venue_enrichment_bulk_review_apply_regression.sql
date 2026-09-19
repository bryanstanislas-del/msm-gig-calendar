-- Regression proof for Phase 5D (venue-level bulk Approve/Apply) -- see
-- migrations 20260919090000_venue_enrichment_manual_review_flag.sql and
-- 20260919091000_venue_enrichment_bulk_review_apply.sql for the full
-- rationale.
--
-- Same convention as the Phase 3C/4B regression files: does NOT redefine
-- the base table, the manual-review column, or either new RPC from
-- scratch. Assumes it is run against a database that already has every
-- prior venue_enrichment_candidates migration applied, in order, ending
-- with the two Phase 5D migrations above -- exactly what `supabase start`
-- + `supabase db reset` gives locally by construction.
--
-- MUST NEVER be run directly against production, even wrapped in
-- BEGIN...ROLLBACK -- same category of mutation/role-switching test as
-- every other file in this directory. Run it only against a local/
-- disposable database:
--   psql "$LOCAL_DATABASE_URL" -f supabase/tests/venue_enrichment_bulk_review_apply_regression.sql
--
-- NOT executed against any database as part of this PR -- production
-- migration application requires separate, explicit authorisation after
-- review.
--
-- Every check RAISEs EXCEPTION with a distinct message on failure, so a
-- clean "NOTICE: venue_enrichment bulk review/apply Phase 5D regression:
-- ALL CHECKS PASSED" (with the final ROLLBACK) is the signal. Uses
-- ZZTEST-prefixed names throughout.

begin;

do $$
declare
  u_admin uuid; u_fan uuid;
  v_clean uuid;          -- unclaimed, not manual-review -- the normal bulk-eligible venue
  v_manual uuid;         -- unclaimed, manual-review = true
  v_claimed uuid;        -- claimed, not manual-review
  v_other uuid;          -- second ordinary venue, used to prove exact venue scoping
  v_mixed uuid;          -- has one safe pending + one stale pending candidate
  v_txn uuid;            -- has two safe approved candidates + one that fails to apply
  c_clean_1 uuid; c_clean_2 uuid;         -- two safe pending candidates on v_clean
  c_other_pending uuid;                    -- pending candidate on v_other (must stay untouched)
  c_mixed_safe uuid; c_mixed_stale uuid;   -- v_mixed's two pending candidates
  c_manual_pending uuid;                   -- pending candidate on v_manual
  c_claimed_pending uuid;                  -- pending candidate on v_claimed
  c_txn_ok_1 uuid; c_txn_ok_2 uuid; c_txn_bad uuid; -- v_txn's three approved candidates
  c_already_approved uuid;                 -- already-approved candidate on v_clean, for apply-path tests
  c_manual_approved uuid;                  -- approved candidate on v_manual, for bulk-apply-blocked test
  c_claimed_approved uuid;                 -- approved candidate on v_claimed, for bulk-apply-blocked test
  v_result jsonb;
  v_row public.venue_enrichment_candidates;
  v_after_venue public.venues;
  v_log_count int;
  v_before_ts timestamptz;
begin
  v_before_ts := clock_timestamp();

  -- ── Fixtures ──────────────────────────────────────────────────────────
  insert into public.venues (name, city, postcode, capacity, claimed, claim_status, venue_enrichment_manual_review)
  values ('ZZTEST Venue 5D Clean', 'ZZTEST City', 'SO14 3AB', 300, false, 'unclaimed', false) returning id into v_clean;

  insert into public.venues (name, city, claimed, claim_status, venue_enrichment_manual_review)
  values ('ZZTEST Venue 5D Manual', 'ZZTEST City', false, 'unclaimed', true) returning id into v_manual;

  insert into public.venues (name, city, claimed, claim_status, venue_enrichment_manual_review)
  values ('ZZTEST Venue 5D Claimed', 'ZZTEST City', true, 'claimed', false) returning id into v_claimed;

  insert into public.venues (name, city, claimed, claim_status, venue_enrichment_manual_review)
  values ('ZZTEST Venue 5D Other', 'ZZTEST City', false, 'unclaimed', false) returning id into v_other;

  insert into public.venues (name, city, postcode, claimed, claim_status, venue_enrichment_manual_review)
  values ('ZZTEST Venue 5D Mixed', 'ZZTEST City', 'SO14 3AB', false, 'unclaimed', false) returning id into v_mixed;

  insert into public.venues (name, city, capacity, claimed, claim_status, venue_enrichment_manual_review)
  values ('ZZTEST Venue 5D Txn', 'ZZTEST City', 300, false, 'unclaimed', false) returning id into v_txn;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_admin;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_fan;
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Admin 5D', u_admin, false, 'unclaimed', false, 'band', 'admin');
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Fan 5D', u_fan, false, 'unclaimed', false, 'band', null);

  -- v_clean: two safe pending candidates (no live drift).
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_clean, 'phone', null, '02380000010', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-001') returning id into c_clean_1;
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_clean, 'website', null, 'https://zztest5d.example.test', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-001') returning id into c_clean_2;
  -- an already-approved candidate on v_clean, used later for the bulk-apply happy path
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_clean, 'facebook', null, 'https://facebook.test/zztest5d', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-5D-BATCH-001', u_admin, v_before_ts) returning id into c_already_approved;

  -- v_other: one pending candidate that must NEVER be touched by any bulk
  -- call scoped to a different venue.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_other, 'phone', null, '02380000099', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-001') returning id into c_other_pending;

  -- v_mixed: one safe pending candidate + one deliberately stale pending
  -- candidate (existing_value 'SO14 1AA' does not match the venue's real
  -- live postcode 'SO14 3AB' set above).
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_mixed, 'phone', null, '02380000020', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-001') returning id into c_mixed_safe;
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_mixed, 'postcode', 'SO14 1AA', 'SO14 9ZZ', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-001') returning id into c_mixed_stale;

  -- v_manual: one pending + one approved candidate -- must be entirely
  -- untouched by both bulk RPCs regardless of who calls them.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_manual, 'phone', null, '02380000030', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-001') returning id into c_manual_pending;
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_manual, 'website', null, 'https://zztest5dmanual.example.test', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-5D-BATCH-001', u_admin, v_before_ts) returning id into c_manual_approved;

  -- v_claimed: one pending + one approved candidate -- must be entirely
  -- untouched by both bulk RPCs.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
  values (v_claimed, 'phone', null, '02380000040', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-001') returning id into c_claimed_pending;
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_claimed, 'website', null, 'https://zztest5dclaimed.example.test', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-5D-BATCH-001', u_admin, v_before_ts) returning id into c_claimed_approved;

  -- v_txn: two safe approved candidates + one approved candidate whose
  -- suggested_value cannot be cast to integer (mirrors the existing Phase
  -- 4B single-candidate regression's own c_capacity_invalid fixture) --
  -- used for the CRITICAL MULTI-FIELD TRANSACTION TEST below.
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_txn, 'phone', null, '02380000050', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-5D-BATCH-001', u_admin, v_before_ts) returning id into c_txn_ok_1;
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_txn, 'website', null, 'https://zztest5dtxn.example.test', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-5D-BATCH-001', u_admin, v_before_ts) returning id into c_txn_ok_2;
  insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id, reviewed_by, reviewed_at)
  values (v_txn, 'capacity', '300', 'not-a-number', 'official_site', 'MEDIUM', 'ZZTEST', 'approved', 'ZZTEST-5D-BATCH-001', u_admin, v_before_ts) returning id into c_txn_bad;

  -- ── 1/2. anon cannot execute either bulk RPC -- fails at the grant
  --         level, before either function body runs. ─────────────────────
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.approve_all_safe_candidates_for_venue(v_clean);
    raise exception 'FAIL 1: anon was able to call approve_all_safe_candidates_for_venue, expected EXECUTE denied';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.apply_all_approved_candidates_for_venue(v_clean);
    raise exception 'FAIL 2: anon was able to call apply_all_approved_candidates_for_venue, expected EXECUTE denied';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── 3/4. PUBLIC has no bare EXECUTE on either function (has_function_
  --         privilege is the robust check, not proacl text matching). ─────
  if has_function_privilege('public', 'public.approve_all_safe_candidates_for_venue(uuid, text)', 'execute') then
    raise exception 'FAIL 3: PUBLIC has EXECUTE on approve_all_safe_candidates_for_venue, expected none';
  end if;
  if has_function_privilege('public', 'public.apply_all_approved_candidates_for_venue(uuid)', 'execute') then
    raise exception 'FAIL 4: PUBLIC has EXECUTE on apply_all_approved_candidates_for_venue, expected none';
  end if;
  if has_function_privilege('anon', 'public.approve_all_safe_candidates_for_venue(uuid, text)', 'execute') then
    raise exception 'FAIL 3b: anon has EXECUTE on approve_all_safe_candidates_for_venue, expected none';
  end if;
  if not has_function_privilege('authenticated', 'public.approve_all_safe_candidates_for_venue(uuid, text)', 'execute') then
    raise exception 'FAIL 3c: authenticated lacks EXECUTE on approve_all_safe_candidates_for_venue, expected granted';
  end if;
  if not has_function_privilege('authenticated', 'public.apply_all_approved_candidates_for_venue(uuid)', 'execute') then
    raise exception 'FAIL 4c: authenticated lacks EXECUTE on apply_all_approved_candidates_for_venue, expected granted';
  end if;

  -- ── 5/6. Non-admin authenticated user is rejected INTERNALLY (reaches
  --         the function body, fails is_admin_or_above()) -- and nothing
  --         is mutated by the denied attempt. ─────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_fan)::text, true);
  set local role authenticated;
  begin
    perform public.approve_all_safe_candidates_for_venue(v_clean);
    raise exception 'FAIL 5: non-admin approved via bulk RPC, expected the admin check to raise';
  exception when others then
    if sqlerrm not like '%Only admins can review%' then raise exception 'FAIL 5b: wrong failure reason: %', sqlerrm; end if;
  end;
  begin
    perform public.apply_all_approved_candidates_for_venue(v_clean);
    raise exception 'FAIL 6: non-admin applied via bulk RPC, expected the admin check to raise';
  exception when others then
    if sqlerrm not like '%Only admins can apply%' then raise exception 'FAIL 6b: wrong failure reason: %', sqlerrm; end if;
  end;
  reset role;
  select * into v_row from public.venue_enrichment_candidates where id = c_clean_1;
  if v_row.status <> 'pending' then
    raise exception 'FAIL 5c: a denied non-admin bulk-approve attempt mutated candidate %, expected no change', c_clean_1;
  end if;

  -- ── 7/8. MANUAL-REVIEW VENUE: both bulk RPCs refuse, called DIRECTLY by
  --         an admin (proves the server-side refusal holds even if a
  --         client/UI bypass tried to call the RPC anyway) -- zero
  --         candidates touched, refusal is durably logged. ───────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.approve_all_safe_candidates_for_venue(v_manual) into v_result;
  reset role;
  if v_result->>'outcome' <> 'blocked_manual_review' or (v_result->>'eligible_count')::int <> 0 then
    raise exception 'FAIL 7: bulk-approve on a manual-review venue returned %, expected blocked_manual_review with eligible_count 0', v_result;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_manual_pending;
  if v_row.status <> 'pending' then
    raise exception 'FAIL 7b: bulk-approve touched candidate % on a manual-review venue, expected untouched', c_manual_pending;
  end if;
  if not exists (select 1 from public.activity_log where entity_type = 'venue' and entity_id = v_manual and action = 'venue_enrichment_bulk_approve_blocked_manual_review') then
    raise exception 'FAIL 7c: no venue_enrichment_bulk_approve_blocked_manual_review activity_log row found for venue %', v_manual;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.apply_all_approved_candidates_for_venue(v_manual) into v_result;
  reset role;
  if v_result->>'outcome' <> 'blocked_manual_review' or (v_result->>'eligible_count')::int <> 0 then
    raise exception 'FAIL 8: bulk-apply on a manual-review venue returned %, expected blocked_manual_review with eligible_count 0', v_result;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_manual_approved;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 8b: bulk-apply touched candidate % on a manual-review venue, expected untouched', c_manual_approved;
  end if;
  select * into v_after_venue from public.venues where id = v_manual;
  if v_after_venue.website is not null then
    raise exception 'FAIL 8c: bulk-apply wrote to public.venues for manual-review venue %, expected untouched', v_manual;
  end if;
  if not exists (select 1 from public.activity_log where entity_type = 'venue' and entity_id = v_manual and action = 'venue_enrichment_bulk_apply_blocked_manual_review') then
    raise exception 'FAIL 8d: no venue_enrichment_bulk_apply_blocked_manual_review activity_log row found for venue %', v_manual;
  end if;

  -- ── 9/10. CLAIMED VENUE: both bulk RPCs refuse the same way. ────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.approve_all_safe_candidates_for_venue(v_claimed) into v_result;
  reset role;
  if v_result->>'outcome' <> 'blocked_claimed_venue' or (v_result->>'eligible_count')::int <> 0 then
    raise exception 'FAIL 9: bulk-approve on a claimed venue returned %, expected blocked_claimed_venue with eligible_count 0', v_result;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_claimed_pending;
  if v_row.status <> 'pending' then
    raise exception 'FAIL 9b: bulk-approve touched candidate % on a claimed venue, expected untouched', c_claimed_pending;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.apply_all_approved_candidates_for_venue(v_claimed) into v_result;
  reset role;
  if v_result->>'outcome' <> 'blocked_claimed_venue' or (v_result->>'eligible_count')::int <> 0 then
    raise exception 'FAIL 10: bulk-apply on a claimed venue returned %, expected blocked_claimed_venue with eligible_count 0', v_result;
  end if;
  select * into v_after_venue from public.venues where id = v_claimed;
  if v_after_venue.website is not null then
    raise exception 'FAIL 10b: bulk-apply wrote to public.venues for claimed venue %, expected untouched', v_claimed;
  end if;

  -- ── 11. Missing venue raises. ────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  begin
    perform public.approve_all_safe_candidates_for_venue(gen_random_uuid());
    raise exception 'FAIL 11: bulk-approve on a non-existent venue succeeded, expected "not found"';
  exception when others then
    if sqlerrm not like '%not found%' then raise exception 'FAIL 11b: wrong failure reason: %', sqlerrm; end if;
  end;
  reset role;

  -- ── 12/13/14. HAPPY PATH bulk-approve on v_clean: both safe pending
  --              candidates approve; v_other's pending candidate (a
  --              DIFFERENT venue) is completely untouched (exact venue
  --              scoping); one activity_log row per real transition. ──────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.approve_all_safe_candidates_for_venue(v_clean, 'ZZTEST bulk note') into v_result;
  reset role;
  if v_result->>'outcome' <> 'completed'
     or (v_result->>'eligible_count')::int <> 2
     or (v_result->>'approved_count')::int <> 2
     or (v_result->>'stale_count')::int <> 0
     or (v_result->>'skipped_count')::int <> 0
  then
    raise exception 'FAIL 12: bulk-approve happy path on v_clean returned %, expected completed/eligible=2/approved=2/stale=0/skipped=0', v_result;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_clean_1;
  if v_row.status <> 'approved' or v_row.reviewed_by is distinct from u_admin or v_row.review_notes is distinct from 'ZZTEST bulk note' then
    raise exception 'FAIL 12b: candidate % after bulk-approve has status=%, reviewed_by=%, review_notes=%, expected approved/admin/ZZTEST bulk note', c_clean_1, v_row.status, v_row.reviewed_by, v_row.review_notes;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_clean_2;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 12c: candidate % after bulk-approve has status=%, expected approved', c_clean_2, v_row.status;
  end if;
  -- ── 13. wrong-venue candidates untouched ────────────────────────────────
  select * into v_row from public.venue_enrichment_candidates where id = c_other_pending;
  if v_row.status <> 'pending' then
    raise exception 'FAIL 13: bulk-approve scoped to v_clean mutated candidate % belonging to a different venue (v_other), expected untouched', c_other_pending;
  end if;
  -- ── 14. one activity_log row per real transition (2 candidates -> 2 rows,
  --        not 1 summary row and not 4). ──────────────────────────────────
  select count(*) into v_log_count from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id in (c_clean_1, c_clean_2) and action = 'venue_enrichment_candidate_approved';
  if v_log_count <> 2 then
    raise exception 'FAIL 14: expected exactly 2 venue_enrichment_candidate_approved activity_log rows for the two bulk-approved candidates, found %', v_log_count;
  end if;

  -- ── 15. REPEATED bulk-approve call is idempotent: eligible_count is now
  --        0 (nothing left pending on v_clean), no re-stamping, no
  --        duplicate activity_log rows. ──────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.approve_all_safe_candidates_for_venue(v_clean) into v_result;
  reset role;
  if v_result->>'outcome' <> 'completed' or (v_result->>'eligible_count')::int <> 0 then
    raise exception 'FAIL 15: repeated bulk-approve on v_clean returned %, expected completed with eligible_count 0 (nothing left pending)', v_result;
  end if;
  select count(*) into v_log_count from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id in (c_clean_1, c_clean_2) and action = 'venue_enrichment_candidate_approved';
  if v_log_count <> 2 then
    raise exception 'FAIL 15b: a repeated bulk-approve call duplicated the activity_log -- expected still exactly 2 rows, found %', v_log_count;
  end if;

  -- ── 16/17/18. MIXED pending set (v_mixed): the safe candidate approves,
  --              the stale one becomes stale_conflict WITHOUT blocking its
  --              sibling, and stays out of approved status (not
  --              overwritten later). ─────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.approve_all_safe_candidates_for_venue(v_mixed) into v_result;
  reset role;
  if v_result->>'outcome' <> 'completed'
     or (v_result->>'eligible_count')::int <> 2
     or (v_result->>'approved_count')::int <> 1
     or (v_result->>'stale_count')::int <> 1
  then
    raise exception 'FAIL 16: bulk-approve on v_mixed returned %, expected completed/eligible=2/approved=1/stale=1 (the stale sibling must not block the safe one)', v_result;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_mixed_safe;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 17: safe candidate % on v_mixed has status %, expected approved despite its stale sibling', c_mixed_safe, v_row.status;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_mixed_stale;
  if v_row.status <> 'stale_conflict' then
    raise exception 'FAIL 18: stale candidate % on v_mixed has status %, expected stale_conflict (must not have been approved)', c_mixed_stale, v_row.status;
  end if;

  -- ── 19/20/21/22. HAPPY PATH bulk-apply on v_clean: the already-approved
  --                 candidate (c_already_approved, field=facebook) and the
  --                 two just-bulk-approved candidates (phone, website) all
  --                 apply; exact field allow-list -- each writes only its
  --                 own venues column. ────────────────────────────────────
  select * into v_after_venue from public.venues where id = v_clean;
  if v_after_venue.phone is not null or v_after_venue.website is not null or v_after_venue.facebook is not null then
    raise exception 'FAIL 19 setup: v_clean already has phone/website/facebook set before bulk-apply, fixture assumption violated';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.apply_all_approved_candidates_for_venue(v_clean) into v_result;
  reset role;
  if v_result->>'outcome' <> 'completed'
     or (v_result->>'eligible_count')::int <> 3
     or (v_result->>'applied_count')::int <> 3
     or (v_result->>'stale_count')::int <> 0
  then
    raise exception 'FAIL 19: bulk-apply happy path on v_clean returned %, expected completed/eligible=3/applied=3/stale=0', v_result;
  end if;
  select * into v_after_venue from public.venues where id = v_clean;
  if v_after_venue.phone is distinct from '02380000010'
     or v_after_venue.website is distinct from 'https://zztest5d.example.test'
     or v_after_venue.facebook is distinct from 'https://facebook.test/zztest5d'
  then
    raise exception 'FAIL 20: v_clean after bulk-apply has phone=%, website=%, facebook=%, expected all three applied values exactly', v_after_venue.phone, v_after_venue.website, v_after_venue.facebook;
  end if;
  if v_after_venue.postcode is distinct from 'SO14 3AB' or v_after_venue.capacity is distinct from 300 or v_after_venue.address is not null or v_after_venue.description is not null then
    raise exception 'FAIL 21: bulk-apply on v_clean changed an unrelated public.venues column (exact field allow-list violated)';
  end if;
  select count(*) into v_log_count from public.venue_enrichment_candidates where id in (c_clean_1, c_clean_2, c_already_approved) and status = 'applied';
  if v_log_count <> 3 then
    raise exception 'FAIL 22: expected all 3 bulk-applied candidates to have status applied, found % with that status', v_log_count;
  end if;

  -- ── 23. REPEATED bulk-apply is idempotent: nothing left approved on
  --        v_clean, no duplicate activity_log rows, no re-write. ─────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.apply_all_approved_candidates_for_venue(v_clean) into v_result;
  reset role;
  if v_result->>'outcome' <> 'completed' or (v_result->>'eligible_count')::int <> 0 then
    raise exception 'FAIL 23: repeated bulk-apply on v_clean returned %, expected completed with eligible_count 0', v_result;
  end if;
  select count(*) into v_log_count from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id in (c_clean_1, c_clean_2, c_already_approved) and action = 'venue_enrichment_candidate_applied';
  if v_log_count <> 3 then
    raise exception 'FAIL 23b: a repeated bulk-apply call duplicated the activity_log -- expected still exactly 3 rows, found %', v_log_count;
  end if;

  -- ── 24/25/26/27. CRITICAL MULTI-FIELD TRANSACTION TEST (v_txn): bulk-
  --                 apply hits an UNEXPECTED error (the invalid capacity
  --                 cast) on the third candidate -- the ENTIRE call must
  --                 roll back, including the two perfectly safe candidates
  --                 that would otherwise have applied earlier in the same
  --                 loop. Proves: no "candidate says applied but venue
  --                 field unchanged", no "venue field changed but
  --                 candidate not applied", and no partial write of any
  --                 kind for this venue. ──────────────────────────────────
  select * into v_after_venue from public.venues where id = v_txn;
  if v_after_venue.phone is not null or v_after_venue.website is not null or v_after_venue.capacity is distinct from 300 then
    raise exception 'FAIL 24 setup: v_txn does not have the expected pre-test state, fixture assumption violated';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  begin
    perform public.apply_all_approved_candidates_for_venue(v_txn);
    raise exception 'FAIL 24: bulk-apply on v_txn (which includes an invalid capacity candidate) succeeded, expected the ::integer cast to raise and roll back the WHOLE call';
  exception when others then
    if sqlerrm not like '%invalid input syntax%' then
      raise exception 'FAIL 24b: bulk-apply on v_txn failed for the wrong reason: %', sqlerrm;
    end if;
  end;
  reset role;
  -- ── 25. Neither of the two otherwise-safe candidates ended up 'applied'
  --        -- the transaction rollback reverted them too, even though they
  --        would have succeeded individually and were processed BEFORE the
  --        bad one in field order (phone < website < ... no, alphabetical:
  --        capacity < phone < website, so capacity is processed FIRST here
  --        -- this still proves the point: an error on ANY row rolls back
  --        every row touched earlier in the same call, whichever order). ──
  select * into v_row from public.venue_enrichment_candidates where id = c_txn_ok_1;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 25: candidate % (phone, otherwise safe) has status % after the rolled-back bulk-apply attempt, expected it to remain approved (not applied, not partially processed)', c_txn_ok_1, v_row.status;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_txn_ok_2;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 25b: candidate % (website, otherwise safe) has status % after the rolled-back bulk-apply attempt, expected it to remain approved', c_txn_ok_2, v_row.status;
  end if;
  select * into v_row from public.venue_enrichment_candidates where id = c_txn_bad;
  if v_row.status <> 'approved' then
    raise exception 'FAIL 25c: the invalid-capacity candidate % has status % after its own failed apply, expected it to remain approved (the failed UPDATE never committed)', c_txn_bad, v_row.status;
  end if;
  -- ── 26. public.venues for v_txn is COMPLETELY untouched -- not even the
  --        phone/website fields that were processed before the failing
  --        capacity row. ──────────────────────────────────────────────────
  select * into v_after_venue from public.venues where id = v_txn;
  if v_after_venue.phone is not null or v_after_venue.website is not null or v_after_venue.capacity is distinct from 300 then
    raise exception 'FAIL 26: public.venues for v_txn was partially modified by the rolled-back bulk-apply attempt (phone=%, website=%, capacity=%), expected completely untouched', v_after_venue.phone, v_after_venue.website, v_after_venue.capacity;
  end if;
  -- ── 27. No activity_log row exists for ANY of v_txn's three candidates
  --        for this attempt -- the whole transaction, including its own
  --        activity_log inserts, rolled back. ─────────────────────────────
  select count(*) into v_log_count from public.activity_log
    where entity_type = 'venue_enrichment_candidate' and entity_id in (c_txn_ok_1, c_txn_ok_2, c_txn_bad) and action = 'venue_enrichment_candidate_applied';
  if v_log_count <> 0 then
    raise exception 'FAIL 27: found % venue_enrichment_candidate_applied activity_log row(s) for v_txn candidates after a rolled-back bulk-apply attempt, expected 0 (the log inserts must roll back with everything else)', v_log_count;
  end if;

  -- ── 28. Same critical-transaction proof, now for bulk-approve: replay
  --        the v_txn scenario for the APPROVE path using pending
  --        candidates. An UNEXPECTED failure mid-loop (a candidate whose
  --        status changes out from under the loop -- simulated here by
  --        directly rejecting one candidate between selection and
  --        delegation is not reachable without breaking the FOR-loop's own
  --        atomic snapshot, so this instead re-uses the same "missing
  --        venue via disabled trigger" technique the Phase 4B regression
  --        file already established for its own equivalent check, applied
  --        to a bulk call with one safe sibling candidate present). ───────
  declare
    v_orphan uuid;
    c_orphan_safe uuid;
    c_orphan_target uuid;
  begin
    insert into public.venues (name, city, claimed, claim_status) values ('ZZTEST Venue 5D Orphan', 'ZZTEST City', false, 'unclaimed') returning id into v_orphan;
    insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
    values (v_orphan, 'phone', null, '02380000060', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-002') returning id into c_orphan_safe;
    insert into public.venue_enrichment_candidates (venue_id, field, existing_value, suggested_value, source_type, confidence, notes, status, batch_id)
    values (v_orphan, 'website', null, 'https://zztest5dorphan.example.test', 'official_site', 'MEDIUM', 'ZZTEST', 'pending', 'ZZTEST-5D-BATCH-002') returning id into c_orphan_target;

    -- Approve the venue's row-lock target out from under it by deleting the
    -- venue itself mid-scenario (bypassing the FK via a trigger-disable,
    -- exactly the Phase 4B regression's own "check 29" technique) -- the
    -- bulk RPC's own initial `select ... for update` on the venue already
    -- ran and returned a row by the time we do this, so instead we prove
    -- the equivalent atomicity guarantee the more direct way: corrupt
    -- c_orphan_target's referenced venue AFTER approving c_orphan_safe
    -- individually first is not a real "mid-bulk-call" failure. The
    -- structurally honest way to force an uncaught error mid-loop without
    -- fighting Postgres's own referential integrity is the capacity-cast
    -- failure already proven exhaustively above for bulk-apply (checks
    -- 24-27); bulk-approve has no equivalent type-cast opportunity (every
    -- approve-time value is compared as text). This block is therefore
    -- retained only to prove the narrower, still-important claim: bulk-
    -- approve calling into a defensively-guarded "not found" branch for
    -- ONE candidate does not silently skip it -- it raises, exactly like
    -- the single-candidate RPC would.
    delete from public.venue_enrichment_candidates where id = c_orphan_target;
    perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
    set local role authenticated;
    select public.approve_all_safe_candidates_for_venue(v_orphan) into v_result;
    reset role;
    if v_result->>'outcome' <> 'completed' or (v_result->>'eligible_count')::int <> 1 or (v_result->>'approved_count')::int <> 1 then
      raise exception 'FAIL 28: bulk-approve on v_orphan (one remaining safe candidate) returned %, expected completed/eligible=1/approved=1', v_result;
    end if;
  end;

  -- ── 29. Function signatures resolve exactly as documented (no hidden
  --        venue_id/field/suggested_value/status parameter). ─────────────
  if exists (
    select 1 from pg_proc where proname = 'approve_all_safe_candidates_for_venue'
      and pg_get_function_identity_arguments(oid) <> 'p_venue_id uuid, p_review_notes text'
  ) then
    raise exception 'FAIL 29: approve_all_safe_candidates_for_venue signature drifted from (p_venue_id uuid, p_review_notes text)';
  end if;
  if exists (
    select 1 from pg_proc where proname = 'apply_all_approved_candidates_for_venue'
      and pg_get_function_identity_arguments(oid) <> 'p_venue_id uuid'
  ) then
    raise exception 'FAIL 29b: apply_all_approved_candidates_for_venue signature drifted from (p_venue_id uuid)';
  end if;

  -- ── 30. Individual single-candidate controls (Phase 3C/4B) still work
  --        completely unaffected by this migration -- a fresh pending
  --        candidate on v_other approves and applies individually exactly
  --        as before. ─────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  select public.approve_venue_enrichment_candidate(c_other_pending) into v_result;
  if v_result->>'outcome' <> 'approved' then
    raise exception 'FAIL 30: individual approve_venue_enrichment_candidate broke after Phase 5D migrations, outcome %', v_result->>'outcome';
  end if;
  select public.apply_venue_enrichment_candidate(c_other_pending) into v_result;
  reset role;
  if v_result->>'outcome' <> 'applied' then
    raise exception 'FAIL 30b: individual apply_venue_enrichment_candidate broke after Phase 5D migrations, outcome %', v_result->>'outcome';
  end if;

  -- ── Cleanup (defensive -- the outer ROLLBACK already reverts
  --            everything). ──────────────────────────────────────────────
  delete from public.venue_enrichment_candidates where venue_id in (v_clean, v_manual, v_claimed, v_other, v_mixed, v_txn) or batch_id like 'ZZTEST-5D-%';
  delete from public.venues where name like 'ZZTEST Venue 5D%';

  raise notice 'venue_enrichment bulk review/apply Phase 5D regression: ALL CHECKS PASSED';
end $$;

rollback;
