-- Regression test: newsletter consent identity binding (P1).
-- SELF-ROLLING-BACK: raises its results as an exception. No mail is sent.
-- Expect FAILURES=0. Requires 20261020160948 + 20261020160953.
-- Last run: production 2026-10-20 after apply, 15/15 pass.

create function pg_temp.as_role(p_role text, p_uid uuid, p_email text, p_sql text) returns text
language plpgsql as $f$
declare v text; n bigint;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_uid, 'role', p_role, 'email', p_email)::text end, true);
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
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uS uuid;
  pA uuid := gen_random_uuid(); pB uuid := gen_random_uuid();
  eA text := 'nltest-a@invalid.test'; eB text := 'nltest-b@invalid.test'; eV text := 'nltest-victim@invalid.test';
  r text := E'\n'; x text; fails int := 0; v_row record;
begin
  select user_id into uS from public.user_roles where role = 'super_admin' limit 1;
  insert into auth.users (id, aud, role, email) values (uA,'authenticated','authenticated',eA),(uB,'authenticated','authenticated',eB);
  insert into public.profiles (id, user_id, band_name, band_slug, role, profile_type, disabled, claimed, claim_status, band_status)
  values (pA, uA, 'NL Test A', 'nl-test-a-'||left(pA::text,8), 'band','band', false, true, 'claimed','active'),
         (pB, uB, 'NL Test B', 'nl-test-b-'||left(pB::text,8), 'band','band', false, true, 'claimed','active');
  -- victim already subscribed (simulates an existing real subscriber)
  insert into public.newsletter_subscribers (email, newsletter_opt_in, newsletter_opt_in_date, newsletter_source)
  values (eV, true, now(), 'registration');
  -- victim previously unsubscribed record
  insert into public.newsletter_subscribers (email, newsletter_opt_in, newsletter_source, unsubscribed_at)
  values ('nltest-unsub@invalid.test', false, 'registration', now());

  x := pg_temp.as_role('anon', null, null, format('select public.record_newsletter_opt_in(%L,%L,null)::text', 'nltest-unsub@invalid.test', 'website_signup'));
  r := r || 'N01 anon forges opt-in (re-subscribes unsub)  expect ERR 42501 : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, eA, format('select (public.record_newsletter_opt_in(%L,%L,null)->>%L)', upper(eA), 'registration', 'email'));
  r := r || 'N02 user opts in own email (case)             expect OK        : ' || x || E'\n'; if x not like 'OK%val=' || eA then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, eA, format('select public.record_newsletter_opt_in(%L,%L,null)::text', 'nltest-unsub@invalid.test', 'registration'));
  r := r || 'N03 user forges opt-in for other email        expect ERR 42501 : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, eA, format('select public.record_newsletter_opt_in(%L,%L,%L)::text', eA, 'registration', pB));
  select profile_id into v_row from public.newsletter_subscribers where email = eA;
  r := r || 'N04 link foreign profile_id ignored           expect null      : ' || coalesce(v_row.profile_id::text,'null') || E'\n'; if v_row.profile_id is not null then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, eA, format('select public.record_newsletter_opt_in(%L,%L,%L)::text', eA, 'registration', pA));
  select profile_id into v_row from public.newsletter_subscribers where email = eA;
  r := r || 'N05 link own profile_id                       expect own       : ' || case when v_row.profile_id = pA then 'own' else coalesce(v_row.profile_id::text,'null') end || E'\n'; if v_row.profile_id is distinct from pA then fails := fails+1; end if;

  x := pg_temp.as_role('anon', null, null, format('select public.record_newsletter_opt_out(%L)::text', eV));
  r := r || 'N06 anon unsubscribes victim                  expect ERR 42501 : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, eA, format('select public.record_newsletter_opt_out(%L)::text', eV));
  r := r || 'N07 user unsubscribes victim                  expect ERR 42501 : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  select newsletter_opt_in, unsubscribed_at into v_row from public.newsletter_subscribers where email = eV;
  r := r || 'N08 victim still subscribed                   expect true      : ' || v_row.newsletter_opt_in || E'\n'; if not v_row.newsletter_opt_in or v_row.unsubscribed_at is not null then fails := fails+1; end if;

  select newsletter_opt_in into v_row from public.newsletter_subscribers where email = 'nltest-unsub@invalid.test';
  r := r || 'N09 unsubscribed record not re-opted          expect false     : ' || v_row.newsletter_opt_in || E'\n'; if v_row.newsletter_opt_in then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, eA, format('select (public.record_newsletter_opt_out(%L)->>%L)', eA, 'newsletter_opt_in'));
  r := r || 'N10 user unsubscribes own email               expect OK false  : ' || x || E'\n'; if x not like 'OK%val=false' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uB, eB, format('select (public.record_newsletter_opt_out(%L)->>%L)', eB, 'newsletter_opt_in'));
  r := r || 'N11 opt-out w/o subscription uniform reply    expect OK false  : ' || x || E'\n'; if x not like 'OK%val=false' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uA, eA, format('select (public.record_newsletter_opt_in(%L,%L,null)->>%L)', eA, 'website_signup', 'newsletter_opt_in'));
  r := r || 'N12 own re-subscribe after opt-out            expect OK true   : ' || x || E'\n'; if x not like 'OK%val=true' then fails := fails+1; end if;

  x := pg_temp.as_role('anon', null, null, 'select count(*)::text from public.newsletter_subscribers');
  r := r || 'N13 anon reads subscriber table               expect ERR 42501 : ' || x || E'\n'; if x <> 'ERR 42501' then fails := fails+1; end if;

  x := pg_temp.as_role('authenticated', uB, eB, 'select count(*)::text from public.newsletter_subscribers');
  r := r || 'N14 user sees only own rows                   expect val=0     : ' || x || E'\n'; if x not like '%val=0' then fails := fails+1; end if;

  if uS is null then r := r || 'N15 SKIPPED' || E'\n'; fails := fails+1;
  else
    x := pg_temp.as_role('authenticated', uS, null, format('select (public.admin_unsubscribe_user(%L)->>%L)', eV, 'email'));
    r := r || 'N15 admin unsubscribe path still works        expect OK        : ' || x || E'\n'; if x not like 'OK%val=' || eV then fails := fails+1; end if;
  end if;

  r := r || E'\nFAILURES=' || fails;
  raise exception 'NEWSLETTER_TEST_RESULTS (rolled back): %', r;
end
$t$;
