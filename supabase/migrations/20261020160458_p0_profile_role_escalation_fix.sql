-- ============================================================================
-- P0 SECURITY FIX: profile role escalation -> admin / super_admin takeover
--
-- Vulnerability (confirmed in definitions 2026-10-20, not exploited):
--   * authenticated held table-level UPDATE on public.profiles, and the
--     owner / assigned-manager UPDATE policies allowed every column.
--   * is_admin(), is_admin_or_above() and is_super_admin() trusted the
--     mutable profiles.role = 'admin'.
--   * Chain: owner sets own profiles.role='admin' -> is_super_admin() true ->
--     "Super admins can manage all roles" on user_roles -> permanent
--     super_admin row. Also: owner could self-set claimed/verified/disabled,
--     and a manager could reassign profiles.user_id to themselves.
--
-- Fix:
--   1. Admin helpers trust ONLY public.user_roles (the governed source).
--      admin + super_admin both count as admin, so the existing trusted
--      super_admin keeps full access. profiles.role is left as data only
--      (the UI still reads it for display gating; the DB no longer trusts it).
--   2. BEFORE UPDATE guard trigger: end-user API roles (anon/authenticated)
--      who are not trusted admins cannot change authorisation, ownership or
--      moderation columns. Ordinary profile editing is untouched.
--      service_role and SECURITY DEFINER code (claim approval etc.) run as
--      their owner role and are not restricted. Unchanged values pass, so
--      clients that resend the whole row keep working.
--      A trigger is used rather than column grants because admins also act
--      as the authenticated role; a column REVOKE would break admin edits.
--   3. Remove privileges no client path uses: anon writes on profiles, and
--      TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for anon/authenticated
--      (TRUNCATE is not covered by RLS).
--
-- Applied to production fmlaaiolqwknowhtdeue as 20261020160458; privilege
-- revokes split into 20261020160559. Verified by
-- supabase/tests/profiles_role_escalation_regression.sql (30/30 pass live).
-- ============================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- Guard: never strand a legacy admin. If any profile is role='admin' without
-- a trusted user_roles admin/super_admin membership, stop and backfill
-- explicitly first. (Production 2026-10-20: 0 such profiles.)
do $guard$
begin
  if exists (
    select 1 from public.profiles p
    where p.role = 'admin'
      and not exists (
        select 1 from public.user_roles u
        where u.user_id = p.user_id and u.role in ('admin','super_admin'))
  ) then
    raise exception 'P0 fix aborted: legacy admin profile without trusted user_roles membership. Backfill user_roles explicitly before applying.';
  end if;
end
$guard$;

-- 1. Trusted admin helpers -------------------------------------------------
create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'super_admin')
  );
$function$;

create or replace function public.is_admin_or_above()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'super_admin')
  );
$function$;

create or replace function public.is_super_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role = 'super_admin'
  );
$function$;

comment on function public.is_admin() is
  'True when auth.uid() holds admin or super_admin in public.user_roles. Never trusts profiles.role (P0 fix 2026-10-20).';
comment on function public.is_admin_or_above() is
  'True when auth.uid() holds admin or super_admin in public.user_roles. Never trusts profiles.role (P0 fix 2026-10-20).';
comment on function public.is_super_admin() is
  'True when auth.uid() holds super_admin in public.user_roles. Never trusts profiles.role (P0 fix 2026-10-20).';

-- 2. Protected-column guard -------------------------------------------------
create or replace function public.profiles_guard_protected_columns()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  v_changed text[] := array[]::text[];
begin
  -- Only end-user API roles are restricted. service_role, postgres and
  -- SECURITY DEFINER functions (which execute as their owner) pass.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if public.is_admin_or_above() then
    return new;
  end if;

  if new.id                  is distinct from old.id                  then v_changed := array_append(v_changed, 'id'::text); end if;
  if new.user_id             is distinct from old.user_id             then v_changed := array_append(v_changed, 'user_id'::text); end if;
  if new.role                is distinct from old.role                then v_changed := array_append(v_changed, 'role'::text); end if;
  if new.profile_type        is distinct from old.profile_type        then v_changed := array_append(v_changed, 'profile_type'::text); end if;
  if new.disabled            is distinct from old.disabled            then v_changed := array_append(v_changed, 'disabled'::text); end if;
  if new.admin_created       is distinct from old.admin_created       then v_changed := array_append(v_changed, 'admin_created'::text); end if;
  if new.claimed             is distinct from old.claimed             then v_changed := array_append(v_changed, 'claimed'::text); end if;
  if new.claimed_at          is distinct from old.claimed_at          then v_changed := array_append(v_changed, 'claimed_at'::text); end if;
  if new.claim_status        is distinct from old.claim_status        then v_changed := array_append(v_changed, 'claim_status'::text); end if;
  if new.verified            is distinct from old.verified            then v_changed := array_append(v_changed, 'verified'::text); end if;
  if new.verification_method is distinct from old.verification_method then v_changed := array_append(v_changed, 'verification_method'::text); end if;
  if new.created_at          is distinct from old.created_at          then v_changed := array_append(v_changed, 'created_at'::text); end if;

  if cardinality(v_changed) > 0 then
    raise exception 'Only MSM admins can change these profile fields: %', array_to_string(v_changed, ', ')
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.profiles_guard_protected_columns() is
  'Blocks non-admin anon/authenticated changes to authorisation, ownership and moderation columns on profiles (P0 fix 2026-10-20).';

drop trigger if exists profiles_guard_protected_columns on public.profiles;
create trigger profiles_guard_protected_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_protected_columns();
