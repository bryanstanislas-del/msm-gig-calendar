// Sprint 5B: artist matching -- same two-tier approach as venueMatching.js
// (see that file's header comment for the full exact/fuzzy rationale),
// applied to fields.artistName against public.profiles.
//
// Scope: only profile_type 'band' and 'solo_artist' are matched. Smart
// Import's parsed artistName never says in advance whether an act is a solo
// artist or a full band, so both types are searched and merged by the
// caller (runMatching.js, via two search_entities calls) before this module
// sees the results; festival/promoter/organisation are a different kind of
// entity and out of scope for "artist matching" specifically.
//
// fields.artistName is `null` (not attempted, not "attempted and failed")
// for profiles that never extract a per-row artist -- generic-dash-list
// supplies one artist for the whole batch externally, same as today's Bulk
// Import (see sourceProfiles.js and confidence.js's own null-vs-zero
// distinction). Matching mirrors that: tier "not_applicable" so those rows
// aren't wrongly flagged "New Artist".
import { normaliseName, stripStatusWording } from "./textNormalize.js";

export const ARTIST_PROFILE_TYPES = ["band", "solo_artist"];

// See venueMatching.js's VENUE_MATCH_THRESHOLDS comment for why this exists
// on top of search_entities' own 0.25 floor -- same RPC, same noise problem.
export const ARTIST_MATCH_THRESHOLDS = { MIN_FUZZY_SIMILARITY: 0.35 };

export function deriveArtistQuery(fields) {
  if (fields.artistName == null) return { query: null, applicable: false };
  return { query: stripStatusWording(fields.artistName).trim(), applicable: true };
}

function findExactArtist(query, profiles) {
  const qNorm = normaliseName(query);
  if (!qNorm) return null;
  return (
    profiles.find((p) => ARTIST_PROFILE_TYPES.includes(p.profile_type) && normaliseName(p.band_name) === qNorm) || null
  );
}

export function classifyArtistMatch(fields, profiles, fuzzyCandidates = []) {
  const { query, applicable } = deriveArtistQuery(fields);
  if (!applicable) return { tier: "not_applicable", query: null, match: null, candidates: [] };
  if (!query) return { tier: "none", query: "", match: null, candidates: [] };

  const exact = findExactArtist(query, profiles);
  if (exact) {
    return {
      tier: "exact",
      query,
      match: { id: exact.id, name: exact.band_name, city: exact.city, profileType: exact.profile_type },
      candidates: [],
    };
  }

  const candidates = fuzzyCandidates
    .filter((c) => c.similarity_score >= ARTIST_MATCH_THRESHOLDS.MIN_FUZZY_SIMILARITY)
    .sort((a, b) => b.similarity_score - a.similarity_score);
  if (candidates.length > 0) return { tier: "fuzzy", query, match: null, candidates };

  return { tier: "none", query, match: null, candidates: [] };
}
