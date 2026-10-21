-- ============================================================================
-- Regression: public read models + private base tables.
-- SELF-ROLLING-BACK: raises its results as an exception; nothing persists.
-- Run against a database with the read-model and base-table migrations
-- applied (or prefix them, uncommitted). Expect FAILURES=0.
-- Last run: production 2026-10-21 after 20261021043228, 58/58 pass.
-- Roles covered: anon, unrelated authenticated, owner, assigned manager,
-- venue owner, trusted admin, plus alternate paths (views, RPCs, claim views,
-- slug helpers, gig submission policy) and earlier P0/newsletter fixes.
-- ============================================================================

create function pg_temp.as_role(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $f$
declare v text; n bigint;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  perform set_config('role', p_role, true);
  execute p_sql into v;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  return 'OK rows=' || n || coalesce(' val=' || v, '');
exception when others then
  perform set_config('role', 'none', true);
  return 'ERR ' || sqlstate;
end $f$;

create function pg_temp.chk(p_label text, p_got text, p_like text, inout r text, inout fails int) language plpgsql as $f$
begin
  r := r || rpad(p_label, 46) || ': ' || coalesce(p_got,'<null>') || case when coalesce(p_got,'') like p_like then '' else '   <-- FAIL (want ' || p_like || ')' end || E'\n';
  if coalesce(p_got,'') not like p_like then fails := fails + 1; end if;
end $f$;

do $t$
declare
  uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid(); uM uuid := gen_random_uuid(); uV uuid := gen_random_uuid(); uS uuid;
  pA uuid := gen_random_uuid(); pB uuid := gen_random_uuid(); pD uuid := gen_random_uuid();
  vV uuid := gen_random_uuid(); vW uuid := gen_random_uuid();
  gA uuid := gen_random_uuid(); gP uuid := gen_random_uuid();
  r text := E'\n'; fails int := 0; x text; n_all bigint; n_pub bigint; dslug text;
begin
  select user_id into uS from public.user_roles where role = 'super_admin' limit 1;
  insert into auth.users (id, aud, role, email) values
    (uA,'authenticated','authenticated','pc-a@invalid.test'), (uB,'authenticated','authenticated','pc-b@invalid.test'),
    (uM,'authenticated','authenticated','pc-m@invalid.test'), (uV,'authenticated','authenticated','pc-v@invalid.test');
  dslug := 'pc-disabled-' || left(pD::text, 8);
  insert into public.profiles (id, user_id, band_name, band_slug, role, profile_type, disabled, claimed, claim_status, band_status, booking_email, phone, postcode, management_contact)
  values (pA, uA, 'PC Test Alpha', 'pc-alpha-'||left(pA::text,8), 'band','band', false, true, 'claimed','active', 'booking@pc-a.test', '07000000001', 'ZZ1 1ZZ', 'mgmt@pc-a.test'),
         (pB, uB, 'PC Test Beta',  'pc-beta-'||left(pB::text,8),  'band','band', false, true, 'claimed','active', 'booking@pc-b.test', '07000000002', null, null),
         (pD, uB, 'PC Disabled',   dslug,                         'band','band', true,  true, 'claimed','active', null, null, null, null);
  insert into public.venues (id, name, city, slug, user_id, contact_email, phone, address, postcode, claimed, claim_status)
  values (vV, 'PC Owned Venue', 'Testtown', 'pc-owned-'||left(vV::text,8), uV, 'info@pc-v.test', '07000000003', '1 Test St', 'ZZ2 2ZZ', true, 'claimed'),
         (vW, 'PC Managed Venue', 'Testtown', 'pc-managed-'||left(vW::text,8), null, 'info@pc-w.test', '07000000004', '2 Test St', 'ZZ3 3ZZ', false, 'unclaimed');
  insert into public.user_roles (user_id, role, managed_entity_type, managed_entity_id)
  values (uM, 'band_manager', 'band', pA), (uM, 'venue_manager', 'venue', vW);
  insert into public.gigs (id, band_name, venue, city, date, status, submitted_by, band_profile_id, venue_id, slug)
  values (gA, 'PC Test Alpha', 'PC Owned Venue', 'Testtown', current_date + 30, 'approved', uA, pA, vV, 'pc-gig-a-'||left(gA::text,8)),
         (gP, 'PC Test Beta',  'PC Owned Venue', 'Testtown', current_date + 31, 'pending',  uB, pB, vV, 'pc-gig-p-'||left(gP::text,8));

  -- ---------------------------------------------------------------- anon
  select c.r, c.fails into r, fails from pg_temp.chk('C01 anon base profiles', pg_temp.as_role('anon', null, 'select count(*)::text from public.profiles'), 'ERR 42501', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C02 anon base profiles.phone', pg_temp.as_role('anon', null, 'select phone from public.profiles limit 1'), 'ERR 42501', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C03 anon base venues', pg_temp.as_role('anon', null, 'select count(*)::text from public.venues'), 'ERR 42501', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C04 anon base gigs', pg_temp.as_role('anon', null, 'select count(*)::text from public.gigs'), 'ERR 42501', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C05 anon public profile listed', pg_temp.as_role('anon', null, format('select band_name from public.public_profiles where id=%L', pA)), 'OK rows=1 val=PC Test Alpha', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C06 anon booking hidden (no consent)', pg_temp.as_role('anon', null, format('select coalesce(booking_email, management_contact, postcode, ''hidden'') from public.public_profiles where id=%L', pA)), '%val=hidden', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C07 anon view has no phone column', pg_temp.as_role('anon', null, 'select phone from public.public_profiles limit 1'), 'ERR 42703', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C08 anon view has no user_id column', pg_temp.as_role('anon', null, 'select user_id from public.public_profiles limit 1'), 'ERR 42703', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C09 anon gigs view no submitted_by', pg_temp.as_role('anon', null, 'select submitted_by from public.public_gigs limit 1'), 'ERR 42703', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C10 anon venues view no contact_email', pg_temp.as_role('anon', null, 'select contact_email from public.public_venues limit 1'), 'ERR 42703', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C11 anon venue location public', pg_temp.as_role('anon', null, format('select address||'' ''||postcode from public.public_venues where id=%L', vV)), 'OK rows=1 val=1 Test St ZZ2 2ZZ', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C12 anon pending gig not public', pg_temp.as_role('anon', null, format('select count(*)::text from public.public_gigs where id=%L', gP)), '%val=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C13 anon disabled profile not public', pg_temp.as_role('anon', null, format('select count(*)::text from public.public_profiles where id=%L', pD)), '%val=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C14 anon write via view denied', pg_temp.as_role('anon', null, format('update public.public_profiles set bio=''x'' where id=%L returning id', pA)), 'ERR 42501', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C15 anon claim view works', pg_temp.as_role('anon', null, format('select claim_status from public.profile_claim_status_v where id=%L', pA)), 'OK rows=1 val=claimed', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C16 anon featured listings RPC', pg_temp.as_role('anon', null, 'select count(*)::text from public.get_featured_listings(null)'), 'OK%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C17 anon editorial RPC', pg_temp.as_role('anon', null, 'select count(*)::text from public.get_editorial_features(null)'), 'OK%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C18 anon editorial archive RPC', pg_temp.as_role('anon', null, 'select count(*)::text from public.get_editorial_archive(null,null)'), 'OK%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C19 anon supporters RPC', pg_temp.as_role('anon', null, 'select count(*)::text from public.get_founding_supporters()'), 'OK%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C20 anon search_entities (id,name,city only)', pg_temp.as_role('anon', null, 'select string_agg(name, '','') from public.search_entities(''band'',''PC Test'',5)'), '%PC Test%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C21 anon search hides disabled', pg_temp.as_role('anon', null, 'select count(*)::text from public.search_entities(''band'',''PC Disabled'',5) where name = ''PC Disabled'''), '%val=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C22 slug helper dedups vs private rows', pg_temp.as_role('anon', null, format('select (public.generate_band_slug(%L) = %L)::text', dslug, dslug || '-2')), '%val=true', r, fails) c;

  -- ------------------------------------------------ unrelated signed-in user
  select c.r, c.fails into r, fails from pg_temp.chk('C23 other user base profile row', pg_temp.as_role('authenticated', uB, format('select phone from public.profiles where id=%L', pA)), 'OK rows=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C24 other user base venue row', pg_temp.as_role('authenticated', uB, format('select contact_email from public.venues where id=%L', vV)), 'OK rows=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C25 other user others'' gig row', pg_temp.as_role('authenticated', uB, format('select submitted_by::text from public.gigs where id=%L', gA)), 'OK rows=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C26 other user view: contacts hidden', pg_temp.as_role('authenticated', uB, format('select coalesce(booking_email,''hidden'') from public.public_profiles where id=%L', pA)), '%val=hidden', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C27 other user cannot edit profile', pg_temp.as_role('authenticated', uB, format('update public.profiles set bio=''x'' where id=%L returning id', pA)), 'OK rows=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C28 other user cannot set consent', pg_temp.as_role('authenticated', uB, format('update public.profiles set public_contacts_consent=true where id=%L returning id', pA)), 'OK rows=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C29 other user sees own pending gig', pg_temp.as_role('authenticated', uB, format('select count(*)::text from public.gigs where id=%L', gP)), '%val=1', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C30 other user submits a gig', pg_temp.as_role('authenticated', uB, 'insert into public.gigs (band_name, venue, city, date, status, submitted_by) values (''PC New'', ''Somewhere'', ''Testtown'', current_date + 40, ''pending'', auth.uid()) returning status'), 'OK rows=1 val=pending', r, fails) c;

  -- ----------------------------------------------------------------- owner
  select c.r, c.fails into r, fails from pg_temp.chk('C31 owner reads own private fields', pg_temp.as_role('authenticated', uA, format('select booking_email||''/''||phone||''/''||postcode from public.profiles where id=%L', pA)), 'OK rows=1 val=booking@pc-a.test/07000000001/ZZ1 1ZZ', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C32 owner edits own profile', pg_temp.as_role('authenticated', uA, format('update public.profiles set bio=''owner'' where id=%L returning id', pA)), 'OK rows=1%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C33 owner reads own gig', pg_temp.as_role('authenticated', uA, format('select count(*)::text from public.gigs where id=%L', gA)), '%val=1', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C34 claimed owner gig submit w/ profile', pg_temp.as_role('authenticated', uA, format('insert into public.gigs (band_name, venue, city, date, status, submitted_by, band_profile_id) values (''PC Test Alpha'', ''Somewhere'', ''Testtown'', current_date + 41, ''pending'', auth.uid(), %L) returning status', pA)), 'OK rows=1 val=pending', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C35 owner opts in to public contacts', pg_temp.as_role('authenticated', uA, format('update public.profiles set public_contacts_consent=true where id=%L returning id', pA)), 'OK rows=1%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C36 anon sees contacts after opt-in', pg_temp.as_role('anon', null, format('select booking_email||''/''||management_contact from public.public_profiles where id=%L', pA)), 'OK rows=1 val=booking@pc-a.test/mgmt@pc-a.test', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C37 band postcode still private', pg_temp.as_role('anon', null, format('select coalesce(postcode,''hidden'') from public.public_profiles where id=%L', pA)), '%val=hidden', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C38 owner self-promotion still blocked', pg_temp.as_role('authenticated', uA, format('update public.profiles set role=''admin'' where id=%L returning id', pA)), 'ERR 42501', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C39 owner reads own disabled profile', pg_temp.as_role('authenticated', uB, format('select count(*)::text from public.profiles where id=%L', pD)), '%val=1', r, fails) c;

  -- --------------------------------------------------------------- manager
  select c.r, c.fails into r, fails from pg_temp.chk('C40 manager reads managed profile', pg_temp.as_role('authenticated', uM, format('select phone from public.profiles where id=%L', pA)), 'OK rows=1 val=07000000001', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C41 manager edits managed profile', pg_temp.as_role('authenticated', uM, format('update public.profiles set bio=''mgr'' where id=%L returning id', pA)), 'OK rows=1%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C42 manager blocked on other profile', pg_temp.as_role('authenticated', uM, format('select count(*)::text from public.profiles where id=%L', pB)), '%val=0', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C43 venue manager reads venue', pg_temp.as_role('authenticated', uM, format('select contact_email from public.venues where id=%L', vW)), 'OK rows=1 val=info@pc-w.test', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C44 venue manager edits venue', pg_temp.as_role('authenticated', uM, format('update public.venues set description=''m'' where id=%L returning id', vW)), 'OK rows=1%', r, fails) c;

  -- ----------------------------------------------------------- venue owner
  select c.r, c.fails into r, fails from pg_temp.chk('C45 venue owner reads own venue', pg_temp.as_role('authenticated', uV, format('select phone from public.venues where id=%L', vV)), 'OK rows=1 val=07000000003', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C46 venue owner edits own venue', pg_temp.as_role('authenticated', uV, format('update public.venues set description=''o'' where id=%L returning id', vV)), 'OK rows=1%', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C47 venue owner blocked on other venue', pg_temp.as_role('authenticated', uV, format('select count(*)::text from public.venues where id=%L', vW)), '%val=0', r, fails) c;

  -- ----------------------------------------------------------------- admin
  if uS is null then
    r := r || 'C48-C52 SKIPPED (no trusted admin)' || E'\n'; fails := fails + 1;
  else
    select count(*) into n_all from public.profiles;
    select c.r, c.fails into r, fails from pg_temp.chk('C48 admin reads all profiles', pg_temp.as_role('authenticated', uS, 'select count(*)::text from public.profiles'), '%val=' || n_all, r, fails) c;
    select count(*) into n_all from public.gigs;
    select c.r, c.fails into r, fails from pg_temp.chk('C49 admin reads all gigs (all statuses)', pg_temp.as_role('authenticated', uS, 'select count(*)::text from public.gigs'), '%val=' || n_all, r, fails) c;
    select c.r, c.fails into r, fails from pg_temp.chk('C50 admin reads venue contact', pg_temp.as_role('authenticated', uS, format('select contact_email from public.venues where id=%L', vV)), 'OK rows=1 val=info@pc-v.test', r, fails) c;
    select c.r, c.fails into r, fails from pg_temp.chk('C51 admin edits private profile field', pg_temp.as_role('authenticated', uS, format('update public.profiles set phone=''07000000009'' where id=%L returning id', pB)), 'OK rows=1%', r, fails) c;
    select c.r, c.fails into r, fails from pg_temp.chk('C52 admin moderates gig', pg_temp.as_role('authenticated', uS, format('update public.gigs set status=''approved'' where id=%L returning status', gP)), 'OK rows=1 val=approved', r, fails) c;
  end if;

  -- ------------------------------------------------- public calendar intact
  select count(*) into n_pub from public.gigs where status = 'approved';
  select c.r, c.fails into r, fails from pg_temp.chk('C53 anon public gig count = approved', pg_temp.as_role('anon', null, 'select count(*)::text from public.public_gigs'), '%val=' || n_pub, r, fails) c;
  select count(*) into n_pub from public.profiles where profile_type in ('band','solo_artist','festival','promoter','organisation') and disabled = false;
  select c.r, c.fails into r, fails from pg_temp.chk('C54 anon public profile count', pg_temp.as_role('anon', null, 'select count(*)::text from public.public_profiles'), '%val=' || n_pub, r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C55 anon public venue count', pg_temp.as_role('anon', null, 'select count(*)::text from public.public_venues'), '%val=' || (select count(*) from public.venues), r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C56 festival location public', pg_temp.as_role('anon', null, 'select count(*)::text from public.public_profiles where profile_type=''festival'' and postcode is not null'), '%val=' || (select count(*) from public.profiles where profile_type='festival' and disabled=false and postcode is not null), r, fails) c;

  -- -------------------------------------------------- earlier fixes intact
  select c.r, c.fails into r, fails from pg_temp.chk('C57 newsletter anon opt-in still blocked', pg_temp.as_role('anon', null, 'select public.record_newsletter_opt_in(''x@invalid.test'',''website_signup'',null)::text'), 'ERR 42501', r, fails) c;
  select c.r, c.fails into r, fails from pg_temp.chk('C58 import RPC anon still blocked', pg_temp.as_role('anon', null, 'select public.start_import_run(''x'',1)::text'), 'ERR 42501', r, fails) c;

  r := r || E'\nFAILURES=' || fails;
  raise exception 'PUBLIC_CONTACT_EXPOSURE (rolled back): %', r;
end
$t$;
