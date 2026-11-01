-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  STAGING ONLY -- msm-ads-staging (project ref oyakrgdmplmxmlhjfqcd)   ║
-- ║  NEVER run on production (fmlaaiolqwknowhtdeue) or any other project. ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Bootstraps ONLY the public prerequisites that
-- supabase/migrations/20261015120000_ads_platform_phase1.sql needs on a
-- brand-new, EMPTY hosted Supabase project, so that migration can then be
-- applied UNCHANGED. Read supabase/staging/README.md first.
--
-- Creates (public): profiles, user_roles (minimal, RLS on, read-own only,
-- NO client writes -> no self-promotion to admin), has_role(),
-- is_admin_or_above(), update_updated_at() -- bodies copied verbatim from
-- the production definitions (read-only introspection, 2026-10-15).
-- Creates (private, not API-exposed): schema msm_staging with a marker row
-- recording that this database was bootstrapped as staging.
--
-- Does NOT: touch auth/storage/extensions or any Supabase-managed schema;
-- create users, admins or rows other than the marker; enable any ads
-- toggle; create Calendar tables (gigs/venues/...: not needed for the
-- ADVERTISE/ADS tabs, see README).
--
-- PROJECT IDENTITY LIMIT: Postgres exposes no trustworthy setting that
-- names the Supabase project ref (the database is called "postgres" on
-- every project). This script therefore CANNOT prove which project it is
-- in. It enforces instead:
--   (1) an explicit opt-in phrase you must type below after confirming the
--       ref oyakrgdmplmxmlhjfqcd in the dashboard URL / Project Settings;
--   (2) Supabase platform objects are present (auth, storage, API roles);
--   (3) the application database is EMPTY: no tables/views/sequences/
--       functions in public, no ads_internal/msm_staging schema, ZERO
--       auth users, ZERO storage buckets. Production fails (3) on every
--       count (it has users, profiles, gigs, venues, band-photos, ...).
-- Any failure raises before anything is created; the whole script is one
-- transaction, so any later error rolls everything back.

begin;

do $guard$
declare
  -- ▼▼▼ OPT-IN: after checking the dashboard shows project ref
  -- oyakrgdmplmxmlhjfqcd (msm-ads-staging), replace NOT-CONFIRMED with:
  --   I AM APPLYING THIS TO msm-ads-staging oyakrgdmplmxmlhjfqcd ONLY
  v_confirm constant text := 'NOT-CONFIRMED';
  -- ▲▲▲
  v_expected constant text := 'I AM APPLYING THIS TO msm-ads-staging oyakrgdmplmxmlhjfqcd ONLY';
  n bigint;
