// Sprint 5B: derives each row's single review-workflow status from the
// three independent checks (venue match, artist match, duplicate
// detection) plus Sprint 5A's own parser `status`. These are exactly the
// five buckets the review UI filters by: Ready, Needs Review, Duplicate,
// New Venue, New Artist.
export const REVIEW_STATUSES = {
  READY: "ready",
  NEEDS_REVIEW: "needs_review",
  DUPLICATE: "duplicate",
  NEW_VENUE: "new_venue",
  NEW_ARTIST: "new_artist",
};

export const REVIEW_STATUS_LABELS = {
  [REVIEW_STATUSES.READY]: "Ready",
  [REVIEW_STATUSES.NEEDS_REVIEW]: "Needs Review",
  [REVIEW_STATUSES.DUPLICATE]: "Duplicate",
  [REVIEW_STATUSES.NEW_VENUE]: "New Venue",
  [REVIEW_STATUSES.NEW_ARTIST]: "New Artist",
};

// Precedence (checked top to bottom, first match wins):
//   1. Duplicate -- the highest-cost mistake to import (a second live copy
//      of a real gig), so it wins even over a clean venue/artist match.
//   2. Needs Review (parser-level) -- Sprint 5A's own status is anything
//      but "ok", meaning the underlying fields aren't trustworthy yet, so
//      it's resolved before any matching conclusion is drawn from them.
//   3. New Venue -- no venue match at all. Checked before New Artist
//      because venue matching is this sprint's own priority 1.
//   4. New Artist -- no artist match at all (and venue did resolve).
//   5. Needs Review (match-level) -- venue and/or artist only found a
//      fuzzy (unconfirmed) candidate; a human has to pick.
//   6. Ready -- everything above cleared.
// "not_applicable" (artist matching skipped entirely, e.g. generic-dash-list
// rows -- see artistMatching.js) is deliberately treated the same as a
// resolved match here: there's nothing to review or flag as new.
export function deriveReviewStatus({ parserStatus, duplicate, venueMatch, artistMatch }) {
  if (duplicate && duplicate.tier !== "none") return REVIEW_STATUSES.DUPLICATE;
  if (parserStatus !== "ok") return REVIEW_STATUSES.NEEDS_REVIEW;
  if (venueMatch.tier === "none") return REVIEW_STATUSES.NEW_VENUE;
  if (artistMatch.tier === "none") return REVIEW_STATUSES.NEW_ARTIST;
  if (venueMatch.tier === "fuzzy" || artistMatch.tier === "fuzzy") return REVIEW_STATUSES.NEEDS_REVIEW;
  return REVIEW_STATUSES.READY;
}
