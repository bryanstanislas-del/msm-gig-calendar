-- Regression proof for the venue_enrichment_candidates staging table (see
-- migration 20260918120000_venue_enrichment_candidates.sql for the full
-- rationale).
--
-- Self-contained: this file CREATEs the table, its constraints, its RLS
-- policies and its trigger itself, inside this same transaction (byte-
-- for-byte matching the migration), so it works whether or not that
-- migration has actually been applied yet -- and, like
-- import_gig_row_venue_id_regression.sql, nothing it does ever persists
-- either way, because of the final ROLLBACK.
--
-- UNLIKE that file, and exactly like gigs_insert_rls_regression.sql, this
-- one must NEVER be run directly against production, even though it is
-- self-contained in a single BEGIN...ROLLBACK. It creates a real table
-- (DDL) and exercises role-based RLS denial/allow paths against fixture
-- `auth.users`/`public.profiles` rows -- the same category of mutation
-- testing that file's own header comment says production must never be
-- used for, rollback or not. Run it only against a local/disposable
-- database that already has this repo's migrations applied (e.g.
-- `supabase start` + `supabase db reset` locally, or an equivalent
-- throwaway clone):
--   psql "$LOCAL_DATABASE_URL" -f supabase/tests/venue_enrichment_candidates_regression.sql
--
-- NOT executed against any database as part of this PR -- see the PR
-- description's own "migration safety" confirmation. Written now so it is
-- ready to run the moment this migration is reviewed and applied
-- somewhere safe to do so.
--
-- Every check RAISEs EXCEPTION with a distinct message on failure, so a
-- clean "NOTICE: venue_enrichment_candidates regression: ALL CHECKS
-- PASSED" (with the final ROLLBACK) is the signal, same convention as
-- this directory's other regression files. Uses ZZTEST-prefixed names
-- throughout.

begin;