begin
  if v_confirm is distinct from v_expected then
    raise exception 'STAGING GUARD: opt-in phrase not set. Nothing was changed. Edit v_confirm only after confirming the project ref is oyakrgdmplmxmlhjfqcd.';
  end if;

  -- (2) Must be a Supabase project (platform objects present).
  if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null
     or to_regprocedure('auth.uid()') is null
     or (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception 'STAGING GUARD: Supabase platform objects (auth, storage, API roles) not found. Nothing was changed.';
  end if;

  -- (3) Application database must be empty.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  if n > 0 then raise exception 'STAGING GUARD: public schema already has % relation(s) (e.g. gigs/profiles/venues/ad_*). This is not an empty staging project. Nothing was changed.', n; end if;

  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if n > 0 then raise exception 'STAGING GUARD: public schema already has % function(s). Existing functions are never replaced. Nothing was changed.', n; end if;

  if exists (select 1 from pg_namespace where nspname in ('ads_internal', 'msm_staging')) then
    raise exception 'STAGING GUARD: ads_internal/msm_staging schema already exists (already bootstrapped?). Nothing was changed.';
  end if;

  select count(*) into n from auth.users;
  if n > 0 then raise exception 'STAGING GUARD: auth.users has % user(s). Bootstrap must run before any test account is created. Nothing was changed.', n; end if;

  select count(*) into n from storage.buckets;
  if n > 0 then raise exception 'STAGING GUARD: storage has % bucket(s). Nothing was changed.', n; end if;

  raise notice 'STAGING GUARD passed: empty Supabase application database, opt-in confirmed.';
end
$guard$;

-- ── Staging marker (private schema; not exposed through the Data API) ──
create schema msm_staging;
revoke all on schema msm_staging from public;
create table msm_staging.bootstrap (
  project_ref text primary key check (project_ref = 'oyakrgdmplmxmlhjfqcd'),
  purpose text not null,
  applied_at timestamptz not null default now()
);
revoke all on msm_staging.bootstrap from public;
insert into msm_staging.bootstrap (project_ref, purpose)
values ('oyakrgdmplmxmlhjfqcd', 'STAGING ONLY - ads phase 1 verification. No real customer data.');
comment on schema msm_staging is 'STAGING ONLY marker for msm-ads-staging (oyakrgdmplmxmlhjfqcd). Must never exist on production.';

-- ── update_updated_at (verbatim production body) ───────────────────────
create function public.update_updated_at()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- ── user_roles (minimal; same columns as production) ───────────────────
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin', 'band_manager', 'venue_manager',
                                     'festival_manager', 'promoter_manager', 'organisation_manager')),
  managed_entity_type text,
  managed_entity_id uuid,
  granted_by uuid,
  created_at timestamptz not null default now()
);
comment on table public.user_roles is 'STAGING ONLY minimal role table. Clients may only read their own rows; roles are granted from the SQL editor (see supabase/staging/04_grant_synthetic_admin.sql).';
alter table public.user_roles enable row level security;
create policy "Users can view own roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid());

-- ── profiles (minimal subset of production columns the App reads) ──────
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  role text not null default 'band' check (role in ('band', 'admin')),
  band_name text,
  profile_type text,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'STAGING ONLY minimal profiles (no Calendar data). Read-own only; no client INSERT/UPDATE/DELETE, so nobody can promote themselves to admin.';
alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles
  for select to authenticated using (user_id = auth.uid());
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at();

-- ── Role helpers (verbatim production bodies) ──────────────────────────
create function public.has_role(check_role text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = check_role
  );
$function$;

create function public.is_admin_or_above()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    public.has_role('super_admin')
    or public.has_role('admin')
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin');
$function$;

-- ── Least-privilege grants (override Supabase's default public grants) ─
revoke all on public.profiles, public.user_roles from public, anon, authenticated;
grant select on public.profiles to anon, authenticated;   -- RLS: own row only (anon: none)
grant select on public.user_roles to authenticated;       -- RLS: own rows only
grant all on public.profiles, public.user_roles to service_role;

revoke all on function public.update_updated_at() from public, anon, authenticated;
revoke all on function public.has_role(text), public.is_admin_or_above() from public;
grant execute on function public.has_role(text), public.is_admin_or_above() to anon, authenticated, service_role;

-- ── Post-checks (still inside the transaction) ─────────────────────────
do $post$
begin
  if exists (select 1 from information_schema.role_table_grants
             where table_schema = 'public' and table_name in ('profiles', 'user_roles')
               and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT') then
    raise exception 'POST-CHECK: clients have write privileges on profiles/user_roles';
  end if;
  if exists (select 1 from information_schema.column_privileges
             where table_schema = 'public' and table_name in ('profiles', 'user_roles')
               and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE')) then
    raise exception 'POST-CHECK: clients have column write privileges on profiles/user_roles';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass) then
    raise exception 'POST-CHECK: RLS not enabled';
  end if;
  if (select count(*) from public.profiles) + (select count(*) from public.user_roles) <> 0 then
    raise exception 'POST-CHECK: unexpected rows';
  end if;
  raise notice 'STAGING BOOTSTRAP complete. Next: apply supabase/migrations/20261015120000_ads_platform_phase1.sql unchanged.';
end
$post$;

commit;
