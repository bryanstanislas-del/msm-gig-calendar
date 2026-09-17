-- Regression proof for the gigs INSERT RLS hardening (see migration
-- 20260917000000_harden_gigs_insert_rls.sql for the full rationale).
--
-- UNLIKE this directory's other regression files (e.g.
-- gig_auto_venue_regression.sql), this one must NEVER be run directly
-- against production, even though it is self-contained in a single
-- BEGIN...ROLLBACK and nothing it does would persist. It deliberately
-- exercises identity/role-spoofing paths -- an anonymous insert attempt,
-- one authenticated user impersonating another via submitted_by, one
-- claimed artist targeting another artist's band_profile_id -- and the
-- Verified Artist Self-Service security review that produced this
-- migration was explicit that production rows must never be used for
-- this kind of mutation testing, rollback or not. Run it only against a
-- local/disposable database that has this repo's migrations applied
-- (e.g. `supabase start` + `supabase db reset` locally, or an
-- equivalent throwaway clone), never with a production connection
-- string:
--   psql "$LOCAL_DATABASE_URL" -f supabase/tests/gigs_insert_rls_regression.sql
--
-- Every check RAISEs EXCEPTION with a distinct message on failure, so a
-- clean "NOTICE: gigs_insert_rls regression: ALL CHECKS PASSED" (with
-- the final ROLLBACK) is the signal, exactly like this directory's other
-- regression files. Uses ZZTEST-prefixed names throughout.
--
-- Verified against an ad hoc local Postgres 16 harness (faithfully
-- reproducing the relevant schema slice from production, confirmed via
-- read-only introspection) before this migration was proposed: all of
-- A-J below passed, plus admin-insert and a SECURITY-DEFINER-bypasses-
-- RLS structural check. This file re-expresses those same checks
-- against the real, migration-built schema for ongoing regression
-- coverage.

begin;

do $$
declare
  u_a uuid; u_b uuid; u_c uuid; u_d uuid; u_e uuid; u_admin uuid; u_legacy uuid;
  p_a uuid; p_b uuid; p_d uuid; p_legacy uuid; p_admin uuid;
  g_id uuid;
begin
  -- ── Fixtures: distinct auth users + profiles, ZZTEST-prefixed ──────
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_a;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_b;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_c;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_d;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_e;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_admin;
  insert into auth.users (id) values (gen_random_uuid()) returning id into u_legacy;

  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Band A', u_a, true, 'claimed', false, 'band', 'band') returning id into p_a;
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Band B', u_b, true, 'claimed', false, 'band', 'band') returning id into p_b;
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Solo D', u_d, true, 'claimed', false, 'solo_artist', 'band') returning id into p_d;
  -- Mirrors the live "6 legacy accounts" shape: user_id set, never claimed.
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Legacy', u_legacy, false, 'unclaimed', false, 'band', 'band') returning id into p_legacy;
  insert into public.profiles (band_name, user_id, claimed, claim_status, admin_created, profile_type, role)
  values ('ZZTEST Admin', u_admin, false, 'unclaimed', false, 'band', 'admin') returning id into p_admin;

  -- ── A. anon insert, pending -> DENY ──
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    insert into public.gigs (band_name, venue, city, date, status)
    values ('ZZTEST A', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending');
    raise exception 'FAIL A: anon insert (pending) was ALLOWED, expected DENY';
  exception when insufficient_privilege then null; -- expected
  end;
  reset role;

  -- ── B. authenticated, submitted_by=self, band_profile_id=NULL, pending -> ALLOW ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_e)::text, true);
  set local role authenticated;
  insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
  values ('ZZTEST B', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending', u_e, null)
  returning id into g_id;
  if g_id is null then
    raise exception 'FAIL B: fan submission with null band_profile_id was DENIED, expected ALLOW';
  end if;
  delete from public.gigs where id = g_id;
  reset role;

  -- ── C. claimed Band A: submitted_by=A, band_profile_id=Band A, pending -> ALLOW ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_a)::text, true);
  set local role authenticated;
  insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
  values ('ZZTEST C', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending', u_a, p_a)
  returning id into g_id;
  if g_id is null then
    raise exception 'FAIL C: Band A submitting as Band A was DENIED, expected ALLOW';
  end if;
  delete from public.gigs where id = g_id;
  reset role;

  -- ── D. claimed Band A targeting Band B's profile -> DENY ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_a)::text, true);
  set local role authenticated;
  begin
    insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
    values ('ZZTEST D', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending', u_a, p_b);
    raise exception 'FAIL D: Band A spoofing Band B''s band_profile_id was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── E. Band A spoofing submitted_by=C -> DENY ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_a)::text, true);
  set local role authenticated;
  begin
    insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
    values ('ZZTEST E', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending', u_c, p_a);
    raise exception 'FAIL E: Band A spoofing submitted_by=C was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── F. Band A self-approving -> DENY ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_a)::text, true);
  set local role authenticated;
  begin
    insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
    values ('ZZTEST F', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'approved', u_a, p_a);
    raise exception 'FAIL F: Band A submitting status=approved was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── G. same with rejected -> DENY ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_a)::text, true);
  set local role authenticated;
  begin
    insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
    values ('ZZTEST G', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'rejected', u_a, p_a);
    raise exception 'FAIL G: Band A submitting status=rejected was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── H. legacy user_id-set-but-unclaimed profile -> DENY ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_legacy)::text, true);
  set local role authenticated;
  begin
    insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
    values ('ZZTEST H', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending', u_legacy, p_legacy);
    raise exception 'FAIL H: legacy unclaimed-but-user_id-set profile was ALLOWED, expected DENY';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── I. claimed solo_artist ownership -> ALLOW ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_d)::text, true);
  set local role authenticated;
  insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
  values ('ZZTEST I', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending', u_d, p_d)
  returning id into g_id;
  if g_id is null then
    raise exception 'FAIL I: claimed solo_artist submitting as themselves was DENIED, expected ALLOW';
  end if;
  delete from public.gigs where id = g_id;
  reset role;

  -- ── J. non-existent band_profile_id -> DENY / FK-safe failure ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_a)::text, true);
  set local role authenticated;
  begin
    insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
    values ('ZZTEST J', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'pending', u_a, gen_random_uuid());
    raise exception 'FAIL J: non-existent band_profile_id was ALLOWED, expected DENY/FK failure';
  exception
    when insufficient_privilege then null;
    when foreign_key_violation then null;
  end;
  reset role;

  -- ── Regression: admin insert (approved, any band_profile_id) still works ──
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);
  set local role authenticated;
  insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id)
  values ('ZZTEST ADMIN', 'ZZTEST Venue', 'ZZTEST City', '2027-01-01', 'approved', u_admin, p_b)
  returning id into g_id;
  if g_id is null then
    raise exception 'FAIL ADMIN: admin insert of an approved gig for another profile was DENIED, expected ALLOW';
  end if;
  delete from public.gigs where id = g_id;
  reset role;

  raise notice 'gigs_insert_rls regression: ALL CHECKS PASSED';
end $$;

rollback;
