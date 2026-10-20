-- ============================================================================
-- PRE-FIX SNAPSHOT + ROLLBACK for the P0 profile-role-escalation fix
-- Project: msm-gig-calendar (fmlaaiolqwknowhtdeue), captured 2026-10-20 ~15:50 UTC
-- Contains definitions and ACLs only. No secrets, no customer data.
--
-- Applied fix: migrations 20261020160458 + 20261020160559.
-- WARNING: running this RE-OPENS the privilege-escalation vulnerability.
-- Only use it if the fix breaks something critical and no forward fix is
-- possible. Prefer a forward migration.
-- ============================================================================

begin;
set local lock_timeout = '3s';

-- 1. Remove the guard trigger
drop trigger if exists profiles_guard_protected_columns on public.profiles;
drop function if exists public.profiles_guard_protected_columns();

-- 2. Restore the original (vulnerable) admin helpers exactly as captured
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_or_above()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.has_role('super_admin')
    or public.has_role('admin')
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.has_role('super_admin')
    or exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin');
$function$;

-- 3. Original table ACL on public.profiles (pre-fix) was, for each of
--    anon, authenticated, service_role, postgres:
--    INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER (+ MAINTAIN)
--    Restoring the revoked privileges is NOT recommended; included for completeness.
-- grant insert, update, delete, truncate, references, trigger, maintain on public.profiles to anon;
-- grant truncate, references, trigger, maintain on public.profiles to authenticated;

commit;

-- ----------------------------------------------------------------------------
-- Captured policies on public.profiles (unchanged by the fix; for reference)
--   Admins can delete profiles          DELETE  USING is_admin()
--   Admins can insert profiles          INSERT  CHECK is_admin()
--   Admins can update any profile       UPDATE  USING is_admin() CHECK is_admin()
--   Admins can view all profiles        SELECT  USING is_admin()
--   Profile manager can update assigned profile  UPDATE  USING/CHECK manages_entity(band|solo_artist|festival|promoter|organisation, id)
--   Public can view active profiles     SELECT  USING profile_type in (...) and disabled = false
--   Users can read own profile          SELECT  USING auth.uid() = user_id
--   Users can update own profile        UPDATE  USING/CHECK auth.uid() = user_id
-- Triggers on public.profiles pre-fix: set_profiles_updated_at -> update_updated_at()
-- Policy counts depending on helpers: is_admin()=14, is_admin_or_above()=17, is_super_admin()=1
-- Aggregates (no identities): user_roles super_admin=1, admin=0, manager rows=0;
--   profiles role admin=1 (same user as the trusted super_admin), band=17; owned non-admin=9
-- ----------------------------------------------------------------------------
