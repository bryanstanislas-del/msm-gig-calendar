-- STAGING ONLY -- READ-ONLY postflight for msm-ads-staging after:
--   01_ads_staging_bootstrap.sql  +  20261015120000_ads_platform_phase1.sql
-- Changes nothing. Every row should show ok = true.
select check_name, ok, detail from (
  select 1 as ord, 'staging marker present' as check_name,
         exists (select 1 from msm_staging.bootstrap where project_ref = 'oyakrgdmplmxmlhjfqcd') as ok, '' as detail
  union all select 2, 'all ads toggles OFF',
         not exists (select 1 from public.ad_settings where bool_value),
         coalesce((select string_agg(key, ', ') from public.ad_settings where bool_value), 'none on')
  union all select 3, 'inventory + products inactive and TEST',
         not exists (select 1 from public.ad_inventory_units where active or not is_test)
         and not exists (select 1 from public.ad_products where active or not is_test), ''
  union all select 4, 'creative bucket private',
         coalesce((select not public from storage.buckets where id = 'ad-creatives-private'), false), ''
  union all select 5, 'no admin accounts yet (grant later with 04)',
         not exists (select 1 from public.user_roles) and not exists (select 1 from public.profiles where role = 'admin'),
         (select count(*)::text || ' role rows' from public.user_roles)
  union all select 6, 'no client write grants on profiles/user_roles',
         not exists (select 1 from information_schema.role_table_grants
                     where table_schema = 'public' and table_name in ('profiles', 'user_roles')
                       and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), ''
  union all select 7, 'RLS enabled on every public table',
         not exists (select 1 from pg_class k join pg_namespace s on s.oid = k.relnamespace
                     where s.nspname = 'public' and k.relkind = 'r' and not k.relrowsecurity),
         coalesce((select string_agg(k.relname, ', ') from pg_class k join pg_namespace s on s.oid = k.relnamespace
                   where s.nspname = 'public' and k.relkind = 'r' and not k.relrowsecurity), '')
  union all select 8, 'no bookings/payments yet',
         not exists (select 1 from public.ad_bookings) and not exists (select 1 from public.ad_payments), ''
) x order by ord;
