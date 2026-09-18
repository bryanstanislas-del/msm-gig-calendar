// Venue Data Enrichment, Phase 1 -- RESEARCH INPUT export.
//
// Converts a real public.venues row into the canonical, minimal JSON a
// future Claude research batch is given. This is NOT web research and
// performs no I/O of any kind -- it is a pure, synchronous transform over
// records the caller already fetched, fully testable with plain fixture
// objects (same convention as smartImport/textNormalize.js and
// venueSearch/normalize.js -- see those files' own header comments).
//
// PRIVACY: only venue_id/name/city/claim state and the 14 enrichment
// fields' own current values ever leave this module. venue.user_id,
// any email/auth identity, or any other column not explicitly listed in
// ENRICHMENT_FIELDS below is never read or emitted -- see
// buildVenueResearchInput()'s own object literal, which is built from a
// fixed, named field list rather than spreading the input venue object.

// The exact 14 enrichment fields from the Phase 0 audit -- kept as the one
// JS source of truth for "which venues.* columns does enrichment ever
// touch". Mirrored (by hand -- see that migration's own header comment)
// by the DB CHECK constraint in
// supabase/migrations/20260918120000_venue_enrichment_candidates.sql, so a
// staged candidate can never target a field this module wouldn't itself
// have exported for research in the first place.
export const ENRICHMENT_FIELDS = [
  "postcode", "address", "capacity", "contact_email", "phone",
  "description", "website", "facebook", "instagram", "twitter",
  "photo_url", "seo_title", "seo_description", "seo_search_phrases",
];

// The subset of ENRICHMENT_FIELDS that are MSM-generated editorial/SEO
// text rather than externally-researched facts -- see researchFormat.js's
// own GENERATED_FIELDS re-export and validateCandidate() for how a
// candidate on one of these fields is held to a different provenance rule
// (source_type:"generated", notes explaining which verified facts it was
// built from, rather than a source_url).
export const GENERATED_FIELDS = ["description", "seo_title", "seo_description", "seo_search_phrases"];

// Blank normalisation: NULL, undefined, "" and whitespace-only strings are
// all "missing". A non-string, non-nullish value (in practice here: only
// capacity, an integer) is never blank -- see isCapacityMissing()'s own
// comment for why capacity 0 specifically is deliberately NOT treated as
// missing, even though it's a JS-falsy value.
export function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

// Capacity is the one enrichment field that isn't text: public.venues.
// capacity is `integer`, and 0 -- while an unusual real-world venue
// capacity -- is a genuine, distinct value from "never recorded" (NULL).
// Nothing in the current schema (no CHECK constraint) or elsewhere in this
// codebase's business logic requires treating 0 as empty; the one place
// that currently DOES coerce 0 away is AdminVenues' own form pre-fill
// (`venue.capacity || ""` at App.jsx -- plain JS falsy-coalescing, not a
// deliberate "0 means blank" rule), a pre-existing, unrelated form-display
// quirk this task does not touch. Enrichment's own missing-field
// determination therefore uses a strict null/undefined check, independent
// of isBlank()'s string-trimming rule (capacity is never a string here).
export function isCapacityMissing(value) {
  return value === null || value === undefined;
}

export function isFieldMissing(field, value) {
  return field === "capacity" ? isCapacityMissing(value) : isBlank(value);
}

export function getMissingFields(venue) {
  return ENRICHMENT_FIELDS.filter((field) => isFieldMissing(field, venue?.[field]));
}

// EXISTING DATA WINS: current_values below carries ONLY the
// already-populated fields, so nothing downstream (research prompt,
// staging insert) can mistake "not asked about" for "confirmed blank", and
// a populated field is never implicitly offered up for overwriting --
// research is normally requested only for entries in missing_fields.
// Phase 1 builds no code path that writes a suggestion back over a
// current_values entry.
function buildCurrentValues(venue) {
  const values = {};
  for (const field of ENRICHMENT_FIELDS) {
    const value = venue?.[field];
    if (!isFieldMissing(field, value)) values[field] = value;
  }
  return values;
}

// One venue's own research input. Deliberately built as a fixed object
// literal (never `{...venue}`) so adding an unrelated column to
// public.venues in the future can never silently leak into what Claude
// receives -- see this file's own header comment on privacy.
//
// claim_status/claimed are included specifically so the research
// CONSUMER (and, later, an admin reviewer) can apply the Phase 0 audit's
// own "claimed venue candidates require manual review" rule -- see
// RESEARCH_CONTRACT.md. Nothing here grants a claimed venue any different
// research treatment by itself; it's a flag for the review step, not a
// behavioural branch in this export.
export function buildVenueResearchInput(venue) {
  return {
    venue_id: venue.id,
    name: venue.name,
    city: venue.city,
    current_values: buildCurrentValues(venue),
    missing_fields: getMissingFields(venue),
    claimed: Boolean(venue.claimed),
    claim_status: venue.claim_status ?? "unclaimed",
  };
}

// A venue with nothing missing has nothing to research -- filtering these
// out keeps a batch's own venues[] free of no-op entries a researcher
// would otherwise have to notice and skip by hand.
export function hasMissingFields(venue) {
  return getMissingFields(venue).length > 0;
}

// The canonical RESEARCH INPUT batch: see RESEARCH_CONTRACT.md for the
// full field-by-field contract a future Claude research run must follow
// when it's handed this shape. batchId is caller-supplied text (see the
// migration's own "Batch identity" comment) -- this module has no opinion
// on its format beyond passing it through unchanged.
export function buildResearchInputBatch(batchId, venues) {
  return {
    batch: batchId,
    venues: (venues || []).filter(hasMissingFields).map(buildVenueResearchInput),
  };
}