-- ── Apply the proposed migration itself, byte-for-byte, inside this
--    transaction only (idempotent-safe via IF NOT EXISTS/OR REPLACE where
--    the migration itself already uses them) ──
create table if not exists public.venue_enrichment_candidates (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete restrict,
  field text not null,
  constraint venue_enrichment_candidates_field_check
    check (field = any (array[
      'postcode', 'address', 'capacity', 'contact_email', 'phone',
      'description', 'website', 'facebook', 'instagram', 'twitter',
      'photo_url', 'seo_title', 'seo_description', 'seo_search_phrases'
    ])),
  existing_value text,
  suggested_value text,
  source_url text,
  source_type text,
  constraint venue_enrichment_candidates_source_type_check
    check (source_type is null or source_type = any (array[
      'official_site', 'official_social', 'operator_site',
      'ticketing_platform', 'press', 'other', 'generated'
    ])),
  retrieved_at timestamptz,
  confidence text,
  constraint venue_enrichment_candidates_confidence_check
    check (confidence is null or confidence = any (array['HIGH', 'MEDIUM', 'LOW'])),
  notes text,
  status text not null default 'pending',
  constraint venue_enrichment_candidates_status_check
    check (status = any (array[
      'pending', 'approved', 'rejected', 'applied',
      'stale_conflict', 'skipped_no_source', 'skipped_ambiguous'
    ])),
  constraint venue_enrichment_candidates_skip_has_no_value
    check (
      (status in ('skipped_no_source', 'skipped_ambiguous') and suggested_value is null)
      or
      (status not in ('skipped_no_source', 'skipped_ambiguous') and suggested_value is not null)
    ),
  constraint venue_enrichment_candidates_found_has_provenance
    check (
      (status in ('skipped_no_source', 'skipped_ambiguous') and source_type is null and confidence is null)
      or
      (status not in ('skipped_no_source', 'skipped_ambiguous') and source_type is not null and confidence is not null)
    ),
  batch_id text not null,
  constraint venue_enrichment_candidates_batch_id_not_blank
    check (trim(batch_id) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_enrichment_candidates_unique_per_batch
    unique (venue_id, field, batch_id)
);

alter table public.venue_enrichment_candidates enable row level security;

drop policy if exists "venue_enrichment_candidates_admin_all" on public.venue_enrichment_candidates;
create policy "venue_enrichment_candidates_admin_all" on public.venue_enrichment_candidates
  for all using (public.is_admin_or_above()) with check (public.is_admin_or_above());

do $$
declare
  u_admin uuid; u_fan uuid; u_owner uuid; u_manager uuid;
  p_admin uuid;
  v_id uuid;
  c_id uuid;
begin
  -- ── Fixtures: a ZZTEST venue, plus distinct auth users for each role
  --    this table's RLS must distinguish ──
  insert into public.venues (name, city) values ('ZZTEST Venue', 'ZZTEST City') returning id into v_id;

  insert into auth.users (id) values (gen_random_uuid()) returning id into u_admin;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_fan;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_owner;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_manager;

  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Admin', u_admin, false, 'unclaimed', false, 'band', 'admin') returning id into p_admin;

  -- The venue's own claimed owner, and a separately-assigned manager --
  -- neither should get any access to this table merely from that status.
  update public.venues set user_id = u_owner, claimed = true, claim_status = 'claimed' where id = v_id;
  insert into public.user_roles (user_id, managed_entity_type, managed_entity_id)
  values (u_manager, 'venue', v_id);

  -- ── A. anon: no access at all -- DENY select ──
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  if exists (select 1 from public.venue_enrichment_candidates limit 1) then
    raise exception 'FAIL A: anon could read venue_enrichment_candidates, expected DENY (or table happens to be empty -- re-check with a seeded row)';
  end if;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, status, batch_id)
    values (v_id, 'postcode', 'SO14 3AB', 'pending', 'ZZTEST-BATCH-001');
    raise exception 'FAIL A2: anon insert was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── B. ordinary authenticated fan (no admin, no claim, no manager
  --      role) -- DENY select and insert ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_fan)::text, true);
  set local role authenticated;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, status, batch_id)
    values (v_id, 'postcode', 'SO14 3AB', 'pending', 'ZZTEST-BATCH-001');
    raise exception 'FAIL B: ordinary authenticated user insert was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── C. the venue's own claimed OWNER -- DENY. Owning/claiming a venue
  --      grants self-service UPDATE on public.venues itself, but must
  --      grant NOTHING on this internal research table. ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner)::text, true);
  set local role authenticated;
  if exists (select 1 from public.venue_enrichment_candidates where venue_id = v_id) then
    raise exception 'FAIL C: claimed venue owner could read their own venue''s candidates, expected DENY';
  end if;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, status, batch_id)
    values (v_id, 'postcode', 'SO14 3AB', 'pending', 'ZZTEST-BATCH-001');
    raise exception 'FAIL C2: claimed venue owner insert was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── D. the venue's assigned MANAGER -- DENY, same reasoning as C ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_manager)::text, true);
  set local role authenticated;
  if exists (select 1 from public.venue_enrichment_candidates where venue_id = v_id) then
    raise exception 'FAIL D: venue manager could read their managed venue''s candidates, expected DENY';
  end if;
  reset role;

  -- ── E. MSM admin -- ALLOW insert/select/update/delete ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_url, source_type, confidence, notes, status, batch_id)
  values (v_id, 'postcode', 'SO14 3AB', 'https://example.test/contact', 'official_site', 'HIGH', 'ZZTEST', 'pending', 'ZZTEST-BATCH-001')
  returning id into c_id;
  if c_id is null then
    raise exception 'FAIL E: admin insert was DENIED, expected ALLOW';
  end if;
  if not exists (select 1 from public.venue_enrichment_candidates where id = c_id) then
    raise exception 'FAIL E2: admin select of the row it just inserted was DENIED, expected ALLOW';
  end if;
  update public.venue_enrichment_candidates set status = 'approved' where id = c_id;
  delete from public.venue_enrichment_candidates where id = c_id;
  reset role;

  -- ── F. field allow-list: an arbitrary/disallowed field is REJECTED by
  --      the CHECK constraint, not silently accepted. source_type/
  --      confidence are supplied here (unlike earlier drafts of this
  --      test) so the insert fails ONLY on the field allow-list, not
  --      also on venue_enrichment_candidates_found_has_provenance --
  --      isolates exactly what this test claims to prove. ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'user_id', 'ZZTEST', 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-001');
    raise exception 'FAIL F: an arbitrary field (user_id) was ACCEPTED, expected CHECK violation';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'claim_status', 'claimed', 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-001');
    raise exception 'FAIL F2: claim_status was ACCEPTED as a field, expected CHECK violation';
  exception when check_violation then null;
  end;
  reset role;

  -- ── G. skip-status/suggested_value pairing is enforced ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, status, batch_id)
    values (v_id, 'capacity', '450', 'skipped_no_source', 'ZZTEST-BATCH-001');
    raise exception 'FAIL G: a skipped_no_source row with a non-null suggested_value was ACCEPTED, expected CHECK violation';
  exception when check_violation then null;
  end;
  begin
    -- source_type/confidence supplied so this fails ONLY on
    -- venue_enrichment_candidates_skip_has_no_value (a pending row needs
    -- a real suggested_value), not also on the provenance CHECK.
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'capacity', null, 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-001');
    raise exception 'FAIL G2: a pending row with a null suggested_value was ACCEPTED, expected CHECK violation';
  exception when check_violation then null;
  end;
  -- ...but a correctly-paired skip row IS accepted.
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, status, batch_id)
  values (v_id, 'capacity', null, 'skipped_ambiguous', 'ZZTEST-BATCH-001') returning id into c_id;
  if c_id is null then
    raise exception 'FAIL G3: a correctly-paired skipped_ambiguous row (null suggested_value) was rejected, expected ALLOW';
  end if;
  delete from public.venue_enrichment_candidates where id = c_id;
  reset role;

  -- ── H. UNIQUE (venue_id, field, batch_id): a second row for the same
  --      venue+field+batch is rejected; the SAME venue+field in a
  --      DIFFERENT batch is allowed (history across research runs).
  --      source_type/confidence supplied throughout so every insert here
  --      satisfies the provenance CHECK and this test isolates the
  --      UNIQUE constraint specifically. ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'phone', '02380000000', 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-001') returning id into c_id;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'phone', '02380000001', 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-001');
    raise exception 'FAIL H: a duplicate venue+field+batch row was ACCEPTED, expected UNIQUE violation';
  exception when unique_violation then null;
  end;
  -- A later, separate batch is free to propose its own row for the same venue+field.
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'phone', '02380000002', 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-002');
  delete from public.venue_enrichment_candidates where venue_id = v_id and field = 'phone';
  reset role;

  -- ── I/J (independent-review correction, replaces the old CASCADE test):
  --      venue_id references public.venues(id) ON DELETE RESTRICT --
  --      deleting a venue that still has candidate rows must fail, not
  --      silently destroy its provenance/audit history. ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'website', 'https://example.test', 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-003') returning id into c_id;
  reset role;
  begin
    delete from public.venues where id = v_id; -- as table owner, bypassing RLS in this test harness
    raise exception 'FAIL I: venue deletion was ALLOWED while a candidate row still referenced it, expected ON DELETE RESTRICT to block it';
  exception when foreign_key_violation then null;
  end;

  -- ── J: once the candidate row is explicitly removed, the same venue
  --      CAN then be deleted -- RESTRICT blocks an oversight, it doesn't
  --      permanently trap the venue. ──
  delete from public.venue_enrichment_candidates where id = c_id;
  delete from public.venues where id = v_id;
  if exists (select 1 from public.venues where id = v_id) then
    raise exception 'FAIL J: venue deletion still failed after its only candidate row was removed, expected ALLOW';
  end if;
  -- Re-seed the ZZTEST venue for the remaining tests below.
  insert into public.venues (name, city) values ('ZZTEST Venue', 'ZZTEST City') returning id into v_id;

  -- ── K (independent-review correction): a 'pending' row with
  --      source_type/confidence both NULL is REJECTED by
  --      venue_enrichment_candidates_found_has_provenance -- the exact
  --      malformed-row scenario the independent review flagged (a
  --      candidate the JS validator would reject, that the database
  --      previously accepted anyway). ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'postcode', 'SO14 3AB', null, null, 'pending', 'ZZTEST-BATCH-004');
    raise exception 'FAIL K: a pending row with source_type/confidence both NULL was ACCEPTED, expected CHECK violation';
  exception when check_violation then null;
  end;

  -- ── L: the same row, with valid source_type/confidence, IS accepted --
  --      proves K failed because of the missing provenance, not for some
  --      unrelated reason. ──
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'postcode', 'SO14 3AB', 'official_site', 'HIGH', 'pending', 'ZZTEST-BATCH-004') returning id into c_id;
  if c_id is null then
    raise exception 'FAIL L: a pending row with valid source_type/confidence was REJECTED, expected ALLOW';
  end if;
  delete from public.venue_enrichment_candidates where id = c_id;

  -- ── M: skipped_no_source with source_type/confidence both NULL is
  --      accepted (the normal "nothing found" shape). ──
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'phone', null, null, null, 'skipped_no_source', 'ZZTEST-BATCH-004') returning id into c_id;
  if c_id is null then
    raise exception 'FAIL M: a skipped_no_source row with NULL source_type/confidence was REJECTED, expected ALLOW';
  end if;
  delete from public.venue_enrichment_candidates where id = c_id;

  -- ── N: skipped_no_source with a populated source_type/confidence is
  --      REJECTED -- a skip is a "nothing to suggest" marker and must not
  --      carry provenance implying otherwise. ──
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'phone', null, 'official_site', 'HIGH', 'skipped_no_source', 'ZZTEST-BATCH-004');
    raise exception 'FAIL N: a skipped_no_source row with populated source_type/confidence was ACCEPTED, expected CHECK violation';
  exception when check_violation then null;
  end;

  -- ── O: skipped_ambiguous with source_type/confidence both NULL is
  --      accepted, same reasoning as M. ──
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'capacity', null, null, null, 'skipped_ambiguous', 'ZZTEST-BATCH-004') returning id into c_id;
  if c_id is null then
    raise exception 'FAIL O: a skipped_ambiguous row with NULL source_type/confidence was REJECTED, expected ALLOW';
  end if;
  delete from public.venue_enrichment_candidates where id = c_id;

  -- ── P (independent-review correction): batch_id non-blank CHECK --
  --      a real label is accepted; '' and whitespace-only are rejected. ──
  insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
  values (v_id, 'address', 'ZZTEST Address', 'official_site', 'HIGH', 'pending', 'VENUE-ENRICH-ZZTEST-001') returning id into c_id;
  if c_id is null then
    raise exception 'FAIL P: a non-blank batch_id (''VENUE-ENRICH-ZZTEST-001'') was REJECTED, expected ALLOW';
  end if;
  delete from public.venue_enrichment_candidates where id = c_id;

  -- ── Q: an empty-string batch_id is REJECTED ──
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'address', 'ZZTEST Address', 'official_site', 'HIGH', 'pending', '');
    raise exception 'FAIL Q: an empty-string batch_id was ACCEPTED, expected CHECK violation';
  exception when check_violation then null;
  end;

  -- ── R: a whitespace-only batch_id is REJECTED ──
  begin
    insert into public.venue_enrichment_candidates (venue_id, field, suggested_value, source_type, confidence, status, batch_id)
    values (v_id, 'address', 'ZZTEST Address', 'official_site', 'HIGH', 'pending', '   ');
    raise exception 'FAIL R: a whitespace-only batch_id was ACCEPTED, expected CHECK violation';
  exception when check_violation then null;
  end;

  -- Clean up the re-seeded ZZTEST venue -- no candidates reference it any
  -- more, so this also re-confirms RESTRICT only blocks a REFERENCED
  -- venue (see I/J above), not venue deletion in general.
  delete from public.venues where id = v_id;

  raise notice 'venue_enrichment_candidates regression: ALL CHECKS PASSED';
end $$;

rollback;
