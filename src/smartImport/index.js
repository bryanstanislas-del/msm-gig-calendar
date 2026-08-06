// Sprint 5A: public entry point for the Smart Import parsing engine.
// Anything outside src/smartImport/ (App.jsx, and later the 5B/5C
// matching/import UI) should import from here, not reach into the
// individual internal modules directly -- that keeps the internal split
// between parser/sourceProfiles/csvTsv/furniture/confidence free to change
// without touching call sites.

export { parseImportText } from "./parser.js";
export { PROFILES } from "./sourceProfiles.js";
export { STATUS_THRESHOLDS } from "./confidence.js";

// Sprint 5B: matching + duplicate detection + in-memory review-batch
// orchestration. Still no database writes anywhere below this line -- see
// runMatching.js's header comment.
export { classifyVenueMatch, deriveVenueQuery } from "./venueMatching.js";
export { classifyArtistMatch, deriveArtistQuery, ARTIST_PROFILE_TYPES } from "./artistMatching.js";
export { detectDuplicates, DUPLICATE_TIERS } from "./duplicateDetection.js";
export { runMatching } from "./runMatching.js";

// Sprint 5B.5: the 12-state row model and the Import Review Dashboard's
// selection/override/summary logic. No database writes here either -- see
// batchSelection.js's header comment.
export {
  ROW_STATES,
  ROW_STATE_LABELS,
  EXCLUDED_MANUALLY,
  DUPLICATE_STATES,
  ERROR_STATES,
  DEFAULT_INCLUDED_STATES,
  LOCKED_STATES,
  isLocked,
  deriveRowState,
  resolveDisplayState,
  explainRowState,
} from "./reviewBatch.js";
export {
  computeDefaultSelection,
  selectAllReady,
  excludeAllErrors,
  excludeAllDuplicates,
  excludeVisibleSelected,
  applyMatchOverride,
  withOverridesApplied,
  applyBulkApproveSuggestions,
  summariseBatch,
  groupSkippedReasons,
} from "./batchSelection.js";
