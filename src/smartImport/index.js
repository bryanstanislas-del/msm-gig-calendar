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
export { deriveReviewStatus, REVIEW_STATUSES, REVIEW_STATUS_LABELS } from "./reviewBatch.js";
export { runMatching } from "./runMatching.js";
