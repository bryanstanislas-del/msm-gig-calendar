-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  STAGING ONLY -- grant admin to ONE synthetic test account on         ║
-- ║  msm-ads-staging (oyakrgdmplmxmlhjfqcd). Never on production.         ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Prerequisites (see supabase/staging/README.md):
--   * 01_ads_staging_bootstrap.sql and the ads migration have been applied;
--   * the synthetic account was created in Dashboard -> Authentication ->
--     Users -> Add user (NOT by inserting into auth.users), with an email
--     containing the tag "+msm-staging" (e.g. someone+msm-staging-admin@...),
--     and its use as a staging admin has been separately authorised.
-- Sets BOTH user_roles.role = 'admin' (database checks, is_admin_or_above)
-- and profiles.role = 'admin' (the App's existing admin-tab gate). Refuses
-- if any admin already exists (one staging admin at a time; revoke first).
-- One transaction: any failure changes nothing.

begin;

do $grant$
declare
  -- ▼▼▼ EDIT BOTH LINES
  v_email   constant text := 'EDIT-ME+msm-staging@example.invalid';
  v_confirm constant text := 'NOT-CONFIRMED';  -- set to: GRANT STAGING ADMIN ON oyakrgdmplmxmlhjfqcd
  -- ▲▲▲
  v_uid uuid;
  n int;
begin
  if v_confirm is distinct from 'GRANT STAGING ADMIN ON oyakrgdmplmxmlhjfqcd' then
    raise exception 'GRANT GUARD: confirmation phrase not set. Nothing was changed.';
  end if;
  -- Checked in two steps: a missing table must produce this guard message,
  -- not a planner error from referencing it in the same expression.
  if to_regclass('msm_staging.bootstrap') is null then
    raise exception 'GRANT GUARD: staging marker missing -- this is not the bootstrapped msm-ads-staging database. Nothing was changed.';
  end if;
  if not exists (select 1 from msm_staging.bootstrap where project_ref = 'oyakrgdmplmxmlhjfqcd') then
    raise exception 'GRANT GUARD: staging marker missing -- this is not the bootstrapped msm-ads-staging database. Nothing was changed.';
  end if;
  if to_regclass('public.ad_settings') is null then
    raise exception 'GRANT GUARD: ads migration not applied yet. Nothing was changed.';
  end if;
  if position('+msm-staging' in lower(v_email)) = 0 or v_email like 'EDIT-ME%' then
    raise exception 'GRANT GUARD: email must be the synthetic staging account (containing "+msm-staging"). Nothing was changed.';
  end if;
  select count(*) into n from auth.users where lower(email) = lower(v_email);
  if n <> 1 then
    raise exception 'GRANT GUARD: expected exactly 1 auth user with that email, found %. Create it via Dashboard -> Authentication -> Add user. Nothing was changed.', n;
  end if;
  if exists (select 1 from public.user_roles where role in ('admin', 'super_admin'))
     or exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'GRANT GUARD: an admin already exists. Revoke it first (README). Nothing was changed.';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(v_email);
  insert into public.user_roles (user_id, role) values (v_uid, 'admin');
  if exists (select 1 from public.profiles where user_id = v_uid) then
    update public.profiles set role = 'admin' where user_id = v_uid;
  else
    insert into public.profiles (user_id, role, band_name)
    values (v_uid, 'admin', 'STAGING ADMIN (synthetic test account)');
  end if;
  raise notice 'Granted STAGING admin to the synthetic account %.', v_uid;
end
$grant$;

commit;
