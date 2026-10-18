-- STAGING ONLY -- READ-ONLY preflight for msm-ads-staging (oyakrgdmplmxmlhjfqcd).
-- Changes nothing. Run in the SQL Editor of the project whose URL/Settings
-- show ref oyakrgdmplmxmlhjfqcd BEFORE 01_ads_staging_bootstrap.sql.
-- Expected on a fresh empty project: every count 0, verdict EMPTY.
-- Postgres cannot report the Supabase project ref itself; confirm the ref
-- in the dashboard (URL https://supabase.com/dashboard/project/oyakrgdmplmxmlhjfqcd).
with c as (
  select
    current_database() as database,
    current_setting('server_version') as postgres_version,
    (select count(*) from pg_class k join pg_namespace s on s.oid = k.relnamespace
      where s.nspname = 'public' and k.relkind in ('r','p','v','m','S','f')
        and not exists (select 1 from pg_depend d where d.objid = k.oid and d.deptype = 'e')) as public_relations,
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) as public_functions,
    (select count(*) from auth.users) as auth_users,
    (select count(*) from storage.buckets) as storage_buckets,
    (select count(*) from pg_namespace where nspname in ('ads_internal', 'msm_staging')) as ads_or_marker_schemas
)
select *,
  case when public_relations = 0 and public_functions = 0 and auth_users = 0 and storage_buckets = 0 and ads_or_marker_schemas = 0
       then 'EMPTY - OK to run 01_ads_staging_bootstrap.sql (after confirming the project ref in the dashboard)'
       else 'NOT EMPTY - DO NOT RUN the bootstrap here' end as verdict
from c;
