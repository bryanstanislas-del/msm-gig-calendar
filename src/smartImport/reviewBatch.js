// Sprint 5B.5: derives each row's single, granular review state from the
// three independent checks (venue match, artist match, duplicate
// detection), Sprint 5A's own parser `status`, and Sprint 5A's structured
// event-status flags (isCancelled/isPostponed/isRescheduled). This is the
// row-state model the Import Review Dashboard's filters, defaults, and
// batch summary are all built on.
export const ROW_STATES = {
  EXACT_DUPLICATE: "exact_duplicate",
  INVALID_DATE: "invalid_date",
  CANCELLED: "cancelled",
  POSTPONED: "postponed",
  RESCHEDULED: "rescheduled",
  PROBABLE_DUPLICATE: "probable_duplicate",
  POSSIBLE_DUPLICATE: "possible_duplicate",
  NEEDS_REVIEW: "needs_review",
  MISSING_VENUE: "missing_venue",
  MISSING_ARTIST: "missing_artist",
  READY: "ready",
};

// Not a value deriveRowState() ever returns -- it's a UI-only overlay
// computed by resolveDisplayState() when an admin unchecks a row that
// defaults to included. Kept alongside ROW_STATES (not inside it) so
// "the 11 states a row can actually be classified as" and "the 12th,
// admin-driven display label" stay conceptually distinct in code, matching
// how the row-state model document describes them.
export const EXCLUDED_MANUALLY = "excluded_manually";

export const ROW_STATE_LABELS = {
  [ROW_STATES.READY]: "Ready",
  [ROW_STATES.NEEDS_REVIEW]: "Needs Review",
  [ROW_STATES.MISSING_ARTIST]: "Missing Artist",
  [ROW_STATES.MISSING_VENUE]: "Missing Venue",
  [ROW_STATES.INVALID_DATE]: "Invalid Date",
  [ROW_STATES.POSSIBLE_DUPLICATE]: "Possible Duplicate",
  [ROW_STATES.PROBABLE_DUPLICATE]: "Probable Duplicate",
  [ROW_STATES.EXACT_DUPLICATE]: "Exact Duplicate",
  [ROW_STATES.CANCELLED]: "Cancelled",
  [ROW_STATES.POSTPONED]: "Postponed",
  [ROW_STATES.RESCHEDULED]: "Rescheduled",
  [EXCLUDED_MANUALLY]: "Excluded Manually",
};

// Grouped for the required bulk actions ("Exclude all errors" / "Exclude
// all duplicates") -- deliberately separate lists: duplicates are a
// same-event judgement call, errors are missing/unparseable data. Cancelled
// /Postponed/Rescheduled are editorial facts about the event, not row
// *quality* problems, so they're in neither list -- they get their own
// default-exclude behaviour (see DEFAULT_INCLUDED_STATES) without being
// swept up by either bulk button.
export const DUPLICATE_STATES = [ROW_STATES.EXACT_DUPLICATE, ROW_STATES.PROBABLE_DUPLICATE, ROW_STATES.POSSIBLE_DUPLICATE];
export const ERROR_STATES = [ROW_STATES.INVALID_DATE, ROW_STATES.NEEDS_REVIEW, ROW_STATES.MISSING_VENUE, ROW_STATES.MISSING_ARTIST];

// Only "ready" rows are selected for import by default -- every other state
// requires an explicit admin decision to include.
export const DEFAULT_INCLUDED_STATES = [ROW_STATES.READY];

// The only two states where inclusion would be a data-integrity failure,
// not a policy judgement call: importing an exact duplicate creates a
// literal duplicate database record, and a row with no date has nothing to
// schedule. Every other state is a call an admin is allowed to make.
export const LOCKED_STATES = [ROW_STATES.EXACT_DUPLICATE, ROW_STATES.INVALID_DATE];

export function isLocked(rowState) {
  return LOCKED_STATES.includes(rowState);
}

