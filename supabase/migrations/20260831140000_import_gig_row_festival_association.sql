-- Smart Import: batch-level festival association. An admin can now
-- optionally pick ONE existing festival profile at Import Review, and every
-- NEW gig created from that batch is linked to it via gigs.festival_profile_id
-- -- a column that already exists (added well before this migration; no
-- schema change here). See src/App.jsx's FestivalAssociationControl for the
-- UI and src/smartImport/importEngine.js's buildGigInsertPayload/runImport
-- for how the single selected festival id is threaded through, identically
-- for every row, independent of that row's own venue/artist/duplicate
-- resolution.
--
-- Lesson carried over directly from the venue-address work (PR #21): do NOT
-- add a new overload here. A second import_gig_row with one more trailing
-- parameter would coexist with the current 16-arg function and reintroduce
-- exactly the PostgREST ambiguous-function-resolution risk that broke live
-- Smart Import when the 13-arg and 16-arg overloads coexisted (see that
-- PR's history). Instead, this migration drops the exact current 16-arg
-- signature and recreates import_gig_row with p_festival_profile_id added
-- as the new final, defaulted parameter -- so at every point in time,
-- including right after this migration runs, there is exactly ONE
-- public.import_gig_row.
--
-- Every other part of the function body is unchanged from the version PR
-- #21 shipped: the venue pre-create block, the gig-insert retry loop, and
-- the import_run_items audit trail are all byte-for-byte identical except
-- for the one added column in the gigs INSERT.
--
-- auto_create_venue(), venue matching, artist matching, duplicate
-- detection, RLS, and every other gigs-insert path (public submission,
-- manual admin add) are untouched -- this migration only touches
-- import_gig_row.
--
-- Foreign key safety: gigs.festival_profile_id already has
-- gigs_festival_profile_id_fkey referencing profiles(id) (added long before
-- this migration). p_festival_profile_id is passed straight through to that
-- column with no extra validation here -- the existing FK constraint alone
-- already guarantees it can only ever be a real profiles.id (an invalid UUID
-- fails the INSERT and is caught by the existing "when others" handler
-- below, recorded as a normal per-row failure, exactly like any other
-- constraint violation this function already handles). The UI layer
-- (FestivalAssociationControl, reusing EntitySearchPicker/search_entities
-- with entityType="festival") is what ensures only a genuine, existing
-- festival-type profile is ever offered for selection in the first place --
-- there is no free-text path to this parameter anywhere in the app.
drop function public.import_gig_row(
  uuid, text, text, text, date, text, text, text, text, uuid, text, jsonb, jsonb, text, text, text
);

create or replace function public.import_gig_row(
  p_import_run_id uuid, p_band_name text, p_venue text, p_city text, p_date date,
  p_time text, p_genre text, p_notes text, p_tickets text, p_band_profile_id uuid, p_raw_text text,
  p_parsed_fields jsonb default null, p_match_decisions jsonb default null,
  p_venue_address text default null, p_venue_postcode text default null, p_venue_website text default null,
  p_festival_profile_id uuid default null
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
        band_profile_id, status, submitted_by, slug, import_run_id, festival_profile_id
      ) values (
        p_band_name, p_venue, p_city, p_date,
        coalesce(nullif(p_time, ''), 'Time TBC'),
        nullif(p_genre, ''),
        p_notes, p_tickets, p_band_profile_id, 'pending', auth.uid(), v_slug, p_import_run_id, p_festival_profile_id
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
