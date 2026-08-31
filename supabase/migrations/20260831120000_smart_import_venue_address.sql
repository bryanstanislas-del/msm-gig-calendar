-- Smart Import: structured venue address support (Music in the City bulk
-- import). A CSV/TSV import can now supply an explicit "Address" column
-- (see src/smartImport/csvTsv.js's COLUMN_ALIASES); once an admin reviews
-- and approves a genuinely NEW venue through the grouped resolution UI, its
-- address/postcode/website should be used when the venue is created --
-- see this repo's src/smartImport/*.js for the full JS-side plumbing.
--
-- This adds a new import_gig_row(...) overload with three new optional,
-- defaulted trailing params (p_venue_address/p_venue_postcode/
-- p_venue_website), the same additive-overload approach Sprint 5C already
-- used to go from an 11-arg to a 13-arg version -- the older overloads are
-- left in place rather than dropped, unchanged and still callable.
--
-- auto_create_venue() (the BEFORE INSERT trigger on gigs that actually
-- creates a venue row today) is deliberately NOT modified by this
-- migration. Instead, this function pre-creates the venue -- with address/
-- postcode/website -- using the exact same normalised-name+city lookup
-- auto_create_venue() itself already uses, but ONLY when none of the three
-- new params is null (i.e. only for a row that just went through explicit
-- "Approve New Venue" with at least one of those fields filled in) AND no
-- venue already exists under that name+city. The trigger then runs
-- completely unchanged on the gigs insert immediately below and simply
-- finds the row just pre-created (or any pre-existing venue) -- no
-- duplicate venue, and every OTHER gigs-insert path (public gig
-- submission, manual admin add, any future caller) never passes these new
-- params and is entirely unaffected by this migration.
--
-- Safety invariant -- read this before touching this function again: an
-- existing venue is NEVER updated here, under any circumstance. If the
-- name+city lookup finds a match, that row is left completely untouched --
-- an imported address can never overwrite a real, already-matched venue's
-- own address/postcode/website. This is enforced independently at the JS
-- layer too (importEngine.js's resolveVenueFields only ever supplies these
-- three params for tier "approved_new", never "exact"/"confirmed"), so
-- this is defense in depth, not the only guard.
--
-- Known pre-existing limitation, carried over unchanged from
-- auto_create_venue() itself: this is a plain select-then-insert with no
-- unique constraint or advisory lock backing it, so two rows for the very
-- same brand-new venue completing this check at the same instant (within
-- the import engine's concurrency window) could in principle both decide
-- "no existing venue" and each insert one. This is the same race
-- auto_create_venue() has always had for concurrent imports of unrelated
-- rows; this feature just makes it easier to hit in practice, since a
-- large structured import can genuinely send many rows for the same new
-- venue concurrently. Not fixed here (would need a schema change --
-- e.g. a unique index on venues(name_normalised, city) -- beyond this
-- migration's minimal scope); flagged for a follow-up.
create or replace function public.import_gig_row(
  p_import_run_id uuid, p_band_name text, p_venue text, p_city text, p_date date,
  p_time text, p_genre text, p_notes text, p_tickets text, p_band_profile_id uuid, p_raw_text text,
  p_parsed_fields jsonb default null, p_match_decisions jsonb default null,
  p_venue_address text default null, p_venue_postcode text default null, p_venue_website text default null
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_slug text;
  v_gig_id uuid;
  v_attempt int;
  v_venue_id uuid;
  v_venue_name_norm text;
  v_venue_city_norm text;
  v_venue_slug text;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can import gig rows';
  end if;

  if p_venue is not null and trim(p_venue) <> '' and p_city is not null and trim(p_city) <> ''
     and (p_venue_address is not null or p_venue_postcode is not null or p_venue_website is not null) then
    v_venue_name_norm := lower(trim(regexp_replace(p_venue, '\s+', ' ', 'g')));
    v_venue_city_norm := lower(trim(p_city));

    select id into v_venue_id
    from public.venues
    where name_normalised = v_venue_name_norm
    and lower(trim(city)) = v_venue_city_norm
    limit 1;

    if v_venue_id is null then
      v_venue_slug := public.generate_venue_slug(p_venue, coalesce(p_city, ''));
      insert into public.venues (name, city, slug, address, postcode, website)
      values (trim(p_venue), trim(p_city), v_venue_slug, p_venue_address, p_venue_postcode, p_venue_website);
    end if;
  end if;

  for v_attempt in 1..2 loop
    begin
      v_slug := public.generate_gig_slug(coalesce(p_band_name, 'unknown'), coalesce(p_venue, 'unknown'), p_date);

      insert into public.gigs (
        band_name, venue, city, date, time, genre, notes, tickets,
        band_profile_id, status, submitted_by, slug, import_run_id
      ) values (
        p_band_name, p_venue, p_city, p_date,
        coalesce(nullif(p_time, ''), 'Time TBC'),
        nullif(p_genre, ''),
        p_notes, p_tickets, p_band_profile_id, 'pending', auth.uid(), v_slug, p_import_run_id
      )
      returning id into v_gig_id;

      insert into public.import_run_items (import_run_id, raw_text, outcome, gig_id, parsed_fields, match_decisions)
      values (p_import_run_id, p_raw_text, 'created', v_gig_id, p_parsed_fields, p_match_decisions);

      return jsonb_build_object('outcome', 'created', 'gig_id', v_gig_id);

    exception
      when unique_violation then
        if v_attempt = 2 then
          insert into public.import_run_items (import_run_id, raw_text, outcome, error_message, parsed_fields, match_decisions)
          values (p_import_run_id, p_raw_text, 'failed', 'unique_violation on retry: ' || sqlerrm, p_parsed_fields, p_match_decisions);
          return jsonb_build_object('outcome', 'failed', 'gig_id', null);
        end if;
        -- fall through to the loop's second iteration and retry
      when others then
        insert into public.import_run_items (import_run_id, raw_text, outcome, error_message, parsed_fields, match_decisions)
        values (p_import_run_id, p_raw_text, 'failed', sqlerrm, p_parsed_fields, p_match_decisions);
        return jsonb_build_object('outcome', 'failed', 'gig_id', null);
    end;
  end loop;
end;
$function$;
