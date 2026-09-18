-- Venue Data Enrichment, Phase 3C: RPC EXECUTE grant hardening.
--
-- The Phase 3C migration (20260918150000_venue_enrichment_candidates_
-- review.sql) explicitly revoked EXECUTE on the two review RPCs from
-- anon, but PostgreSQL's separate, implicit PUBLIC grant (every
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, independently of
-- pg_default_acl's own per-role defaults, and revoking from a specific
-- role never revokes a privilege still held via PUBLIC membership) was
-- left standing -- confirmed live in production after that migration
-- was applied: approve_venue_enrichment_candidate/reject_venue_
-- enrichment_candidate's own pg_proc.proacl still carried a bare
-- "=X/postgres" entry (PUBLIC) alongside the explicit per-role grants.
-- Since anon is a member of PUBLIC, it still had EXECUTE via that route
-- regardless of the anon-specific revoke having succeeded.
--
-- This is the exact same gap-closing pattern this codebase already
-- established elsewhere (see 20260729213817_sprint3_5_harden_
-- notification_functions.sql's own revoke of BOTH public and anon on
-- fanout_notification_event/mark_notification_read) -- that migration's
-- own header comment states the same principle this one now applies
-- here: "these functions only ever do useful work for an authenticated
-- caller, so anon/public EXECUTE is revoked."
--
-- SCOPE: grants only. No function body change, no RLS change, no table
-- change, no data change. The actual authorization boundary was never
-- at risk either way -- both functions' own internal
-- is_admin_or_above() check (unchanged, unaffected by this migration)
-- already independently blocks any non-admin caller from approving or
-- rejecting anything, regardless of who can technically invoke the
-- function. This migration closes the grant-layer gap for defence in
-- depth and to match this project's own established convention, not
-- because a privilege escalation was found.
revoke execute on function public.approve_venue_enrichment_candidate(uuid, text) from public;
revoke execute on function public.reject_venue_enrichment_candidate(uuid, text) from public;

-- Revoking from PUBLIC also removes the privilege every other role
-- inherits through PUBLIC membership, including `authenticated` -- so
-- the intended authenticated access (gated internally by
-- is_admin_or_above(), exactly as before) must be re-granted explicitly
-- here, in the same migration, rather than left to rely on a grant that
-- no longer exists after the revoke above.
grant execute on function public.approve_venue_enrichment_candidate(uuid, text) to authenticated;
grant execute on function public.reject_venue_enrichment_candidate(uuid, text) to authenticated;

-- service_role/postgres are untouched by this migration -- their
-- existing per-role grants (from the original Phase 3C migration) are
-- unaffected by revoking PUBLIC, and require no change here.
