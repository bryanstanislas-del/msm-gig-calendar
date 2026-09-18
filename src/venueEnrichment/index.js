// Venue Data Enrichment, Phase 1: public entry point. Anything outside
// src/venueEnrichment/ should import from here, not reach into the
// individual internal modules directly -- same convention as
// smartImport/index.js and venueSearch's own barrel.
//
// Phase 1 scope only: RESEARCH INPUT export + RESEARCH OUTPUT format/
// validation. No database read/write of any kind happens in this module
// or anything it re-exports -- see researchExport.js's and
// researchFormat.js's own header comments.

export {
  ENRICHMENT_FIELDS,
  GENERATED_FIELDS,
  isBlank,
  isCapacityMissing,
  isFieldMissing,
  getMissingFields,
  hasMissingFields,
  buildVenueResearchInput,
  buildResearchInputBatch,
} from "./researchExport.js";

export {
  SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  CANDIDATE_STATUSES,
  CANDIDATE_OUTCOMES,
  outcomeToInitialStatus,
  validateCandidate,
  requiresManualReview,
  validateVenueIdsPreserved,
  validateResearchOutputBatch,
} from "./researchFormat.js";
