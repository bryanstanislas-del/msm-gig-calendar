// Venue Data Enrichment, Phase 1 -- RESEARCH OUTPUT format.
//
// Defines the canonical JSON shape a future Claude research batch must
// return (see RESEARCH_CONTRACT.md for the full prose contract), and a
// pure, synchronous structural validator for it. This module performs no
// research itself, makes no network/DB call, and inserts nothing --
// validateResearchOutputBatch() only tells a caller whether a candidate
// batch is well-formed enough to even consider staging; the staging
// insert itself is later, separately-scoped work.
//
// Mirrors ENRICHMENT_FIELDS/GENERATED_FIELDS from researchExport.js
// rather than redefining them, so the input and output sides of the
// contract can never silently drift apart.

import { ENRICHMENT_FIELDS, GENERATED_FIELDS, isBlank } from "./researchExport.js";

export { ENRICHMENT_FIELDS, GENERATED_FIELDS };

// Mirrors venue_enrichment_candidates_source_type_check in
// supabase/migrations/20260918120000_venue_enrichment_candidates.sql.
export const SOURCE_TYPES = [
  "official_site", "official_social", "operator_site",
  "ticketing_platform", "press", "other", "generated",
];

// Mirrors venue_enrichment_candidates_confidence_check. Three tiers only
// -- no numeric score (see the migration's own comment on that column).
export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];

// Mirrors venue_enrichment_candidates_status_check. Exposed here so a
// caller mapping a candidate's `outcome` (below) into a DB row's `status`
// has one shared source for the legal values -- NOT because Claude's
// research output itself ever sets `status` directly (it doesn't -- see
// `outcome` below and this file's own header comment).
export const CANDIDATE_STATUSES = [
  "pending", "approved", "rejected", "applied",
  "stale_conflict", "skipped_no_source", "skipped_ambiguous",
];

// The research output's own, simpler three-way result per field -- what
// Claude actually decides, before any admin review state exists. Maps
// 1:1 onto the staging row's initial status (outcomeToInitialStatus()
// below): "found" always starts 'pending' (never anything else -- see
// this module's own header comment: nothing here can produce 'approved'/
// 'applied'/'stale_conflict', which only make sense once a human/apply
// engine has acted).
export const CANDIDATE_OUTCOMES = ["found", "skipped_no_source", "skipped_ambiguous"];

export function outcomeToInitialStatus(outcome) {
  if (outcome === "found") return "pending";
  return outcome; // "skipped_no_source" | "skipped_ambiguous" pass through unchanged
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Structural validation of ONE candidate object against
// RESEARCH_CONTRACT.md's rules. Returns { valid, errors[] } rather than
// throwing -- a batch of candidates commonly contains a mix of good rows
// and ones needing a fix, and the caller (a future review/import step)
// needs to report all of them, not stop at the first.
export function validateCandidate(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") {
    return { valid: false, errors: ["candidate must be an object"] };
  }

  const { field, outcome, suggested_value, source_url, source_type, confidence, notes } = candidate;

  // "field must NOT accept arbitrary venue columns" -- the same allow-list
  // the DB CHECK constraint enforces, checked here too so a malformed
  // batch is caught before it ever reaches a staging insert.
  if (!ENRICHMENT_FIELDS.includes(field)) {
    errors.push(`field "${field}" is not one of the allowed enrichment fields`);
  }

  const resolvedOutcome = outcome || (suggested_value != null ? "found" : undefined);
  if (!CANDIDATE_OUTCOMES.includes(resolvedOutcome)) {
    errors.push(`outcome must be one of ${CANDIDATE_OUTCOMES.join(", ")}`);
  }

  if (resolvedOutcome === "found") {
    // "no source = no factual candidate" -- a "found" outcome always
    // needs a real suggested value.
    if (isBlank(suggested_value)) errors.push('suggested_value is required when outcome is "found"');
    if (confidence && !CONFIDENCE_LEVELS.includes(confidence)) errors.push(`confidence "${confidence}" is not HIGH/MEDIUM/LOW`);
    if (!confidence) errors.push("confidence is required when outcome is \"found\"");

    if (GENERATED_FIELDS.includes(field)) {
      // Generated editorial/SEO text: source_type must say so, and notes
      // must explain which verified facts it came from -- see this file's
      // header comment and RESEARCH_CONTRACT.md. Not semantically
      // verified (SQL/JS can't confirm the prose is honest about its own
      // sourcing) -- only that an explanation is actually present.
      if (source_type !== "generated") errors.push('source_type must be "generated" for a generated editorial/SEO field');
      if (!isNonBlankString(notes)) errors.push("notes must explain which verified factual candidates a generated field was built from");
    } else {
      if (!isNonBlankString(source_url)) errors.push('source_url is required for a factual field when outcome is "found"');
      if (!source_type || !SOURCE_TYPES.includes(source_type) || source_type === "generated") {
        errors.push(`source_type "${source_type}" is not a valid non-generated source for field "${field}"`);
      }
    }
  } else {
    // A skip is a deliberate "nothing to suggest" marker -- carrying a
    // value/source/confidence anyway would misrepresent it as a real
    // candidate (mirrors the DB's own
    // venue_enrichment_candidates_skip_has_no_value CHECK).
    if (suggested_value != null) errors.push(`suggested_value must be null when outcome is "${resolvedOutcome}"`);
  }

  return { valid: errors.length === 0, errors };
}

