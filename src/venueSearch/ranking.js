// Venue Identity & Matching, Phase 2A: shared, pure venue-candidate
// classification and ranking. Consumed by the Venue Picker (Phase 2B, this
// PR) and intended for smartImport/venueMatching.js to adopt in Phase 2D
// instead of maintaining its own separate tier logic -- not done in this
// PR (see this module's own header note on that below).
//
// Every candidate this module is given is assumed to already have passed
// SOME server-side text search (search_entities) -- this module never
// invents its own fuzzy-similarity algorithm; where a fuzzy signal is
// needed it uses whatever `similarity_score` the caller attached to the
// candidate (search_entities' own pg_trgm score), per the Phase 1 audit's
// explicit instruction not to build a second, unrelated fuzzy algorithm.
//
// SAFETY CONTRACT: only MATCH_TYPES.EXACT is ever eligible to be treated as
// an automatic, high-confidence existing-venue identity by a FUTURE caller
// (e.g. Smart Import's "exact" tier). Every other tier -- ALIAS, PREFIX,
// TOKEN, CONTAINS, FUZZY -- is a suggestion a human must click; nothing in
// this module (or the Venue Picker built on top of it) ever turns one of
// those into a selection on its own. The Venue Picker itself (pickerState.js)
// goes further still and requires an explicit click for EVERY tier,
// including EXACT -- this module's EXACT/non-EXACT split is about what a
// caller may safely automate, not about auto-selecting in the UI.
import { normaliseName, normaliseCity } from "../smartImport/textNormalize.js";
import { normaliseNameForSearch, normalisePostcodeForSearch } from "./normalize.js";

export const MATCH_TYPES = {
  EXACT: "exact",
  ALIAS: "alias",
  PREFIX: "prefix",
  TOKEN: "token",
  CONTAINS: "contains",
  FUZZY: "fuzzy",
};

// Ascending = higher confidence. Used both to pick the single best tier a
// candidate qualifies for and to sort the final result list.
const TIER_RANK = {
  [MATCH_TYPES.EXACT]: 0,
  [MATCH_TYPES.ALIAS]: 1,
  [MATCH_TYPES.PREFIX]: 2,
  [MATCH_TYPES.TOKEN]: 3,
  [MATCH_TYPES.CONTAINS]: 4,
  [MATCH_TYPES.FUZZY]: 5,
};

// Same threshold and reasoning smartImport/venueMatching.js already uses
// and has verified against real data (see that file's header comment for
// the full "The Brook" / trigram-noise investigation this value comes
// from). Duplicated here rather than imported from venueMatching.js
// because this module must not create a dependency FROM the shared
// primitives back INTO a Smart-Import-specific file -- venueMatching.js is
// the one expected to import from here in Phase 2D, not the reverse. Kept
// as the same literal value on purpose; Phase 2D should delete
// venueMatching.js's own copy once it switches over, rather than let the
// two drift apart.
export const MIN_FUZZY_SIMILARITY = 0.35;

// Classifies how `candidateName` relates to `query`, or returns null if no
// textual tier applies (the caller decides whether a similarity_score
// still qualifies it as FUZZY). `cityOk` gates the two tiers that are ever
// eligible to mean "same real-world venue" -- EXACT and ALIAS -- exactly
// mirroring venueMatching.js's own findExactVenue(), which already refuses
// to treat a name-only match as identity once a city is known and doesn't
// agree. A city mismatch never removes a candidate from the list (it can
// still legitimately be PREFIX/TOKEN/CONTAINS/FUZZY, i.e. still worth
// showing so the human can see and reject it) -- it only ever blocks the
// two identity-grade tiers.
function classifyNameMatch(query, candidateName, cityOk) {
  const strictQuery = normaliseName(query);
  const strictCandidate = normaliseName(candidateName);
  if (!strictQuery || !strictCandidate) return null;

  if (cityOk && strictQuery === strictCandidate) return MATCH_TYPES.EXACT;

  const aliasQuery = normaliseNameForSearch(query);
  const aliasCandidate = normaliseNameForSearch(candidateName);
  if (!aliasQuery || !aliasCandidate) return null;

  if (cityOk && aliasQuery === aliasCandidate) return MATCH_TYPES.ALIAS;

  if (aliasCandidate.startsWith(aliasQuery)) return MATCH_TYPES.PREFIX;

  const candidateTokens = aliasCandidate.split(" ");
  if (candidateTokens.some((token) => token && token.startsWith(aliasQuery))) return MATCH_TYPES.TOKEN;

  // Symmetric on purpose: candidateAlias.includes(aliasQuery) catches the
  // ordinary "query is a fragment of the venue name" case, while
  // aliasQuery.includes(candidateAlias) catches the reverse -- someone
  // typing (or an import row carrying) "Platform Tavern Town Quay" must
  // still surface "Platform Tavern", but only as this lowest safe textual
  // tier, never as EXACT/ALIAS -- the Phase 1 audit's explicit "do not
  // treat appended city/address text as proven identity" requirement.
  if (aliasCandidate.includes(aliasQuery) || aliasQuery.includes(aliasCandidate)) return MATCH_TYPES.CONTAINS;

  return null;
}

