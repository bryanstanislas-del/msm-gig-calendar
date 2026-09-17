-- Verified Artist Self-Service, security foundation (Phase 0/RLS design
-- audit): hardens the gigs INSERT policy. The live "Bands can submit
-- gigs" policy applied to PUBLIC (i.e. every Postgres role, including
-- anon) and its WITH CHECK only ever verified `status = 'pending'` --
-- it never verified the caller's own identity at all. Combined with
-- anon's ordinary table-level INSERT grant (Supabase's standard broad-
-- grant-plus-RLS-gate default), this meant:
--   1. An entirely unauthenticated request, using only the public anon
--      key already embedded in the deployed frontend, could insert a
--      gig row -- the app's "you must log in to submit" behaviour was a
--      frontend-only gate, never enforced by the database.
--   2. Any authenticated user could set `submitted_by` to an arbitrary
--      OTHER real user's id (only existence, not ownership, was ever
--      checked via the submitted_by -> auth.users FK).
--   3. Any authenticated user could set `band_profile_id` to ANOTHER
--      artist's claimed profile id, not just their own.
--
-- None of this was reachable through the existing frontend (DB.submitGig
-- always sends status:'pending', a real submitted_by, and
-- band_profile_id = the caller's own profile?.id or null) -- but
-- database security must not depend on frontend behaviour holding.
--
-- SCOPE: this migration ONLY tightens the INSERT policy's identity
-- checks. It deliberately does NOT add delegated-manager support
-- (`manages_entity()`/`user_roles`) -- that is real, separate design
-- work, deferred until there is an actual product need for it and it
-- can be designed/tested on its own. It does not touch any other
-- policy (SELECT/UPDATE/DELETE, or the admin ALL policy), any table,
-- column, function (is_admin() is untouched), grant, index, or
-- constraint.
--
-- QUALIFICATION FIX (independent review): both references to
-- `band_profile_id` inside the WITH CHECK below are explicitly
-- qualified as `gigs.band_profile_id`, not left bare. `public.profiles`
-- has no column named `band_profile_id` today, so an unqualified
-- reference already resolves correctly to the new gigs row -- but that
-- correctness is contingent on that continuing to be true. Proven
-- empirically (EXPLAIN VERBOSE, in a disposable test database only):
-- if `profiles` ever gains a same-named column before this exact policy
-- text is next created/recreated (e.g. a future DROP POLICY + CREATE
-- POLICY), an unqualified reference silently rebinds to `profiles`' own
-- column instead of the submitted gigs row, with no error or warning,
-- decoupling the check entirely from the value being inserted. Explicit
-- qualification removes that contingency outright, regardless of what
-- columns `profiles` gains in the future.
--
-- Authoritative ownership rule used below (verified directly against
-- the live schema, not assumed): a profile is the caller's own claimed
-- profile when `profiles.user_id = auth.uid() AND profiles.claimed =
-- true`. `profiles.claimed` and `profiles.claim_status` are kept in
-- permanent lockstep by the existing profiles_claim_status_consistent
-- CHECK constraint ((claimed=true AND claim_status='claimed') OR
-- (claimed=false AND claim_status IN ('unclaimed','pending'))), so
-- checking `claimed` alone is sufficient -- it cannot diverge from
-- claim_status. This rule is identical for `band` and `solo_artist`
-- profile_types; neither column is profile_type-specific.
--
-- `band_profile_id IS NULL` remains a fully legitimate, required case
-- (not a fallback): SubmitGigForm is reachable by any authenticated
-- user regardless of profile_type or claim status (fans, and
-- band/solo_artist registrants with no claimed -- or even no persisted
-- -- profile yet, all legitimately submit with band_profile_id null
-- today). Removing this would break ordinary grassroots gig submission,
-- not just some rare account type.
--
-- Known, deliberately out-of-scope items (see this engagement's own
-- design report for full detail, not repeated here):
--   - 6 live profiles have user_id set (real login access) but
--     claimed=false/admin_created=false (legacy rows predating the
--     current handle_new_user() no-op). Under this rule they correctly
--     cannot submit under their own band_profile_id until MSM
--     explicitly marks them claimed -- a deliberate product decision,
--     not touched by this migration.
--   - A signed-in venue owner's profile object resolves to a
--     venues.id, not a profiles.id; passing that as band_profile_id
--     already fails today via the existing gigs_band_profile_id_fkey
--     FK constraint (-> profiles(id)), independent of RLS. Pre-existing
--     frontend gap, not touched here.
--
-- Compatibility (verified, not assumed):
--   - Admin inserts/updates/deletes: unaffected -- covered by the
--     separate, untouched "Admins have full gig access" (is_admin(),
--     cmd ALL) policy; multiple permissive policies OR together.
--   - Bulk Import's direct client insert (status:'approved', admin-only
--     UI): unaffected -- authorized by the admin ALL policy, never by
--     this one.
--   - Smart Import's import_gig_row RPC: unaffected -- SECURITY
--     DEFINER, owned by `postgres`, which has rolbypassrls = true, so
--     it bypasses RLS on this table entirely regardless of this policy.
--
-- ROLLBACK (restores the exact live policy this migration replaces):
--   drop policy if exists "Bands can submit gigs" on public.gigs;
--   create policy "Bands can submit gigs" on public.gigs
--     for insert
--     with check (status = 'pending');

drop policy if exists "Bands can submit gigs" on public.gigs;

create policy "Bands can submit gigs"
on public.gigs
for insert
to authenticated
with check (
  status = 'pending'
  and submitted_by = auth.uid()
  and (
    gigs.band_profile_id is null
    or exists (
      select 1
      from public.profiles p
      where p.id = gigs.band_profile_id
        and p.user_id = auth.uid()
        and p.claimed = true
    )
  )
);
