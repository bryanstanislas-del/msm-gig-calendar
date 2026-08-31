-- Consolidate import_gig_row down to a single canonical overload.
--
-- Sprint 5C originally shipped an 11-arg import_gig_row, then added a
-- 13-arg overload alongside it (never dropping the 11-arg one) when
-- p_parsed_fields/p_match_decisions were introduced. This PR's earlier
-- migration (20260831120000_smart_import_venue_address.sql) continued that
-- same additive-overload pattern, adding a THIRD, 16-arg overload alongside
-- the other two.
--
-- A live compatibility review found that leaves genuine, unresolved doubt
-- about whether PostgREST's own overload resolution (a distinct layer from
-- Postgres's own function resolution, and one that runs BEFORE Postgres
-- ever sees the call) can safely disambiguate a request whose JSON body's
-- keys are a valid subset of more than one candidate function's
-- parameters purely because the extra parameters all have DEFAULT values
-- -- exactly the relationship between the 13-arg and 16-arg overloads for
-- the current production frontend's existing 13-key payload, and between
-- the 11-arg and 16-arg overloads for the (already dormant, unused) 11-key
-- shape. Rather than depend on unverified behaviour of an external service
-- layer, this migration removes the possibility of ambiguity entirely:
-- with a single import_gig_row of this name left, there is only ever one
-- candidate for PostgREST to resolve to, no matter how its resolution
-- algorithm behaves.
--
-- Confirmed safe to drop (see PR #21 discussion): pg_depend shows nothing
-- in this database -- no trigger, view, or other function -- references
-- either the 11-arg or 13-arg overload, and the only application caller
-- (src/App.jsx's DB.importGigRow) has sent the full 13-key shape on every
-- call since Sprint 5C shipped; the 11-arg shape has not been in live use.
--
-- The surviving 16-arg function is byte-for-byte unchanged from the
-- previous migration -- this migration does not alter its body, its first
-- 11 (required) parameters, or auto_create_venue(), venue matching,
-- duplicate detection, artist matching, moderation, or RLS in any way. Its
-- first 11 parameters remain required (no defaults); p_parsed_fields,
-- p_match_decisions, p_venue_address, p_venue_postcode and
-- p_venue_website all default to NULL. That means the current production
-- frontend's existing 13-key call -- which sends the 11 required
-- parameters plus p_parsed_fields/p_match_decisions, and never sends the
-- three new p_venue_* keys at all -- remains a fully valid call to this
-- one remaining function: every key it sends matches a real parameter, all
-- 11 required parameters are present, and the 3 parameters it omits simply
-- take their NULL default, exactly the behaviour the (now-removed) 13-arg
-- overload provided. Omitting parameters that have a DEFAULT is standard,
-- unambiguous PostgREST behaviour for a single (non-overloaded) function --
-- the ambiguity risk this migration addresses only ever existed because
-- multiple candidate functions shared the same name.
drop function if exists public.import_gig_row(
  uuid, text, text, text, date, text, text, text, text, uuid, text
);

drop function if exists public.import_gig_row(
  uuid, text, text, text, date, text, text, text, text, uuid, text, jsonb, jsonb
);