// Precedence (checked top to bottom, first match wins):
//   1. Exact duplicate -- the highest-cost mistake to import (a literal
//      duplicate database record), wins over everything else.
//   2. Invalid date -- nothing to schedule, checked before any editorial
//      flag or matching conclusion is drawn from an otherwise-unusable row.
//   3-5. Cancelled / Postponed / Rescheduled -- editorial facts about the
//      event that change whether it's even worth resolving venue/artist
//      matches for, so they're surfaced before match-quality states.
//   6. Probable duplicate -- a near-match against a *live* gig already in
//      the database: a higher-confidence signal than a near-match against
//      another still-unconfirmed line in the same paste.
//   7. Possible duplicate -- a near-match against another row in the same
//      paste only.
//   8. Needs review -- Sprint 5A's own parser status isn't "ok", or the
//      venue/artist match is only a fuzzy (unconfirmed) candidate.
//   9. Missing venue -- no venue match at all. Checked before missing
//      artist because venue matching was this project's own priority 1.
//   10. Missing artist -- no artist match at all (and venue did resolve).
//   11. Ready -- everything above cleared.
// "not_applicable" (artist matching skipped entirely, e.g. generic-dash-list
// rows -- see artistMatching.js) is deliberately treated the same as a
// resolved match: there's nothing to review or flag as missing.
export function deriveRowState({ parserStatus, fields, duplicate, venueMatch, artistMatch }) {
  if (duplicate.tier === "exact_in_batch" || duplicate.tier === "exact_existing") return ROW_STATES.EXACT_DUPLICATE;
  if (!fields.date) return ROW_STATES.INVALID_DATE;
  if (fields.isCancelled) return ROW_STATES.CANCELLED;
  if (fields.isPostponed) return ROW_STATES.POSTPONED;
  if (fields.isRescheduled) return ROW_STATES.RESCHEDULED;
  if (duplicate.tier === "near_existing") return ROW_STATES.PROBABLE_DUPLICATE;
  if (duplicate.tier === "near_in_batch") return ROW_STATES.POSSIBLE_DUPLICATE;
  if (parserStatus !== "ok") return ROW_STATES.NEEDS_REVIEW;
  if (venueMatch.tier === "fuzzy" || artistMatch.tier === "fuzzy") return ROW_STATES.NEEDS_REVIEW;
  if (venueMatch.tier === "none") return ROW_STATES.MISSING_VENUE;
  if (artistMatch.tier === "none") return ROW_STATES.MISSING_ARTIST;
  return ROW_STATES.READY;
}

// The label the review UI actually filters/badges/counts by: a row's own
// state, unless it's a default-included ("ready") row the admin has
// unchecked, in which case it displays as "Excluded Manually" instead.
// Unchecking an already-default-excluded row (e.g. Cancelled) just confirms
// that default -- it keeps its own label, not this overlay.
export function resolveDisplayState(rowState, isSelected) {
  if (!isSelected && DEFAULT_INCLUDED_STATES.includes(rowState)) return EXCLUDED_MANUALLY;
  return rowState;
}

// Builds the human-readable "why is this row blocked/flagged" text --
// single source of truth reused for a row's own tooltip/detail line and for
// the confirmation step's grouped skip reasons. Pure text, no JSX: this
// module stays framework-free like every other Sprint 5A/5B module.
export function explainRowState(item) {
  const { fields, issues, duplicate, venueMatch, artistMatch } = item;
  const reasons = [];

  if (duplicate.tier === "exact_existing") {
    reasons.push("Matches a gig already in the calendar exactly (same artist, date and venue).");
  } else if (duplicate.tier === "exact_in_batch") {
    reasons.push("Matches another row in this paste exactly (same artist, date and venue).");
  } else if (duplicate.tier === "near_existing") {
    reasons.push("Closely resembles a gig already in the calendar on the same date and at the same venue.");
  } else if (duplicate.tier === "near_in_batch") {
    reasons.push("Closely resembles another row in this paste on the same date and at the same venue.");
  }

  if (!fields.date) reasons.push("No valid date could be parsed from this row.");
  if (fields.isCancelled) reasons.push("Marked as cancelled in the source text.");
  if (fields.isPostponed) reasons.push("Marked as postponed in the source text.");
  if (fields.isRescheduled) reasons.push("Marked as rescheduled in the source text.");

  for (const issue of issues || []) reasons.push(issue);

  if (venueMatch.tier === "none") {
    reasons.push(`No matching venue found for "${venueMatch.query}" -- will be created as a new venue.`);
  } else if (venueMatch.tier === "fuzzy") {
    const top = venueMatch.candidates[0];
    reasons.push(`Venue match uncertain: closest is "${top.name}" (${Math.round(top.similarity_score * 100)}% match) -- needs confirmation.`);
  }

  if (artistMatch.tier === "none") {
    reasons.push(`No matching artist found for "${artistMatch.query}" -- will import as free text with no artist profile linked.`);
  } else if (artistMatch.tier === "fuzzy") {
    const top = artistMatch.candidates[0];
    reasons.push(`Artist match uncertain: closest is "${top.name}" (${Math.round(top.similarity_score * 100)}% match) -- needs confirmation.`);
  }

  return reasons;
}
