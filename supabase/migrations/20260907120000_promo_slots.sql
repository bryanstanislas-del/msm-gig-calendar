-- Editorial Promo + Future Advertising Positions, Phase 1: the smallest
-- reusable promo/ad slot configuration table, backing the three fixed
-- public-page positions (TOP / IN_FEED / LOWER) described in this
-- engagement's own read-only architecture audit.
--
-- SCOPE: this is deliberately NOT a campaign/advertising platform. No
-- scheduling (start_at/end_at), no rotation, no impressions/click
-- tracking, no advertiser accounts, no billing, no geographic targeting
-- -- all explicitly out of scope for this phase per the audit. Exactly
-- three fixed slots, each holding at most the current, single active
-- creative for that position. Artwork itself is NOT stored here or in
-- any new image-storage system -- this table stores only URLs, pointing
-- at images Bryan uploads himself to the existing Music Scene Magazine
-- WordPress Media Library (see the audit's own comparison of that
-- approach against Supabase Storage; no technical blocker either way,
-- WordPress is the chosen approach).
--
-- ONE ROW PER SLOT, EVER -- not "at most one active per slot" via a
-- partial unique index (the pattern used elsewhere in this schema for
-- claim_requests, for example): `slot` is a plain UNIQUE NOT NULL column
-- with a fixed 3-value CHECK constraint (mirrors
-- featured_listings_entity_type_check's own fixed-enum-via-CHECK
-- pattern), and this migration seeds exactly the three rows below,
-- inactive, with no content. There is deliberately no INSERT or DELETE
-- policy for anyone but the table owner (see RLS below) -- an admin can
-- only ever UPDATE one of these three existing rows, never create a
-- fourth slot or remove one of the three, which is what "the available
-- slots are fixed, do not provide arbitrary slot creation" means enforced
-- at the database layer, not just left to the admin UI's own discipline.
--
-- RLS: mirrors the existing editorial_features/featured_listings split
-- (public SELECT of active rows only, admin SELECT of everything, admin
-- UPDATE) using the same public.is_admin_or_above() helper those two
-- tables already use (checked live against the production schema before
-- writing this migration -- SECURITY DEFINER, already relied upon
-- elsewhere, not redefined here). This table is PUBLIC READ content (the
-- public calendar must be able to read active slots with the anon key,
-- same as it already reads gigs/venues), never public write.
--
-- NOT YET APPLIED TO PRODUCTION as of this PR -- see the PR description.

create table public.promo_slots (
  id uuid primary key default gen_random_uuid(),
  slot text not null unique,
  image_url text,
  mobile_image_url text,
  target_url text,
  alt_text text,
  label text not null default 'Editorial',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_slots_slot_check
    check (slot = any (array['TOP', 'IN_FEED', 'LOWER'])),
  constraint promo_slots_label_check
    check (label = any (array['Editorial', 'Sponsored', 'Advertisement', 'Partner']))
);

comment on table public.promo_slots is
  'Editorial/advertising promo slot configuration -- exactly one row per fixed slot (TOP/IN_FEED/LOWER). Phase 1: no scheduling, rotation, tracking, or billing. See migration header comment.';

alter table public.promo_slots enable row level security;

-- Public (anon + authenticated) read: active slots only -- exactly what
-- the public calendar needs to render whatever is currently live, and
-- nothing else (an inactive slot's half-configured URL/alt text is not
-- public content).
create policy "promo_slots_public_select" on public.promo_slots
  for select using (active = true);

-- Admin read: everything, including inactive rows -- the admin UI needs
-- to show and edit a slot's current configuration even while it's
-- switched off.
create policy "promo_slots_admin_select" on public.promo_slots
  for select using (public.is_admin_or_above());

-- Admin write: UPDATE only. Deliberately no INSERT/DELETE policy at all
-- -- see the header comment above for why "fixed slots, no arbitrary
-- creation" is enforced here, not only in the admin UI.
create policy "promo_slots_admin_update" on public.promo_slots
  for update using (public.is_admin_or_above()) with check (public.is_admin_or_above());

-- Reuses the existing generic update_updated_at() trigger function
-- already used by venues/featured_listings/editorial_features -- not
-- redefined here.
create trigger promo_slots_updated_at
  before update on public.promo_slots
  for each row execute function update_updated_at();

-- Seed the three fixed slots, inactive, with no artwork/URLs -- purely
-- structural (the table's own one-row-per-slot invariant requires the
-- rows to exist for the admin UI to UPDATE), never a live advertisement
-- or MSM creative. Bryan activates each slot from the admin UI once real
-- artwork/URLs are ready.
insert into public.promo_slots (slot, label, active) values
  ('TOP', 'Editorial', false),
  ('IN_FEED', 'Editorial', false),
  ('LOWER', 'Editorial', false);
