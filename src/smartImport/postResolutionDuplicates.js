// Phase 2F: the post-resolution duplicate recheck. Sprint 5B's own
// detectDuplicates() runs exactly once, inside runMatching(), before any
// human/group venue or artist resolution has happened -- correct and still
// useful for immediately-known exact identities and initial review UX
// (unchanged, not removed), but it means a row that starts "fuzzy" and is
// later human-CONFIRMED to a real venue/artist never gets its duplicate
// status re-evaluated with that confirmed identity (see this phase's own
// audit for the full architecture trace of why).
//
// This module is the smallest safe fix: a second, purely downstream
// detectDuplicates() pass over the fully resolved rows (App.jsx's
// resolvedBatch, after every group/row decision has already been
// composed), producing a final, authoritative duplicate/rowState for
// import gating -- WITHOUT ever feeding back into the entity-resolution
// grouping itself. Circularity is avoided structurally: this function
// takes already-resolved rows and returns a new array; it is never an
// input to venueMissingGroups/venueFuzzyGroups/duplicateGroups (all of
// which stay based on the original, stable `batch`, exactly as before
// Phase 2F) or to groupDecisions/overrides lookups. See App.jsx's own
// wiring comment at its call site for the full picture.
import { detectDuplicates, DUPLICATE_TIERS } from "./duplicateDetection.js";
import { deriveRowState } from "./reviewBatch.js";

// Ascending = more severe. Mirrors this module's own tier precedence
// (exact_existing wins over exact_in_batch, which wins over either near
// tier, which wins over none) -- the same ordering detectDuplicates()
// itself already applies via its own execution order.
const TIER_SEVERITY = {
  [DUPLICATE_TIERS.NONE]: 0,
  [DUPLICATE_TIERS.NEAR_IN_BATCH]: 1,
  [DUPLICATE_TIERS.NEAR_EXISTING]: 2,
  [DUPLICATE_TIERS.EXACT_IN_BATCH]: 3,
  [DUPLICATE_TIERS.EXACT_EXISTING]: 4,
};

const NONE_DUPLICATE = { tier: DUPLICATE_TIERS.NONE, withRowIds: [], existingGigId: null };

// A freshly recomputed EXACT finding always wins outright, regardless of
// any prior override an admin already applied (an exact duplicate must
// never be silently reachable just because a *different*, earlier
// near-tier warning on the same row was previously dismissed -- "exact
// duplicate locking always wins", see this phase's own spec). Below
// exact, the more severe of the prior (already correctly reflecting any
// IMPORT_ANYWAY override -- see groupResolution.js's
// applyDuplicateGroupDecision/applyDuplicateRowOverride, both unchanged
// by this module) and freshly recomputed tier is kept -- this never
// silently clears a warning the admin hasn't acted on, and lets a
// genuinely NEW near-tier relationship (only discoverable once resolved
// identity makes the same-venue/same-artist gate match at all) surface
// normally, using the exact same IMPORT_ANYWAY mechanism as any other
// warning. A known, accepted trade-off (see this phase's report): an
// admin's earlier override of a near-tier warning could be resurfaced if
// the identical relationship is independently rediscovered here -- safe
// (never silently imports something newly exact, never blocks something
// already clear), only ever a redundant re-prompt.
function moreSevere(freshDuplicate, priorDuplicate) {
  return TIER_SEVERITY[freshDuplicate.tier] >= TIER_SEVERITY[priorDuplicate.tier] ? freshDuplicate : priorDuplicate;
}

// resolvedRows: App.jsx's resolvedBatch -- each row's venueMatch/
// artistMatch/duplicate already reflect every group decision and row
// override applied so far (see groupResolution.js's composeResolvedRow).
// existingGigs: the same snapshot runReview() already fetched once (see
// this phase's own report on why refreshing it is a separate, orthogonal,
// not-yet-fixed concern from the one this module addresses).
//
// Returns a new array, same shape as resolvedRows, with `duplicate` and
// `rowState` replaced by their final, authoritative values. Every other
// field (venueMatch, artistMatch, fields, raw, status, ...) passes
// through unchanged.
export function applyDuplicateResults(resolvedRows, { existingGigs = [] } = {}) {
  const fresh = detectDuplicates(resolvedRows, { existingGigs });
  return resolvedRows.map((row) => {
    const freshDuplicate = fresh.get(row.id) || NONE_DUPLICATE;
    const priorDuplicate = row.duplicate || NONE_DUPLICATE;
    const duplicate = moreSevere(freshDuplicate, priorDuplicate);
    const rowState = deriveRowState({
      parserStatus: row.status,
      fields: row.fields,
      duplicate,
      venueMatch: row.venueMatch,
      artistMatch: row.artistMatch,
    });
    return { ...row, duplicate, rowState };
  });
}
