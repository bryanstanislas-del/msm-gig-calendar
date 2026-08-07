// Sprint 5B.5: the Import Review Dashboard's selection/override/summary
// logic -- everything needed to go from a matched batch (runMatching()'s
// output) to "here's exactly what will be imported and what will be
// skipped, and why." Pure and synchronous, like every other Sprint 5A/5B
// module: no React, no Supabase, plain data in and out.
//
// Sprint 5D change: `selected` is no longer state the caller mutates
// directly -- it's DERIVED (see deriveSelection below) from two provenance
// sets, `explicitlyIncluded`/`explicitlyExcluded`, both owned by the caller
// (ImportReviewDashboard in App.jsx). This exists specifically so "the
// system never auto-included this row" and "the admin explicitly excluded
// this row" can never be confused with each other -- a single undifferen-
// tiated Set couldn't tell them apart, which made it impossible to
// guarantee a manual exclusion survives a later grouped decision changing
// the row's state (see groupResolution.js's header comment and Sprint 5D's
// plan doc, "Composing with existing state"). `overrides`: a plain object
// `{ [rowId]: { venueCandidateId?, artistCandidateId?, ... } }` recording
// an admin's accepted fuzzy-match candidate (and, as of Sprint 5D, other
// one-off row-level resolution fields -- see groupResolution.js) for a row,
// if any. Every function below takes these as plain arguments and returns
// a new value rather than mutating -- consistent with how the rest of this
// module tree treats data.
import { ROW_STATES, EXCLUDED_MANUALLY, DUPLICATE_STATES, ERROR_STATES, DEFAULT_INCLUDED_STATES, ROW_STATE_LABELS, resolveDisplayState } from "./reviewBatch.js";

// The single source of truth for "is this row currently selected": a row is
// selected iff it was explicitly included, OR its own rowState is one of
// the default-included states and it was NOT explicitly excluded. Because
// this is a pure derivation (not an imperatively-patched Set), a row
// dropped back out of selection the instant its rowState or its exclusion
// status changes -- no reconciliation step needed, and a manual exclusion
// can never be silently lost when a later decision changes the row's state.
export function deriveSelection(items, { explicitlyIncluded = new Set(), explicitlyExcluded = new Set() } = {}) {
  const selected = new Set();
  for (const item of items) {
    const included =
      explicitlyIncluded.has(item.id) ||
      (DEFAULT_INCLUDED_STATES.includes(item.rowState) && !explicitlyExcluded.has(item.id));
    if (included) selected.add(item.id);
  }
  return selected;
}

// The very first render, before any admin action: equivalent to
// deriveSelection with both provenance sets empty.
export function computeDefaultSelection(items) {
  return deriveSelection(items, {});
}

// Whole-batch bulk actions -- always operate on every row regardless of
// the current filter, so their effect is predictable no matter what the
// admin happens to be looking at. All four now take/return the
// { explicitlyIncluded, explicitlyExcluded } pair instead of a raw
// `selected` Set -- a real semantic change from Sprint 5B.5, not just a
// rename: "select"/"exclude" now record a durable decision (which
// `deriveSelection` will keep honouring even after a later rowState change)
// rather than a one-time patch to whatever the selected Set happened to
// contain at the time.
export function selectAllReady(items, { explicitlyIncluded, explicitlyExcluded }) {
  const nextIncluded = new Set(explicitlyIncluded);
  const nextExcluded = new Set(explicitlyExcluded);
  for (const item of items) {
    if (item.rowState === ROW_STATES.READY) nextExcluded.delete(item.id);
  }
  return { explicitlyIncluded: nextIncluded, explicitlyExcluded: nextExcluded };
}

export function excludeAllErrors(items, { explicitlyIncluded, explicitlyExcluded }) {
  const nextIncluded = new Set(explicitlyIncluded);
  const nextExcluded = new Set(explicitlyExcluded);
  for (const item of items) {
    if (ERROR_STATES.includes(item.rowState)) {
      nextIncluded.delete(item.id);
      nextExcluded.add(item.id);
    }
  }
  return { explicitlyIncluded: nextIncluded, explicitlyExcluded: nextExcluded };
}

export function excludeAllDuplicates(items, { explicitlyIncluded, explicitlyExcluded }) {
  const nextIncluded = new Set(explicitlyIncluded);
  const nextExcluded = new Set(explicitlyExcluded);
  for (const item of items) {
    if (DUPLICATE_STATES.includes(item.rowState)) {
      nextIncluded.delete(item.id);
      nextExcluded.add(item.id);
    }
  }
  return { explicitlyIncluded: nextIncluded, explicitlyExcluded: nextExcluded };
}