// candidates: [{ id, name, city, address?, postcode?, similarity_score? }],
// the shape search_entities already returns today (address/postcode are
// tolerated as absent -- see this PR's report on the current RPC contract
// limitation). context: { city?, postcode? } -- both optional, both purely
// informational filters the caller (e.g. a partially-filled Submit Gig
// form) may or may not have yet.
//
// Returns every candidate that qualified for a tier, each annotated with
// `matchType`, `cityMatch` (true/false/null -- null means no city context
// was supplied to compare against, not "unknown"), and `postcodeMatch`
// (same convention), sorted best-first: tier rank, then same-city before
// different-city (only when a city context was given), then matching
// postcode before non-matching (only when a postcode context was given),
// then similarity_score descending, then name length then alphabetically
// for a fully deterministic order (mirrors search_entities' own
// `order by similarity_score desc, name asc` tiebreak convention).
export function rankVenueCandidates(query, candidates, context = {}) {
  const aliasQuery = normaliseNameForSearch(query);
  if (!aliasQuery || !Array.isArray(candidates) || candidates.length === 0) return [];

  const contextCity = context.city ? normaliseCity(context.city) : null;
  const contextPostcode = context.postcode ? normalisePostcodeForSearch(context.postcode) : null;

  const ranked = [];
  for (const candidate of candidates) {
    if (!candidate || !candidate.name) continue;

    const cityMatch = contextCity == null ? null : normaliseCity(candidate.city) === contextCity;
    const cityOk = contextCity == null || cityMatch === true;

    let matchType = classifyNameMatch(query, candidate.name, cityOk);
    if (!matchType) {
      const score = typeof candidate.similarity_score === "number" ? candidate.similarity_score : null;
      if (score != null && score >= MIN_FUZZY_SIMILARITY) matchType = MATCH_TYPES.FUZZY;
    }
    if (!matchType) continue;

    const postcodeMatch =
      contextPostcode == null || !candidate.postcode
        ? null
        : normalisePostcodeForSearch(candidate.postcode) === contextPostcode;

    ranked.push({ ...candidate, matchType, cityMatch, postcodeMatch });
  }

  // Ambiguity guard, mirroring venueMatching.js's own findExactVenue(): with
  // no city context to disambiguate, two DIFFERENT real venues can
  // legitimately share a strict-normalised name (e.g. "The Crown" in two
  // towns). EXACT is the one tier a future caller may treat as automatic
  // identity (isAutoResolvableMatchType), so it must never come out
  // ambiguous -- downgrade every EXACT candidate to ALIAS (still a strong,
  // very-likely-the-same-name suggestion, just no longer auto-resolvable)
  // whenever more than one qualified. Only relevant when contextCity is
  // null: with a city supplied, cityOk already ensures at most one
  // candidate can reach EXACT (the DB's own venues_name_city_idx guarantees
  // no two real venues share both a name and a city).
  if (contextCity == null) {
    const exactCount = ranked.filter((r) => r.matchType === MATCH_TYPES.EXACT).length;
    if (exactCount > 1) {
      for (const r of ranked) {
        if (r.matchType === MATCH_TYPES.EXACT) r.matchType = MATCH_TYPES.ALIAS;
      }
    }
  }

  ranked.sort((a, b) => {
    const tierDiff = TIER_RANK[a.matchType] - TIER_RANK[b.matchType];
    if (tierDiff !== 0) return tierDiff;
    if (contextCity != null && a.cityMatch !== b.cityMatch) return a.cityMatch ? -1 : 1;
    if (contextPostcode != null && a.postcodeMatch !== b.postcodeMatch) return a.postcodeMatch ? -1 : 1;
    const scoreDiff = (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name);
  });

  return ranked;
}

// The only tier a future caller (e.g. Smart Import, Phase 2D) may treat as
// an automatic existing-venue identity with no human confirmation. Every
// other value in MATCH_TYPES requires a click -- see this file's header.
export function isAutoResolvableMatchType(matchType) {
  return matchType === MATCH_TYPES.EXACT;
}
