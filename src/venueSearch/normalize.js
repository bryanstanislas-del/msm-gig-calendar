// Venue Identity & Matching, Phase 2A: a SEARCH/RANKING-only normalisation
// layer, deliberately separate from smartImport/textNormalize.js's
// normaliseName()/normaliseCity(). Those two stay exactly as they are --
// they define database identity (they mirror venues.name_normalised's own
// generated-column formula and the venues_name_city_idx unique index) and
// changing their semantics would reclassify what the database itself
// considers a duplicate. Nothing in this file touches them.
//
// normaliseNameForSearch() is intentionally LOOSER: it exists only to rank
// and surface candidates for a human to click, never to decide identity by
// itself. It safely strips things a person would consider pure formatting
// (a leading "The ", apostrophes, comma/hyphen/slash punctuation, repeated
// whitespace) but never removes whole words. "Platform Tavern Town Quay"
// must stay distinguishable from "Platform Tavern" -- see ranking.js's
// CONTAINS tier, which surfaces that relationship as a low-confidence
// suggestion instead of silently deleting "Town Quay" to force a match.

// Requires "the" to be immediately followed by whitespace, so a venue
// genuinely named starting with those letters as one word (e.g. "Theatre
// Royal") is never mis-stripped -- only a real leading definite article
// ("The Theatre Royal" -> "theatre royal") is removed. This does mean a
// venue literally named "Theatre Royal" and one named "The Theatre Royal"
// would normalise to the same search key -- an inherent, accepted limit of
// alias-style matching (see the Phase 1 audit's discussion of ALIAS being
// suggestion-only, never an automatic identity decision, for exactly this
// reason).
const LEADING_THE_RE = /^the\s+/;
const APOSTROPHE_RE = /['’]/g;
const SEARCH_PUNCTUATION_RE = /[.,\-/]+/g;

export function normaliseNameForSearch(text) {
  if (!text) return "";
  let s = String(text).trim().toLowerCase();
  s = s.replace(LEADING_THE_RE, "");
  s = s.replace(APOSTROPHE_RE, "");
  s = s.replace(SEARCH_PUNCTUATION_RE, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// UK postcodes are sometimes stored/typed with or without the internal
// space ("SO14 2NY" vs "SO142NY"). Whitespace-insensitive, case-insensitive
// comparison only -- no validation, no reformatting of a canonical value.
export function normalisePostcodeForSearch(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, "").toUpperCase();
}
