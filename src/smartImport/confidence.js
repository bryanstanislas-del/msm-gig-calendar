// Sprint 5A: deterministic, rule-based confidence scoring for parsed event
// rows. Every score here comes from an explicit, named rule below -- there
// is no statistical model or learned weighting anywhere in this file, and
// none should be added without renaming this doc comment.
//
// Two levels:
//   - field-level scores (0-1), one per extracted field, assigned by the
//     extractor that produced the field (see sourceProfiles.js) via the
//     DATE_CONFIDENCE / TEXT_FIELD_CONFIDENCE constants below
//   - a row-level `overall` score, a weighted average of the field scores,
//     used only to decide `status` (see deriveRowStatus)

// -- Field-level score constants -------------------------------------
// date: how the day/month/year were actually established
export const DATE_CONFIDENCE = {
  EXPLICIT: 1.0,        // day+month+year all present in the source text
  INFERRED_YEAR: 0.8,   // day+month present, year inferred (next-occurrence heuristic)
  CONTEXT_YEAR: 0.8,    // day+month present, year taken from a section heading e.g. "June 2026"
  DAY_NAME_ONLY: 0.3,   // "Saturday" resolved to the next occurrence -- genuinely ambiguous
  UNPARSEABLE: 0.0,
};

// venueName / city / artistName share the same three-tier shape
export const TEXT_FIELD_CONFIDENCE = {
  EXPLICIT: 1.0,     // unambiguous, direct extraction
  INFERRED: 0.5,     // derived from page-level/context default or a "current subject" heading
  AMBIGUOUS: 0.6,    // extracted, but the source line required a best-guess split
  MISSING: 0.0,
};

// -- Row-level rollup --------------------------------------------------
// time is excluded: it always resolves via the caller-supplied default
// time (same fallback BulkImport uses today), so a missing time is a
// deliberate default, not a guessed value, and isn't a confidence concern.
const FIELD_WEIGHTS = { date: 0.35, venueName: 0.30, artistName: 0.25, city: 0.10 };

// A field score of `null`/`undefined` means "this extraction path never
// attempts this field" (e.g. the generic-dash-list profile is single-line
// and never carries a per-row artist name -- the artist is supplied once
// for the whole batch, same as today's BulkImport) and is excluded from
// the weighted average entirely. A field score of `0` means "attempted and
// failed" (e.g. a CSV row with a genuinely blank artist column) and counts
// against the row as normal. Conflating the two would wrongly tank every
// generic-dash-list row's confidence for a field it was never trying to
// produce in the first place.
export function computeOverallConfidence(fieldConfidence) {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const score = fieldConfidence[field];
    if (score === null || score === undefined) continue;
    weightedSum += score * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return 0;
  return Math.round((weightedSum / weightTotal) * 1000) / 1000;
}

// -- Row status ----------------------------------------------------------
// Thresholds live here, as named constants, specifically so they can be
// tuned later against real fixture results without touching any parsing
// or extraction logic.
export const STATUS_THRESHOLDS = {
  MIN_OVERALL_FOR_OK: 0.75,
  MIN_FIELD_FOR_OK: 0.6, // applied to date/venueName/artistName individually
};

export function deriveRowStatus({ fields, fieldConfidence, issues }) {
  const dateMissing = !fields.date;
  const venueMissing = !fields.venueName;
  if (dateMissing && venueMissing) return "unparseable";

  const overall = computeOverallConfidence(fieldConfidence);
  const hardFieldsOk = ["date", "venueName", "artistName"].every((f) => {
    const score = fieldConfidence[f];
    return score === null || score === undefined || score >= STATUS_THRESHOLDS.MIN_FIELD_FOR_OK;
  });

  if (overall < STATUS_THRESHOLDS.MIN_OVERALL_FOR_OK || !hardFieldsOk || (issues && issues.length > 0)) {
    return "needs_review";
  }
  return "ok";
}

// Shared by every extraction path (generic-dash-list in sourceProfiles.js,
// delimited-record extraction in parser.js) so "compute overall confidence,
// then derive status" is defined exactly once rather than re-implemented
// per profile/format.
export function assembleEventRow({ raw, fields, fieldConfidence, issues }) {
  return {
    id: undefined, // assigned once the row's position in the batch is known (see parser.js)
    raw,
    fields,
    confidence: { overall: computeOverallConfidence(fieldConfidence), field: fieldConfidence },
    issues,
    status: deriveRowStatus({ fields, fieldConfidence, issues }),
  };
}
