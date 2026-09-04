-- gig_auto_venue safety fix: an unrelated gig edit must never silently
-- discard a valid, already-correct venue_id.
--
-- Root cause (found while correcting a single mislabelled gigs.city value):
-- auto_create_venue() is the function behind the "gig_auto_venue" trigger
-- (BEFORE INSERT OR UPDATE OF venue, city ON gigs -- see the live trigger
-- definition; this trigger/function pair predates this repo's migrations
-- directory entirely, so production and source control have never agreed
-- on it before this file). Because the trigger is declared "UPDATE OF
-- venue, city", Postgres fires it whenever either column is part of an
-- UPDATE's SET list -- even when the submitted value is IDENTICAL to what
-- was already stored. App.jsx's admin "Edit Gig" save always resends the
-- gig's full editForm (city included) on every save regardless of which
-- field the admin actually meant to change (see the
-- "// venue_id handled by trigger on venue/city update" comment at that
-- call site) -- so in practice this trigger runs on every single admin
-- edit, not just ones that deliberately change venue/city.
--
-- The function body itself had no guard for any of this: it unconditionally
-- re-derived venue_id from a fresh, exact normalised-text lookup of
-- NEW.venue + NEW.city, discarding whatever venue_id the row already had.
-- If that lookup didn't find an existing venue (e.g. because the gig's own
-- free-text `venue` column had drifted from the currently-linked venue's
-- canonical `name` -- exactly the situation for a handful of historically
-- hand-relinked gigs), it silently created a brand-new duplicate venue and
-- repointed the gig to it. This is precisely what happened to the Chicago 9
-- gig (02a45ccf-7db9-472c-a015-f8e88bd87433) during an authorised city-only
-- correction: venue text was untouched, venue_id was already correct, only
-- `city` changed -- yet the trigger fired (city was in the SET list),
-- found no venue whose name matched that gig's own verbose `venue` text,
-- and created venue 1d60c358-cd43-4026-9956-5fa852cbe8e9.
--
-- Fix: three early-return guards, added to the function body only (the
-- trigger's own "UPDATE OF venue, city" column list is left unchanged --
-- it's already correctly scoped; genre/status/date/time/festival-only
-- updates that don't even mention venue or city never reach this function
-- at all today). All three guards preserve the row's existing venue
-- relationship instead of touching it:
--
--   1. INSERT with an already-supplied, non-null venue_id: trust it,
--      skip auto-matching entirely. (No current INSERT caller -- public
--      submission, admin Add Gig, or the import_gig_row RPC -- ever
--      supplies venue_id; they all rely on this trigger to derive it, so
--      this guard is a no-op for all of them today. It exists to protect
--      any future caller that does supply one explicitly.)
--
--   2. UPDATE where NEW.venue_id is explicitly different from OLD.venue_id
--      (an explicit relink): trust the caller's explicit change, skip
--      auto-matching. (No current UPDATE caller sets venue_id at all --
--      see the App.jsx comment above -- so also a no-op today, protecting
--      a future explicit-relink admin feature.)
--
--   3. UPDATE where NEW.venue IS NOT DISTINCT FROM OLD.venue (the venue's
--      own free-text name is unchanged, whether or not city changed):
--      preserve the existing venue_id untouched. This is the guard that
--      actually fixes the Chicago 9 scenario and protects every future
--      genre/status/festival/date/time-only (or city-only) edit made
--      through the existing Edit Gig form. Deliberately changing the
--      venue NAME text is still the one case that re-runs full matching/
--      auto-create, unchanged from today's behaviour -- gigs.city has
--      repeatedly proven to be a loose, sometimes regional, sometimes
--      mislabelled display value (see the City/Location data audit), so
--      it alone changing must never be read as "this gig moved to a
--      different building."
--
-- Everything below the guards is byte-for-byte the previous matching/
-- auto-create logic, unchanged.
create or replace function public.auto_create_venue()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_name_norm text;
  v_city_norm text;
  v_slug text;
begin
  if TG_OP = 'INSERT' and new.venue_id is not null then
    return new;
  end if;

  if TG_OP = 'UPDATE' and new.venue_id is distinct from old.venue_id then
    return new;
  end if;

  if TG_OP = 'UPDATE' and new.venue is not distinct from old.venue then
    return new;
  end if;

  if new.venue is null or trim(new.venue) = '' then
    return new;
  end if;

  v_name_norm := lower(trim(regexp_replace(new.venue, '\s+', ' ', 'g')));
  v_city_norm := lower(trim(new.city));

  -- Check if venue already exists (normalised name + city)
  select id into v_id
  from public.venues
  where name_normalised = v_name_norm
  and lower(trim(city)) = v_city_norm
  limit 1;

  -- Create if not exists
  if v_id is null then
    v_slug := public.generate_venue_slug(new.venue, coalesce(new.city, ''));
    insert into public.venues (name, city, slug)
    values (trim(new.venue), trim(new.city), v_slug)
    returning id into v_id;
  end if;

  -- Set venue_id on the gig
  new.venue_id := v_id;
  return new;
end;
$function$;
