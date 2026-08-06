// Sprint 5B: venue matching -- resolves a parsed row's best-guess venue
// name against the existing `venues` table before it ever reaches the
// review UI. Two tiers, checked in order:
//
//   1. exact -- the normalised venue name (+ city, when known) matches an
//      existing venue exactly. Mirrors auto_create_venue()'s own
//      `lower(trim(regexp_replace(name, '\s+',' ','g')))` normalisation (see
//      textNormalize.js), so "exact" here means the database would already
//      consider it the same venue.
//   2. fuzzy -- no exact match, but the `search_entities('venue', ...)` RPC
//      (trigram similarity + ilike fallback, already tuned server-side via
//      extensions.set_limit(0.25) -- see that function's SQL) returned at
//      least one candidate. Surfaced to the admin as "Needs Review" rather
//      than auto-picked: a wrong pick would silently mis-link a gig to the
//      wrong venue, and any candidate the RPC judged worth returning is
//      worth a human glance rather than a second, independently-tuned
//      confidence cutoff invented here.
//
// No candidates at all -> tier "none" ("New Venue" in the review UI).
//
// This module is pure and synchronous: it never calls Supabase itself. The
// caller (runMatching.js) fetches the `venues` snapshot and the fuzzy
// candidates (via an injected search function) and passes both in -- that's
// what keeps this file unit-testable the same way every Sprint 5A module is:
// plain fixtures in, a plain result out, no network.
import { normaliseName, normaliseCity, stripStatusWording } from "./textNormalize.js";

// venueBlock (msm-gig-guide profile only) is "<venue name>, <address>" --
// see sourceProfiles.js's msm-gig-guide section comment. The venue name is
// always the text before the first comma; the street address after it is
// not useful for matching and is discarded here.
export function deriveVenueQuery(fields) {
  if (fields.venueName) {
    return { query: stripStatusWording(fields.venueName).trim(), city: fields.city || null };
  }
  if (fields.venueBlock) {
    const commaIdx = fields.venueBlock.indexOf(",");
    const name = commaIdx === -1 ? fields.venueBlock : fields.venueBlock.slice(0, commaIdx);
    return { query: stripStatusWording(name).trim(), city: null };
  }
  return { query: "", city: null };
}

function findExactVenue(query, city, venues) {
  const qNorm = normaliseName(query);
  if (!qNorm) return null;

  if (city) {
    const cityNorm = normaliseCity(city);
    return (
      venues.find((v) => (v.name_normalised || normaliseName(v.name)) === qNorm && normaliseCity(v.city) === cityNorm) ||
      null
    );
  }

  // No city known (e.g. a venueBlock-derived query): only treat it as exact
  // when the normalised name is unambiguous across every city -- two
  // same-named venues in different towns need a human to pick, not a guess.
  const matches = venues.filter((v) => (v.name_normalised || normaliseName(v.name)) === qNorm);
  return matches.length === 1 ? matches[0] : null;
}

export function classifyVenueMatch(fields, venues, fuzzyCandidates = []) {
  const { query, city } = deriveVenueQuery(fields);
  if (!query) return { tier: "none", query: "", city, match: null, candidates: [] };

  const exact = findExactVenue(query, city, venues);
  if (exact) {
    return { tier: "exact", query, city, match: { id: exact.id, name: exact.name, city: exact.city }, candidates: [] };
  }

  const candidates = [...fuzzyCandidates].sort((a, b) => b.similarity_score - a.similarity_score);
  if (candidates.length > 0) {
    return { tier: "fuzzy", query, city, match: null, candidates };
  }

  return { tier: "none", query, city, match: null, candidates: [] };
}
