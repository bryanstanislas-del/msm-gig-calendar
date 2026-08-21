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
  deriveSelection,
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

// Sprint 5C: the safe import engine. This is the one place database writes
// finally happen -- exclusively through the four SECURITY DEFINER RPCs this
// module calls via injected functions (startRunFn/importRowFn/
// completeRunFn), never a direct supabase.from(...).insert(). See
// importEngine.js's header comment.
export { validateRowForImport, buildGigInsertPayload, runImport, summariseImportResult, buildModerationNotificationPayload } from "./importEngine.js";
export { mapWithConcurrency } from "./concurrency.js";

// Sprint 5D: grouped entity resolution. Groups rows sharing the same source
// venue/artist text (or the same duplicate cluster) into one decision
// instead of many -- still no database writes anywhere below this line,
// same as everything above. See resolutionGroupUtils.js's and
// groupResolution.js's header comments.
export { GROUP_SAMPLE_SIZE, buildGroupId, sortGroups, indexRowsByGroup } from "./resolutionGroupUtils.js";
export { groupMissingVenues, groupFuzzyVenues, VENUE_MISSING_ACTIONS, VENUE_FUZZY_ACTIONS } from "./venueResolutionGroups.js";
export { groupMissingArtists, groupFuzzyArtists, ARTIST_MISSING_ACTIONS, ARTIST_FUZZY_ACTIONS } from "./artistResolutionGroups.js";
export {
  groupDuplicateClusters,
  DUPLICATE_CLUSTER_ACTIONS,
  LOCKED_DUPLICATE_TIERS,
} from "./duplicateResolutionGroups.js";
export { applyGroupDecisionToRow, composeResolvedRow } from "./groupResolution.js";
