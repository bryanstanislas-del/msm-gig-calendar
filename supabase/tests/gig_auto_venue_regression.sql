-- Regression proof for the gig_auto_venue safety fix (see migration
-- 20260904073450_gig_auto_venue_preserve_explicit_links.sql for the
-- rationale). Not a migration -- never applied automatically, safe to run
-- standalone at any time: it wraps itself in BEGIN/ROLLBACK, so nothing it
-- does ever persists, regardless of pass or fail. Run against a branch/
-- local DB (or, exceptionally, directly against production inside this
-- same rolled-back transaction) with:
--   psql "$DATABASE_URL" -f supabase/tests/gig_auto_venue_regression.sql
--
-- Every check RAISEs EXCEPTION with a distinct message on failure, so a
-- silent "COMMIT" (never reached -- see the final ROLLBACK) or a clean
-- "NOTICE: gig_auto_venue regression: ALL CHECKS PASSED" is the signal.
-- Uses ZZTEST-prefixed names/cities throughout so nothing here can ever
-- collide with real venue data even mid-transaction.

begin;

do $$
declare
  v_alpha_id uuid;      -- canonical "ZZTEST Venue Alpha" venue
  v_beta_id uuid;       -- distinct "ZZTEST Venue Beta" venue
  v_explicit_id uuid;   -- a venue id supplied explicitly on INSERT
  g_id uuid;
  g2_id uuid;            -- separate gig used for the "drifted text" checks
  g_venue_id uuid;
  venues_before int;
  venues_after int;
