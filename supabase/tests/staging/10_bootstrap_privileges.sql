-- LOCAL ONLY. Privilege/semantics checks for the staging bootstrap, run on
-- a disposable DB after 01_ads_staging_bootstrap.sql + the ads migration.
-- One transaction, rolled back. Signal: "staging bootstrap privileges: ALL CHECKS PASSED".
begin;
create schema zz_t;
grant usage on schema zz_t to anon, authenticated, service_role;
create function zz_t.as_user(p uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create function zz_t.as_anon() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('role', 'anon', true); end $$;
create function zz_t.as_pg() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', '{}', true); perform set_config('role', 'postgres', true); end $$;
create function zz_t.err(p_sql text, p_like text, p_label text) returns void language plpgsql as $$ begin
  begin execute p_sql; exception when others then
    if sqlerrm not like p_like then raise exception 'FAIL [%]: got "%"', p_label, sqlerrm; end if; return; end;
  raise exception 'FAIL [%]: statement succeeded', p_label; end $$;
create function zz_t.ok(b boolean, l text) returns void language plpgsql as $$ begin
  if b is not true then raise exception 'FAIL [%]', l; end if; end $$;
grant execute on all functions in schema zz_t to anon, authenticated, service_role;

do $$
declare a uuid; b uuid; adm uuid; padm uuid; n int;
begin
  insert into auth.users (email) values ('zz-a@example.invalid') returning id into a;
  insert into auth.users (email) values ('zz-b@example.invalid') returning id into b;
  insert into auth.users (email) values ('zz-adm+msm-staging@example.invalid') returning id into adm;
  insert into auth.users (email) values ('zz-padm@example.invalid') returning id into padm;

  -- Function shape: security definer, empty search_path (as production).
  perform zz_t.ok((select bool_and(prosecdef) from pg_proc where proname in ('has_role', 'is_admin_or_above') and pronamespace = 'public'::regnamespace), 'helpers are SECURITY DEFINER');
  perform zz_t.ok((select bool_and(proconfig = array['search_path=""']) from pg_proc where proname in ('has_role', 'is_admin_or_above', 'update_updated_at') and pronamespace = 'public'::regnamespace), 'helpers pin search_path');
  perform zz_t.ok(not has_function_privilege('authenticated', 'public.update_updated_at()', 'execute'), 'trigger fn not client-callable');
  perform zz_t.ok(not has_table_privilege('authenticated', 'msm_staging.bootstrap', 'select'), 'marker not readable by clients');

  -- No self-registration / self-promotion paths.
  perform zz_t.as_user(a);
  perform zz_t.err(format($q$insert into public.profiles (user_id, role) values (%L, 'admin')$q$, a), '%permission denied%', 'cannot create own admin profile');
  perform zz_t.err(format($q$insert into public.profiles (user_id) values (%L)$q$, a), '%permission denied%', 'cannot create profiles at all');
  perform zz_t.err(format($q$insert into public.user_roles (user_id, role) values (%L, 'admin')$q$, a), '%permission denied%', 'cannot grant self a role');
  perform zz_t.err('delete from public.user_roles', '%permission denied%', 'cannot delete roles');
  perform zz_t.ok(not public.is_admin_or_above() and not public.has_role('admin'), 'plain user is not admin');

  perform zz_t.as_pg();
  insert into public.profiles (user_id, role, band_name) values (a, 'band', 'ZZ A'), (b, 'band', 'ZZ B');
  perform zz_t.as_user(a);
  perform zz_t.err(format($q$update public.profiles set role = 'admin' where user_id = %L$q$, a), '%permission denied%', 'cannot promote own profile');
  perform zz_t.ok((select count(*) from public.profiles) = 1 and (select user_id from public.profiles) = a, 'sees only own profile');
  -- The App's auth path queries (buildAuthFromSession) work for a signed-in user.
  perform zz_t.ok((select count(*) from public.profiles where user_id = a) = 1, 'App: profiles by user_id');
  perform zz_t.ok((select count(*) from public.user_roles where user_id = a and role like '%_manager') = 0, 'App: manager roles query');
  perform zz_t.ok((public.ad_public_flags() ->> 'portal') = 'false', 'ads flags readable, portal off');
  perform zz_t.as_anon();
  perform zz_t.ok((select count(*) from public.profiles) = 0, 'anon sees no profiles');
  perform zz_t.err('select count(*) from public.user_roles', '%permission denied%', 'anon cannot read user_roles');

  -- Admin semantics match production (user_roles admin OR profiles.role admin).
  perform zz_t.as_pg();
  insert into public.user_roles (user_id, role) values (adm, 'admin');
  insert into public.profiles (user_id, role, band_name) values (padm, 'admin', 'ZZ profile admin');
  perform zz_t.as_user(adm);
  perform zz_t.ok(public.is_admin_or_above() and public.has_role('admin'), 'user_roles admin is admin');
  perform zz_t.ok((select count(*) from public.user_roles) = 1, 'admin still reads only own role rows');
  perform zz_t.ok((select count(*) from public.ad_settings) >= 12, 'admin can read ads settings via RLS (10 phase-1 + 2 review/terms settings)');
  perform zz_t.as_user(padm);
  perform zz_t.ok(public.is_admin_or_above(), 'profiles.role admin is admin');
  perform zz_t.as_user(b);
  perform zz_t.ok(not public.is_admin_or_above(), 'other user not admin');
  perform zz_t.ok((select count(*) from public.ad_settings) = 0, 'non-admin cannot read ads settings');

  -- Grants inventory (exactly SELECT for clients).
  perform zz_t.as_pg();
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('profiles', 'user_roles') and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform zz_t.ok(n = 3, 'client grants = anon:SELECT profiles, authenticated:SELECT profiles+user_roles (got ' || n || ')');
  raise notice 'staging bootstrap privileges: ALL CHECKS PASSED';
end $$;
rollback;
