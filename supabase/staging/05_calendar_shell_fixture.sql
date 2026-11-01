-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  STAGING ONLY -- msm-ads-staging (project ref oyakrgdmplmxmlhjfqcd)   ║
-- ║  NEVER run on production (fmlaaiolqwknowhtdeue) or any other project. ║
-- ║  NOT a migration: deliberately outside supabase/migrations.           ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Why: with the shared Supabase client (commit 367d29a) an isolated preview
-- now talks ONLY to staging, so the Calendar shell's startup reads hit
-- tables the ads bootstrap never created (preview stuck on "Loading gigs":
-- public.gigs / public.venues missing from the schema cache).
--
-- Creates EMPTY, READ-ONLY shell tables with just the columns the app's
-- startup and synthetic admin/advertiser login paths filter/order on
-- (src/App.jsx DB.getApprovedGigs/getAllGigs/getGigCounts, getVenues,
-- buildAuthFromSession, getClaimRequests, getUnreadNotificationCount; the
-- app selects "*", so extra production columns are not needed for an empty
-- table):
--   gigs, venues, claim_requests, notification_deliveries
-- profiles/user_roles already exist from 01_ads_staging_bootstrap.sql.
--
-- Does NOT: copy any production row or schema beyond those column names;
-- grant ANY client INSERT/UPDATE/DELETE (RLS on, SELECT-only policies);
-- touch existing tables; add anything to production migrations; hide
-- errors (other Calendar screens -- follows, notifications page, claims
-- workflow, import -- still need their real tables and will show errors).
--
-- Guards (all checked before anything is created; one transaction):
--   (1) explicit opt-in phrase below;
--   (2) msm_staging.bootstrap marker row for oyakrgdmplmxmlhjfqcd exists
--       (production never has this schema);
--   (3) every auth user is synthetic (@example.invalid);
--   (4) none of the four tables (or any other object with those names)
--       exists -- an existing schema is never altered.

begin;

do $guard$
declare
  -- ▼▼▼ OPT-IN: after checking the dashboard shows project ref
  -- oyakrgdmplmxmlhjfqcd (msm-ads-staging), replace NOT-CONFIRMED with:
  --   I AM APPLYING THE CALENDAR SHELL TO msm-ads-staging oyakrgdmplmxmlhjfqcd ONLY
  v_confirm constant text := 'NOT-CONFIRMED';
  -- ▲▲▲
  v_expected constant text := 'I AM APPLYING THE CALENDAR SHELL TO msm-ads-staging oyakrgdmplmxmlhjfqcd ONLY';
  n bigint;
begin
  if v_confirm is distinct from v_expected then
    raise exception 'STAGING GUARD: opt-in phrase not set. Nothing was changed.';
  end if;
  -- Checked in two steps: the marker table may not exist at all (production).
  if to_regclass('msm_staging.bootstrap') is null then
    raise exception 'STAGING GUARD: msm_staging marker for oyakrgdmplmxmlhjfqcd not found (not the bootstrapped staging project). Nothing was changed.';
  end if;
  execute 'select count(*) from msm_staging.bootstrap where project_ref = $1' into n using 'oyakrgdmplmxmlhjfqcd';
  if n <> 1 then
    raise exception 'STAGING GUARD: msm_staging marker for oyakrgdmplmxmlhjfqcd not found (not the bootstrapped staging project). Nothing was changed.';
  end if;
  select count(*) into n from auth.users where coalesce(email, '') not like '%@example.invalid';
  if n > 0 then
    raise exception 'STAGING GUARD: % non-synthetic auth user(s) present (staging accounts must be @example.invalid). Nothing was changed.', n;
  end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('gigs', 'venues', 'claim_requests', 'notification_deliveries');
  if n > 0 then
    raise exception 'STAGING GUARD: % of gigs/venues/claim_requests/notification_deliveries already exist; existing schema is never altered. Nothing was changed.', n;
  end if;
  if to_regprocedure('public.is_admin_or_above()') is null then
    raise exception 'STAGING GUARD: public.is_admin_or_above() missing (run 01_ads_staging_bootstrap.sql first). Nothing was changed.';
  end if;
end $guard$;

create table if not exists msm_staging.fixtures (
  name text primary key,
  applied_at timestamptz not null default now(),
  note text not null
);
revoke all on msm_staging.fixtures from public;
insert into msm_staging.fixtures (name, note)
values ('calendar_shell_v1', 'STAGING ONLY empty read-only gigs/venues/claim_requests/notification_deliveries for app startup');

-- ── gigs: public sees approved only; admins see all ─────────────────────
create table public.gigs (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  band_name text,
  venue text,
  city text,
  date date,
  time text,
  genre text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  band_profile_id uuid,
  venue_id uuid,
  festival_profile_id uuid,
  submitted_by uuid,
  created_at timestamptz not null default now()
);
comment on table public.gigs is 'STAGING ONLY empty Calendar shell (05_calendar_shell_fixture.sql). No client writes.';
alter table public.gigs enable row level security;
create policy gigs_select_approved on public.gigs for select to anon, authenticated using (status = 'approved');
create policy gigs_select_admin on public.gigs for select to authenticated using (public.is_admin_or_above());

-- ── venues: public read ─────────────────────────────────────────────────
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  city text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.venues is 'STAGING ONLY empty Calendar shell. No client writes.';
alter table public.venues enable row level security;
create policy venues_select_all on public.venues for select to anon, authenticated using (true);

-- ── claim_requests: admins only (admin tab load) ────────────────────────
create table public.claim_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
comment on table public.claim_requests is 'STAGING ONLY empty Calendar shell. Admin read only; no client writes.';
alter table public.claim_requests enable row level security;
create policy claim_requests_select_admin on public.claim_requests for select to authenticated using (public.is_admin_or_above());

-- ── notification_deliveries: own rows only (unread badge) ───────────────
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references auth.users(id) on delete cascade,
  delivery_channel text not null default 'in_app',
  read_state text not null default 'unread',
  created_at timestamptz not null default now()
);
comment on table public.notification_deliveries is 'STAGING ONLY empty Calendar shell. Own rows read only; no client writes.';
alter table public.notification_deliveries enable row level security;
create policy notification_deliveries_select_own on public.notification_deliveries for select to authenticated using (recipient_user_id = auth.uid());

-- SELECT only for API roles; no INSERT/UPDATE/DELETE/TRUNCATE for anyone but the owner.
revoke all on public.gigs, public.venues, public.claim_requests, public.notification_deliveries from public, anon, authenticated, service_role;
grant select on public.gigs, public.venues to anon, authenticated;
grant select on public.claim_requests, public.notification_deliveries to authenticated;

commit;
