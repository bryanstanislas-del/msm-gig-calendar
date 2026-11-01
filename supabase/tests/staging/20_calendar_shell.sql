-- LOCAL ONLY. Checks supabase/staging/05_calendar_shell_fixture.sql after it
-- was applied to a bootstrapped local staging stand-in (with the synthetic
-- admin from 04). Runs the app's startup/admin-login queries (same filters
-- and ordering as src/App.jsx) as anon / advertiser / admin. Rolled back.
begin;
do $$
declare adm uuid; usr uuid; n int;
begin
  select id into adm from auth.users where email = 'tester+msm-staging-admin@example.invalid';
  select id into usr from auth.users where email = 'real.person@example.invalid';
  -- synthetic rows (rolled back) to prove visibility rules
  insert into public.gigs (slug, band_name, status, date) values ('zz-a', 'ZZ approved', 'approved', '2026-12-01'), ('zz-p', 'ZZ pending', 'pending', '2026-12-02');
  insert into public.claim_requests (user_id) values (usr);
  insert into public.notification_deliveries (recipient_user_id) values (adm);

  -- anon: Calendar startup
  perform set_config('role', 'anon', true);
  perform count(*) from (select * from public.gigs where status = 'approved' order by date, id) x;
  select count(*) into n from public.gigs; if n <> 1 then raise exception 'FAIL [anon sees approved gigs only] got %', n; end if;
  perform count(*) from (select * from public.venues order by name, id) x;
  perform count(*) from (select id from public.gigs where status = 'pending') x;
  begin insert into public.gigs (band_name) values ('x'); raise exception 'FAIL [anon insert gigs succeeded]'; exception when insufficient_privilege then null; end;
  begin insert into public.venues (name) values ('x'); raise exception 'FAIL [anon insert venues succeeded]'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.claim_requests; raise exception 'FAIL [anon read claim_requests]'; exception when insufficient_privilege then null; end;

  -- non-admin login (buildAuthFromSession + unread badge)
  perform set_config('request.jwt.claims', json_build_object('sub', usr, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform count(*) from (select * from public.venues where user_id = usr) x;
  select count(*) into n from public.notification_deliveries where recipient_user_id = usr and delivery_channel = 'in_app' and read_state = 'unread';
  select count(*) into n from public.notification_deliveries; if n <> 0 then raise exception 'FAIL [user sees others notifications]'; end if;
  select count(*) into n from public.claim_requests; if n <> 0 then raise exception 'FAIL [non-admin sees claim requests]'; end if;
  select count(*) into n from public.gigs; if n <> 1 then raise exception 'FAIL [non-admin sees pending gigs]'; end if;
  begin update public.gigs set status = 'approved'; raise exception 'FAIL [authenticated update gigs succeeded]'; exception when insufficient_privilege then null; end;
  begin delete from public.notification_deliveries; raise exception 'FAIL [authenticated delete succeeded]'; exception when insufficient_privilege then null; end;

  -- admin login + admin tab (getAllGigs, getGigCounts, getClaimRequests)
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) into n from (select * from public.gigs order by created_at desc, id) x; if n <> 2 then raise exception 'FAIL [admin sees all gigs] got %', n; end if;
  select count(*) into n from (select * from public.claim_requests order by created_at desc) x; if n <> 1 then raise exception 'FAIL [admin reads claim requests]'; end if;
  select count(*) into n from public.notification_deliveries where recipient_user_id = adm and delivery_channel = 'in_app' and read_state = 'unread';
  if n <> 1 then raise exception 'FAIL [admin unread badge]'; end if;
  begin insert into public.claim_requests (user_id) values (adm); raise exception 'FAIL [admin client insert succeeded]'; exception when insufficient_privilege then null; end;

  perform set_config('role', 'postgres', true);
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('gigs', 'venues', 'claim_requests', 'notification_deliveries')
     and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') and privilege_type <> 'SELECT';
  if n <> 0 then raise exception 'FAIL [non-SELECT client grants exist: %]', n; end if;
  raise notice 'staging calendar shell: ALL CHECKS PASSED';
end $$;
rollback;