// The one selection-scoped bulk action: only touches rows currently in
// view (`filteredItems`), unlike the whole-batch actions above.
export function excludeVisibleSelected(filteredItems, { explicitlyIncluded, explicitlyExcluded }) {
  const nextIncluded = new Set(explicitlyIncluded);
  const nextExcluded = new Set(explicitlyExcluded);
  for (const item of filteredItems) {
    nextIncluded.delete(item.id);
    nextExcluded.add(item.id);
  }
  return { explicitlyIncluded: nextIncluded, explicitlyExcluded: nextExcluded };
}

// Accepts a specific fuzzy candidate for one match (venue or artist),
// turning it into a "confirmed" match -- resolved, not fuzzy, but visibly
// distinct from an originally-"exact" match so the row's detail can still
// show it was an admin's pick. classifyVenueMatch/classifyArtistMatch never
// produce this tier themselves; it only exists as this override layer's
// output, which is exactly what lets deriveRowState() treat a confirmed row
// as resolved (not "fuzzy", not "none") with no changes needed there.
export function applyMatchOverride(match, candidateId) {
  if (!candidateId) return match;
  const candidate = (match.candidates || []).find((c) => c.id === candidateId);
  if (!candidate) return match;
  return { ...match, tier: "confirmed", match: { id: candidate.id, name: candidate.name, city: candidate.city }, candidates: [] };
}

export function withOverridesApplied(row, overrideForRow) {
  if (!overrideForRow) return row;
  const venueMatch = overrideForRow.venueCandidateId ? applyMatchOverride(row.venueMatch, overrideForRow.venueCandidateId) : row.venueMatch;
  const artistMatch = overrideForRow.artistCandidateId ? applyMatchOverride(row.artistMatch, overrideForRow.artistCandidateId) : row.artistMatch;
  return { ...row, venueMatch, artistMatch };
}

// "Bulk approve matching suggestions": accepts the top-ranked candidate
// (candidates are already sorted desc by similarity_score -- see
// venueMatching.js/artistMatching.js) for every row currently fuzzy on
// venue and/or artist. Returns overrides only -- deliberately never touches
// `selected` itself. Resolving a match doesn't auto-include a row; the
// admin still has to select it (e.g. via "Select all ready" again once it's
// clean), so nothing is ever included as a side effect of a bulk action.
export function applyBulkApproveSuggestions(items) {
  const overrides = {};
  for (const item of items) {
    const entry = {};
    if (item.venueMatch.tier === "fuzzy" && item.venueMatch.candidates.length > 0) {
      entry.venueCandidateId = item.venueMatch.candidates[0].id;
    }
    if (item.artistMatch.tier === "fuzzy" && item.artistMatch.candidates.length > 0) {
      entry.artistCandidateId = item.artistMatch.candidates[0].id;
    }
    if (entry.venueCandidateId || entry.artistCandidateId) overrides[item.id] = entry;
  }
  return overrides;
}

// The 10 batch-summary metrics required by the dashboard. `possibleDuplicates`
// intentionally combines both `possible_duplicate` and `probable_duplicate`
// row states into one rollup: the filter tabs and per-row badges keep the
// two severities fully distinct, but there is only one duplicate-count line
// in the summary.
export function summariseBatch(items, selected) {
  const counts = {
    totalParsed: items.length,
    ready: 0,
    selectedForImport: selected.size,
    needsReview: 0,
    exactDuplicates: 0,
    possibleDuplicates: 0,
    missingArtists: 0,
    missingVenues: 0,
    invalidRows: 0,
    manuallyExcluded: 0,
  };
  for (const item of items) {
    switch (item.rowState) {
      case ROW_STATES.READY:
        counts.ready++;
        break;
      case ROW_STATES.NEEDS_REVIEW:
        counts.needsReview++;
        break;
      case ROW_STATES.EXACT_DUPLICATE:
        counts.exactDuplicates++;
        break;
      case ROW_STATES.POSSIBLE_DUPLICATE:
      case ROW_STATES.PROBABLE_DUPLICATE:
        counts.possibleDuplicates++;
        break;
      case ROW_STATES.MISSING_ARTIST:
        counts.missingArtists++;
        break;
      case ROW_STATES.MISSING_VENUE:
        counts.missingVenues++;
        break;
      case ROW_STATES.INVALID_DATE:
        counts.invalidRows++;
        break;
      default:
        break;
    }
    if (resolveDisplayState(item.rowState, selected.has(item.id)) === EXCLUDED_MANUALLY) counts.manuallyExcluded++;
  }
  return counts;
}

// Grouped (not per-row) reasons for the confirmation step: every unselected
// row's display state, counted and sorted by count descending.
export function groupSkippedReasons(items, selected) {
  const counts = new Map();
  for (const item of items) {
    if (selected.has(item.id)) continue;
    const displayState = resolveDisplayState(item.rowState, false);
    counts.set(displayState, (counts.get(displayState) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([state, count]) => ({ state, label: ROW_STATE_LABELS[state], count }))
    .sort((a, b) => b.count - a.count);
}