// PHOTO MUST NEVER BE MARKED SAFE FOR AUTOMATIC APPLICATION, regardless of
// confidence -- and LOW/MEDIUM confidence never auto-applies for any
// field either way (see the Phase 0 audit's own confidence model). This
// is advisory/documentary in Phase 1 (there is no apply engine yet to gate
// -- see this module's header comment), but is real, tested logic a
// future Phase 4 apply engine is expected to reuse rather than
// re-deriving its own version of this rule.
export function requiresManualReview(candidate) {
  if (!candidate) return true;
  if (candidate.field === "photo_url") return true;
  if (candidate.outcome !== "found") return true;
  return candidate.confidence !== "HIGH";
}

// Confirms a research OUTPUT batch never invented, altered, or dropped a
// venue identity relative to the INPUT batch it was given -- "Claude must
// NEVER invent or alter venue UUIDs". Only checks identity preservation;
// per-candidate structural validity is validateCandidate()'s job.
export function validateVenueIdsPreserved(inputBatch, outputBatch) {
  const inputIds = new Set((inputBatch?.venues || []).map((v) => v.venue_id));
  const outputIds = (outputBatch?.venues || []).map((v) => v.venue_id);
  const invented = outputIds.filter((id) => !inputIds.has(id));
  return { valid: invented.length === 0, invented };
}

// Validates a whole research output batch: every venue's every candidate
// must pass validateCandidate(), and every venue_id present must have
// been one this batch actually asked about (validateVenueIdsPreserved()).
// Does not check the batch label itself (`batch`) beyond requiring it be
// present -- batch_id format is deliberately unconstrained, see the
// migration's own "Batch identity" comment.
export function validateResearchOutputBatch(inputBatch, outputBatch) {
  const errors = [];
  if (!isNonBlankString(outputBatch?.batch)) errors.push("batch is required");

  const { valid: idsValid, invented } = validateVenueIdsPreserved(inputBatch, outputBatch);
  if (!idsValid) errors.push(`output referenced venue_id(s) not present in the input batch: ${invented.join(", ")}`);

  for (const venue of outputBatch?.venues || []) {
    if (!venue.venue_id) errors.push("a venue entry is missing venue_id");
    for (const candidate of venue.candidates || []) {
      const { valid, errors: candidateErrors } = validateCandidate(candidate);
      if (!valid) errors.push(`venue ${venue.venue_id}, field ${candidate?.field}: ${candidateErrors.join("; ")}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
