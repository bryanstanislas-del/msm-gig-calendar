-- Venue Identity & Matching, Phase 2D: let Smart Import carry an
-- explicitly human-confirmed venue_id all the way into the gig INSERT,
-- instead of converting a confirmed identity back into free text and
-- relying on gig_auto_venue's own independent text-based re-derivation.
--
-- PROBLEM THIS FIXES: when Import Review resolves a row to an existing
-- venue (exact match, or a fuzzy/alias candidate the admin explicitly
-- confirmed), importEngine.js's resolveVenueFields() already knows that
-- venue's real id (venueMatch.match.id) -- but until this migration,
-- import_gig_row had no parameter to receive it, so the confirmed
-- identity was discarded and only the venue's canonical name/city text
-- was sent. The gigs INSERT then relied entirely on gig_auto_venue's own
-- from-scratch, simpler (whitespace/case only) normalised-text lookup to
-- re-arrive at the same venue -- which happened to work because both
-- sides use byte-identical normalisation, but was never a direct,
-- authoritative reference, and would have quietly stopped working the
-- moment Smart Import's client-side matching (Phase 2A's alias-aware
-- ranking) recognised a relationship the trigger's own simpler text match
-- does not (e.g. "The Platform Tavern" -> "Platform Tavern").
--
-- THE FIX: a new, optional p_venue_id parameter. When supplied (a real
-- venue's uuid, from an admin-confirmed exact/alias/fuzzy match), it is
-- written directly onto the new gigs row -- which activates
-- gig_auto_venue's own EXISTING guard 1 (from
-- 20260904073450_gig_auto_venue_preserve_explicit_links.sql):
--   if TG_OP = 'INSERT' and new.venue_id is not null then return new; end if;
-- That guard was deliberately written to "protect any future caller that
-- does supply one explicitly" -- this migration is that future caller.
-- No trigger change is needed or made here.
--
-- OVERLOAD-AMBIGUITY SAFETY (the exact incident 20260831130000 fixed):
-- adding a new trailing parameter via a bare CREATE OR REPLACE FUNCTION
-- would NOT replace the existing 17-argument function -- Postgres
-- identifies functions by (name, argument type list), and an 18-argument
-- signature is a DIFFERENT identity from a 17-argument one, so a bare
-- CREATE OR REPLACE would silently leave BOTH overloads live,
-- reintroducing the exact PostgREST-resolution-ambiguity risk
-- 20260831130000 was written specifically to eliminate. This migration
-- explicitly drops the current 17-argument signature first, in the same
-- transaction as creating the 18-argument replacement, so at every
-- committed point there is exactly one import_gig_row for PostgREST to
-- resolve to. Verified via pg_proc against the live schema before writing
-- this migration: exactly one import_gig_row exists today, with this
-- precise 17-argument type list (see the DROP statement below).
--
-- BACKWARD COMPATIBILITY: p_venue_id defaults to NULL and is the LAST
-- parameter, so every existing caller -- Smart Import's own "New Venue"
-- rows, and any historical call shape that already omits later optional
-- parameters -- continues to work unchanged. When omitted or NULL, the
-- function's existing address/postcode/website venue-creation block and
-- the gigs INSERT behave byte-for-byte as before (NEW.venue_id starts
-- NULL, gig_auto_venue's guard 1 does not fire since it only trusts a
-- NON-null explicit value, and the trigger's normal matching/creation
-- logic runs exactly as it does today).
--
-- EXISTING VENUE MUST NOT BE MUTATED (safety principle, PR #21): the
-- address/postcode/website venue-creation block now also requires
-- p_venue_id IS NULL before it runs at all -- defense in depth against a
-- future caller mistakenly sending both an explicit id and address data;
-- the confirmed identity always wins, and there is still only one
-- venue-creation path (this block), never a second, parallel one. This
-- migration does not change what that block does when it does run, and
-- an existing matched venue's own row is never written to by this
-- function, in this migration or before it.
--
-- Nothing else about this function's body changes: the two-attempt
-- unique_violation retry loop, import_run_items audit logging, and every
-- other parameter's behaviour are byte-for-byte unchanged from the
-- previous migration (20260831140000_import_gig_row_festival_association.sql).
--
-- NOT YET APPLIED TO PRODUCTION as of this PR -- see the PR description.
drop function if exists public.import_gig_row(
  uuid, text, text, text, date, text, text, text, text, uuid, text,
  jsonb, jsonb, text, text, text, uuid
);

create or replace function public.import_gig_row(
  p_import_run_id uuid,
  p_band_name text,
  p_venue text,
  p_city text,
  p_date date,
  p_time text,
  p_genre text,
  p_notes text,
  p_tickets text,
  p_band_profile_id uuid,
  p_raw_text text,
  p_parsed_fields jsonb default null,
  p_match_decisions jsonb default null,
  p_venue_address text default null,
  p_venue_postcode text default null,
  p_venue_website text default null,
  p_festival_profile_id uuid default null,
  p_venue_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
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

  if p_venue_id is null
     and p_venue is not null and trim(p_venue) <> '' and p_city is not null and trim(p_city) <> ''
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
        band_profile_id, status, submitted_by, slug, import_run_id, festival_profile_id, venue_id
      ) values (
        p_band_name, p_venue, p_city, p_date,
        coalesce(nullif(p_time, ''), 'Time TBC'),
        nullif(p_genre, ''),
        p_notes, p_tickets, p_band_profile_id, 'pending', auth.uid(), v_slug, p_import_run_id, p_festival_profile_id, p_venue_id
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