begin
  -- Fixtures: two genuinely distinct pre-existing venues.
  insert into public.venues (name, city, slug)
  values ('ZZTEST Venue Alpha', 'ZZTEST City', 'zztest-venue-alpha')
  returning id into v_alpha_id;

  insert into public.venues (name, city, slug)
  values ('ZZTEST Venue Beta', 'ZZTEST City', 'zztest-venue-beta')
  returning id into v_beta_id;

  insert into public.venues (name, city, slug)
  values ('ZZTEST Venue Explicit', 'ZZTEST City', 'zztest-venue-explicit')
  returning id into v_explicit_id;

  -- ── 1. INSERT with valid venue_id preserves venue_id ──────────────
  insert into public.gigs (band_name, venue, venue_id, city, date, time, status, slug)
  values ('ZZTEST Band', 'ZZTEST Some Other Text Entirely', v_explicit_id, 'ZZTEST City',
          '2027-01-01', 'Time TBC', 'pending', 'zztest-gig-1')
  returning id, venue_id into g_id, g_venue_id;
  if g_venue_id is distinct from v_explicit_id then
    raise exception 'FAIL 1: INSERT with explicit venue_id was overridden (got %, expected %)', g_venue_id, v_explicit_id;
  end if;
  delete from public.gigs where id = g_id;

  -- ── 2. INSERT without venue_id still resolves/creates as intended ──
  insert into public.gigs (band_name, venue, city, date, time, status, slug)
  values ('ZZTEST Band', 'ZZTEST Venue Alpha', 'ZZTEST City', '2027-01-02', 'Time TBC', 'pending', 'zztest-gig-2')
  returning id, venue_id into g_id, g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 2: INSERT without venue_id did not resolve to the matching existing venue (got %, expected %)', g_venue_id, v_alpha_id;
  end if;

  -- ── 3. UPDATE genre only cannot change venue_id ────────────────────
  update public.gigs set genre = 'Rock' where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 3: genre-only UPDATE changed venue_id (got %)', g_venue_id;
  end if;

  -- ── 4. UPDATE status only cannot change venue_id ───────────────────
  update public.gigs set status = 'approved' where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 4: status-only UPDATE changed venue_id (got %)', g_venue_id;
  end if;

  -- ── 5. UPDATE artist/profile association only cannot change venue_id ─
  update public.gigs set band_profile_id = null where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 5: band_profile_id-only UPDATE changed venue_id (got %)', g_venue_id;
  end if;

  -- ── 6. UPDATE festival association only cannot change venue_id ─────
  update public.gigs set festival_profile_id = null where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 6: festival_profile_id-only UPDATE changed venue_id (got %)', g_venue_id;
  end if;

  -- ── 7. UPDATE date/time only cannot change venue_id ─────────────────
  update public.gigs set date = '2027-01-03', time = '20:00' where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 7: date/time-only UPDATE changed venue_id (got %)', g_venue_id;
  end if;

  -- ── 8/12. Unrelated update on a gig whose free-text `venue` has
  --         DRIFTED from its linked venue's own canonical name (exactly
  --         the real Chicago 9 situation: venue_id already correct,
  --         venue text long-form/mismatched) must not create a new venue
  --         or change venue_id. Insert via the explicit-venue_id INSERT
  --         path (guard 1, already proven by check 1) to seed the drift
  --         without itself going through text-based resolution.
  insert into public.gigs (band_name, venue, venue_id, city, date, time, status, slug)
  values ('ZZTEST Band', 'ZZTEST Alpha, Long Drifted Free-Text Name', v_alpha_id, 'ZZTEST City',
          '2027-01-04', 'Time TBC', 'pending', 'zztest-gig-drifted')
  returning id, venue_id into g2_id, g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 8 setup: seeding the drifted-text gig did not keep the explicit venue_id (got %)', g_venue_id;
  end if;

  venues_before := (select count(*) from public.venues);
  update public.gigs set genre = 'Blues' where id = g2_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_alpha_id then
    raise exception 'FAIL 8: unrelated UPDATE on a drifted-venue-text gig changed venue_id (got %, expected %)', g_venue_id, v_alpha_id;
  end if;
  venues_after := (select count(*) from public.venues);
  if venues_after <> venues_before then
    raise exception 'FAIL 12: an unrelated update on a drifted-venue-text gig created % new venue(s)', venues_after - venues_before;
  end if;

  -- ── 10. Intended venue-text edit still resolves/creates correctly ──
  -- g_id currently: venue_id = v_alpha_id, venue text = 'ZZTEST Venue
  -- Alpha'. Changing the text to a genuinely different, already-existing
  -- venue's name must re-resolve to THAT venue.
  update public.gigs set venue = 'ZZTEST Venue Beta' where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_beta_id then
    raise exception 'FAIL 10: deliberate venue-text change did not re-resolve to the matching venue (got %, expected %)', g_venue_id, v_beta_id;
  end if;

  -- ── 9. Explicit valid venue_id change is preserved ──────────────────
  -- Relink to a THIRD venue explicitly, in the SAME statement as a city
  -- change -- this is the case that actually exercises the trigger (city
  -- is in its "UPDATE OF" column list) while also supplying an explicit
  -- venue_id, so the explicit value must win over any text-based
  -- re-resolution, not just pass through because the trigger never ran.
  update public.gigs set venue_id = v_explicit_id, city = 'ZZTEST Relink City' where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_explicit_id then
    raise exception 'FAIL 9: explicit venue_id change (alongside a city change) was not preserved (got %, expected %)', g_venue_id, v_explicit_id;
  end if;

  -- ── 11. City-only edit is explicitly preserved (Chicago 9 scenario) ─
  -- venue_id is now v_explicit_id while venue text ('ZZTEST Venue Beta')
  -- no longer matches it -- exactly the real Chicago 9 shape. A city-only
  -- change must still preserve venue_id untouched.
  update public.gigs set city = 'ZZTEST Different City' where id = g_id returning venue_id into g_venue_id;
  if g_venue_id is distinct from v_explicit_id then
    raise exception 'FAIL 11: city-only UPDATE changed venue_id (got %, expected %)', g_venue_id, v_explicit_id;
  end if;

  raise notice 'gig_auto_venue regression: ALL CHECKS PASSED';
end $$;

rollback;
