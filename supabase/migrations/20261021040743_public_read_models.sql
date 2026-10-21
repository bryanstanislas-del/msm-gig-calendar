-- Applied to production as 20261021040743.
-- ============================================================================
-- Public read models for profiles, venues and gigs (additive, compatible).
--
-- public_profiles / public_venues / public_gigs expose only fields intended
-- for public listings. They are owner-rights views (security_invoker off,
-- security_barrier on) so they work for anonymous visitors independently of
-- base-table row policies, and carry their own publication filter.
-- They are SELECT-only for API roles: Supabase default privileges would
-- otherwise grant write access, and writes through an owner-rights view
-- would bypass RLS. Never grant INSERT/UPDATE/DELETE on these views.
--
-- Profile contact fields (booking/management/press) appear only when the
-- profile has opted in via public_contacts_consent (default false).
-- Location (postcode, what3words) is published only for festival profiles,
-- which use it as the public event-site location.
-- ============================================================================
set lock_timeout = '3s';

alter table public.profiles
  add column if not exists public_contacts_consent boolean not null default false;

comment on column public.profiles.public_contacts_consent is
  'Owner/manager opt-in to show booking_email, management_contact and press_contact on the public profile.';

-- ---------------------------------------------------------------- profiles
create or replace view public.public_profiles
with (security_barrier = true) as
select
  p.id,
  p.band_name,
  p.profile_type,
  p.city,
  p.website,
  p.photo_url,
  p.instagram,
  p.facebook,
  p.twitter,
  p.genre,
  p.primary_genre,
  p.secondary_genre,
  p.tertiary_genre,
  p.bio,
  p.spotify,
  p.tiktok_url,
  p.youtube_channel_url,
  p.youtube_featured_url,
  p.apple_music_url,
  p.bandcamp_url,
  p.soundcloud_url,
  p.formation_year,
  p.band_slug,
  p.band_status,
  p.disabled,
  p.claimed,
  p.claim_status,
  (coalesce(p.admin_created, false) and p.claim_status <> 'claimed') as claimable,
  p.festival_start_date,
  p.festival_end_date,
  case when p.profile_type = 'festival' then p.postcode   end as postcode,
  case when p.profile_type = 'festival' then p.what3words end as what3words,
  case when p.public_contacts_consent then p.booking_email      end as booking_email,
  case when p.public_contacts_consent then p.management_contact end as management_contact,
  case when p.public_contacts_consent then p.press_contact      end as press_contact,
  p.seo_title,
  p.seo_description,
  p.seo_search_phrases,
  p.created_at,
  p.updated_at
from public.profiles p
where p.profile_type in ('band', 'solo_artist', 'festival', 'promoter', 'organisation')
  and p.disabled = false;

-- ------------------------------------------------------------------ venues
create or replace view public.public_venues
with (security_barrier = true) as
select
  v.id,
  v.name,
  v.name_normalised,
  v.city,
  v.slug,
  v.description,
  v.website,
  v.facebook,
  v.instagram,
  v.twitter,
  v.photo_url,
  v.address,
  v.postcode,
  v.capacity,
  v.claimed,
  v.claim_status,
  (coalesce(v.admin_created, false) and v.claim_status <> 'claimed') as claimable,
  v.seo_title,
  v.seo_description,
  v.seo_search_phrases,
  v.created_at,
  v.updated_at
from public.venues v;

-- -------------------------------------------------------------------- gigs
create or replace view public.public_gigs
with (security_barrier = true) as
select
  g.id,
  g.band_name,
  g.venue,
  g.city,
  g.date,
  g.time,
  g.end_date,
  g.genre,
  g.tickets,
  g.notes,
  g.description,
  g.status,
  g.is_recurring,
  g.recurrence,
  g.spotify,
  g.featured,
  g.poster_url,
  g.slug,
  g.band_profile_id,
  g.venue_id,
  g.festival_profile_id,
  g.created_at,
  g.updated_at
from public.gigs g
where g.status = 'approved';

revoke all on public.public_profiles, public.public_venues, public.public_gigs from public, anon, authenticated;
grant select on public.public_profiles, public.public_venues, public.public_gigs to anon, authenticated, service_role;

comment on view public.public_profiles is 'Public profile listing fields only. SELECT-only for API roles; never grant writes (owner-rights view).';
comment on view public.public_venues   is 'Public venue listing fields only. SELECT-only for API roles; never grant writes (owner-rights view).';
comment on view public.public_gigs     is 'Approved gigs, public fields only. SELECT-only for API roles; never grant writes (owner-rights view).';

-- Legacy claim-status views: same columns, now sourced from public models.
create or replace view public.profile_claim_status_v
with (security_invoker = true) as
select id, profile_type, band_name, city, photo_url, disabled, claimed,
       null::timestamptz as claimed_at, claim_status
from public.public_profiles;

create or replace view public.venue_claim_status_v
with (security_invoker = true) as
select id, name, city, photo_url, claimed,
       null::timestamptz as claimed_at, claim_status
from public.public_venues;

revoke all on public.profile_claim_status_v, public.venue_claim_status_v from public, anon, authenticated;
grant select on public.profile_claim_status_v, public.venue_claim_status_v to anon, authenticated, service_role;
