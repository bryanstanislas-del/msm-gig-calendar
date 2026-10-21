-- ============================================================================
-- Applied to production as 20261021043228 (after app release 751e40c/32399d8
-- was verified live).
-- Base tables become private; public listings come only from the public
-- read models (public_profiles / public_venues / public_gigs).
-- Requires the app release that reads public listings from those views.
--
-- profiles: owners (existing policy), assigned managers (new SELECT policy)
--           and trusted admins can read full rows. No anonymous access.
-- venues:   owners and assigned managers can read their own venue (new);
--           admins full access. No anonymous access.
-- gigs:     submitters see their own gigs; admins see all. No anonymous access.
-- ============================================================================
-- The former public read policies are retired in place (renamed, USING
-- false) rather than dropped: they grant nothing, and can be dropped in a
-- later housekeeping migration.
set lock_timeout = '3s';

-- profiles
alter policy "Public can view active profiles" on public.profiles rename to "retired_public_read_profiles";
alter policy "retired_public_read_profiles" on public.profiles using (false);
create policy "Managers can read assigned profile" on public.profiles
  for select to authenticated
  using (
    public.manages_entity('band', id) or public.manages_entity('solo_artist', id)
    or public.manages_entity('festival', id) or public.manages_entity('promoter', id)
    or public.manages_entity('organisation', id)
  );
revoke select on table public.profiles from anon;

-- venues
alter policy "Public can view venues" on public.venues rename to "retired_public_read_venues";
alter policy "retired_public_read_venues" on public.venues using (false);
create policy "Venue owner can read own venue" on public.venues
  for select to authenticated
  using (user_id = auth.uid());
create policy "Venue manager can read assigned venue" on public.venues
  for select to authenticated
  using (public.manages_entity('venue', id));
revoke all on table public.venues from anon;
revoke truncate, references, trigger, maintain on table public.venues from authenticated;

-- gigs
alter policy "Public can view approved gigs" on public.gigs rename to "retired_public_read_gigs";
alter policy "retired_public_read_gigs" on public.gigs using (false);
revoke all on table public.gigs from anon;
revoke truncate, references, trigger, maintain on table public.gigs from authenticated;
