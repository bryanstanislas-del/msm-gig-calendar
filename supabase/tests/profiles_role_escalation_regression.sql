-- ============================================================================
-- Regression test: P0 profile role escalation
--
-- SELF-ROLLING-BACK. Creates throwaway auth users / profiles / manager role,
-- simulates each caller via SET ROLE + request.jwt.claims, then RAISES its
-- results as an exception so nothing persists. Safe to run against any
-- environment (no pg_net, handle_new_user is a no-op, no mail sent).
--
-- Usage: run as a single batch (optionally prefixed by a migration to test
-- it uncommitted). Read the result block from the error message.
-- The real trusted super_admin is used for the admin path by lookup only;
-- its identity is never printed.
-- ============================================================================

create function pg_temp.as_role(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $f$
declare v text; n bigint;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  perform set_config('role', p_role, true);
  execute p_sql into v;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  return 'OK rows=' || n || coalesce(' val=' || v, '');
exception when others then
  perform set_config('role', 'none', true);
  return 'ERR ' || sqlstate;
end $f$;

do $t$
declare
  uA uuid := gen_random_uuid();   -- owner of pA
  uB uuid := gen_random_uuid();   -- owner of pB (other user)
  uM uuid := gen_random_uuid();   -- assigned manager of pA
  uL uuid := gen_random_uuid();   -- legacy-only "admin" (profiles.role='admin', no user_roles)
  uS uuid;                        -- real trusted super_admin (lookup only)
  pA uuid := gen_random_uuid();
  pB uuid := gen_random_uuid();
  pL uuid := gen_random_uuid();
  r  text := E'\n';
  x  text;
  fails int := 0;
begin
  select user_id into uS from public.user_roles where role = 'super_admin' limit 1;

  insert into auth.users (id, aud, role, email)
  values (uA,'authenticated','authenticated','p0test-a@invalid.test'),
         (uB,'authenticated','authenticated','p0test-b@invalid.test'),
         (uM,'authenticated','authenticated','p0test-m@invalid.test'),
         (uL,'authenticated','authenticated','p0test-l@invalid.test');

  insert into public.profiles (id, user_id, band_name, band_slug, role, profile_type, disabled, claimed, claim_status, band_status)
  values (pA, uA, 'P0 Test A', 'p0-test-a-'||left(pA::text,8), 'band', 'band', false, true, 'claimed', 'active'),
         (pB, uB, 'P0 Test B', 'p0-test-b-'||left(pB::text,8), 'band', 'band', false, true, 'claimed', 'active'),
         (pL, uL, 'P0 Test L', 'p0-test-l-'||left(pL::text,8), 'admin','band', false, true, 'claimed', 'active');

  insert into public.user_roles (user_id, role, managed_entity_type, managed_entity_id)
  values (uM, 'band_manager', 'band', pA);

  -- helper to record expectation
  -- format: label | expected-prefix | actual
  -- ---------------------------------------------------------------- owner
  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set bio=%L where id=%L returning id', 'owner edit', pA));
  r := r || 'T01 owner edits own bio        expect OK rows=1   : ' || x || E'\n'; if x not like 'OK rows=1%' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set band_slug=%L, band_status=%L where id=%L returning id', 'p0-a-new-'||left(pA::text,8), 'active', pA));
  r := r || 'T02 owner sets slug/status     expect OK rows=1   : ' || x || E'\n'; if x not like 'OK rows=1%' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set bio=%L, role=role, claimed=claimed, user_id=user_id where id=%L returning id', 'resend row', pA));
  r := r || 'T03 owner resends unchanged    expect OK rows=1   : ' || x || E'\n'; if x not like 'OK rows=1%' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set role=%L where id=%L returning id', 'admin', pA));
  r := r || 'T04 owner self-promotes role   expect ERR 42501   : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, 'select public.is_admin()::text');
  r := r || 'T05 owner is_admin()           expect val=false   : ' || x || E'\n'; if x not like '%val=false' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, 'select public.is_super_admin()::text');
  r := r || 'T06 owner is_super_admin()     expect val=false   : ' || x || E'\n'; if x not like '%val=false' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('insert into public.user_roles(user_id,role) values (%L,%L) returning id', uA, 'super_admin'));
  r := r || 'T07 owner inserts super_admin  expect ERR 42501   : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set verified=true where id=%L returning id', pA));
  r := r || 'T08 owner sets verified        expect ERR 42501   : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set disabled=true where id=%L returning id', pA));
  r := r || 'T09 owner sets disabled        expect ERR 42501   : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set user_id=%L where id=%L returning id', uB, pA));
  r := r || 'T10 owner reassigns user_id    expect ERR         : ' || x || E'\n'; if x not like 'ERR%' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set claimed=false, claim_status=%L where id=%L returning id', 'unclaimed', pA));
  r := r || 'T11 owner changes claim state  expect ERR 42501   : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  -- ------------------------------------------------------------ other user
  x := pg_temp.as_role('authenticated', uA, format('update public.profiles set bio=%L where id=%L returning id', 'cross', pB));
  r := r || 'T12 user edits other profile   expect OK rows=0   : ' || x || E'\n'; if x not like 'OK rows=0%' then fails := fails+1; end if;

  -- --------------------------------------------------------------- manager
  x := pg_temp.as_role('authenticated', uM, format('update public.profiles set bio=%L where id=%L returning id', 'mgr edit', pA));
  r := r || 'T13 manager edits managed bio  expect OK rows=1   : ' || x || E'\n'; if x not like 'OK rows=1%' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uM, format('update public.profiles set user_id=%L where id=%L returning id', uM, pA));
  r := r || 'T14 manager hijacks user_id    expect ERR 42501   : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uM, format('update public.profiles set role=%L where id=%L returning id', 'admin', pA));
  r := r || 'T15 manager sets role          expect ERR 42501   : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uM, format('update public.profiles set bio=%L where id=%L returning id', 'mgr cross', pB));
  r := r || 'T16 manager edits unmanaged    expect OK rows=0   : ' || x || E'\n'; if x not like 'OK rows=0%' then fails := fails+1; end if;

  -- ---------------------------------------------------- legacy-only admin
  x := pg_temp.as_role('authenticated', uL, 'select public.is_admin()::text');
  r := r || 'T17 legacy role=admin is_admin expect val=false   : ' || x || E'\n'; if x not like '%val=false' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uL, 'select public.is_super_admin()::text');
  r := r || 'T18 legacy is_super_admin      expect val=false   : ' || x || E'\n'; if x not like '%val=false' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uL, format('update public.profiles set bio=%L where id=%L returning id', 'legacy', pB));
  r := r || 'T19 legacy edits other profile expect OK rows=0   : ' || x || E'\n'; if x not like 'OK rows=0%' then fails := fails+1; end if;

  -- ------------------------------------------------- trusted super_admin
  if uS is null then
    r := r || 'T20-T25 SKIPPED: no trusted super_admin in this database' || E'\n';
  else
    x := pg_temp.as_role('authenticated', uS, 'select public.is_admin()::text');
    r := r || 'T20 trusted admin is_admin()   expect val=true    : ' || x || E'\n'; if x not like '%val=true' then fails := fails+1; end if;
    x := pg_temp.as_role('authenticated', uS, 'select public.is_admin_or_above()::text');
    r := r || 'T21 trusted is_admin_or_above  expect val=true    : ' || x || E'\n'; if x not like '%val=true' then fails := fails+1; end if;
    x := pg_temp.as_role('authenticated', uS, 'select public.is_super_admin()::text');
    r := r || 'T22 trusted is_super_admin()   expect val=true    : ' || x || E'\n'; if x not like '%val=true' then fails := fails+1; end if;
    x := pg_temp.as_role('authenticated', uS, format('update public.profiles set disabled=true where id=%L returning id', pB));
    r := r || 'T23 admin disables a profile   expect OK rows=1   : ' || x || E'\n'; if x not like 'OK rows=1%' then fails := fails+1; end if;
    x := pg_temp.as_role('authenticated', uS, format('update public.profiles set verified=true, bio=%L where id=%L returning id', 'admin edit', pA));
    r := r || 'T24 admin edits protected cols expect OK rows=1   : ' || x || E'\n'; if x not like 'OK rows=1%' then fails := fails+1; end if;
    x := pg_temp.as_role('authenticated', uS, 'select count(*)::text from public.profiles');
    r := r || 'T25 admin reads all profiles   expect val>0       : ' || x || E'\n'; if x like '%val=0' or x like 'ERR%' then fails := fails+1; end if;
  end if;

  -- ------------------------------------------------------------------ anon
  x := pg_temp.as_role('anon', null, 'select count(*)::text from public.profiles');
  r := r || 'T26 anon reads public listing  expect OK val>0    : ' || x || E'\n'; if x like 'ERR%' or x like '%val=0' then fails := fails+1; end if;

  x := pg_temp.as_role('anon', null, format('update public.profiles set bio=%L where id=%L returning id', 'anon', pA));
  r := r || 'T27 anon update                expect ERR / rows=0: ' || x || E'\n'; if x not like 'ERR%' and x not like 'OK rows=0%' then fails := fails+1; end if;

  x := pg_temp.as_role('anon', null, 'select public.is_admin()::text');
  r := r || 'T28 anon is_admin() (RLS use)  expect val=false   : ' || x || E'\n'; if x not like '%val=false' then fails := fails+1; end if;

  -- --------------------------------------------------------- service_role
  x := pg_temp.as_role('service_role', null, format('update public.profiles set verified=true, claimed=false, claim_status=%L where id=%L returning id', 'unclaimed', pB));
  r := r || 'T29 service_role protected upd expect OK rows=1   : ' || x || E'\n'; if x not like 'OK rows=1%' then fails := fails+1; end if;

  -- --------------------------------------------- SECURITY DEFINER path
  -- Mirrors approve_claim_request(): admin-gated definer code owned by
  -- postgres must still be able to set claim/ownership fields.
  execute format($fn$
    create function pg_temp.p0_definer_claim(p uuid, u uuid) returns uuid
    language sql security definer set search_path='' as
    'update public.profiles set user_id = $2, claimed = true, claim_status = ''claimed'', claimed_at = now() where id = $1 returning id'
  $fn$);
  update public.profiles set user_id = null, claimed = false, claim_status = 'unclaimed' where id = pL;
  x := pg_temp.as_role('authenticated', uA, format('select pg_temp.p0_definer_claim(%L,%L)::text', pL, uA));
  r := r || 'T30 definer fn sets claim cols expect OK val=<id> : ' || case when x like 'OK%val=%' then 'OK (definer allowed)' else x end || E'\n';
  if x not like 'OK%val=%' then fails := fails+1; end if;

  r := r || E'\nFAILURES=' || fails;
  raise exception 'P0_TEST_RESULTS (rolled back): %', r;
end
$t$;
