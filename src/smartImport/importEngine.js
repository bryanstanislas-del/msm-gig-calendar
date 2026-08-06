// Sprint 5C: the safe import engine -- turns an admin's final, approved row
// selection from ImportReviewDashboard into real database writes. Pure and
// dependency-injected, mirroring runMatching.js's shape: the actual
// Supabase/RPC calls are passed in as functions (startRunFn/importRowFn/
// completeRunFn), so this stays testable with fakes the same way the rest
// of Smart Import is (see importEngine.test.js). No supabase import
// anywhere in this file.
//
// Rows are expected to be the final, resolved dashboard items -- the same
// shape runMatching.js/reviewBatch.js/batchSelection.js already produce and
// test: { id, raw, fields, status, venueMatch, artistMatch, duplicate,
// rowState }, with venueMatch/artistMatch possibly at tier "confirmed" if
// the admin accepted a fuzzy candidate (see batchSelection.js's
// applyMatchOverride).
import { isLocked, ROW_STATE_LABELS } from "./reviewBatch.js";
import { mapWithConcurrency } from "./concurrency.js";

// import_gig_row RPC calls are independent per-row transactions (see the
// migration's own comment for why: a single giant server-side loop risks
// the project's 2-minute statement_timeout and turns one dropped connection
// into a lost whole batch). Concurrency is capped for the same reason
// runMatching.js caps its own search_entities calls -- real throughput
// without opening hundreds of simultaneous connections.
const IMPORT_CONCURRENCY = 5;

// Defense in depth: ImportReviewDashboard already filters to `selected`
// (which can never include a LOCKED_STATES row -- its checkbox is disabled)
// before anything reaches this module. This re-checks independently by
// calling the same, already-tested isLocked()/rowState rather than
// reimplementing the rule, so the two can never drift apart. Returns null
// when the row is safe to import, or a human-readable reason it's blocked.
export function validateRowForImport(item) {
  if (isLocked(item.rowState)) {
    return `${ROW_STATE_LABELS[item.rowState]} rows cannot be imported.`;
  }
  // "New Venue" rows (tier "none") with no known city would hit
  // venues.city's NOT NULL constraint inside the gig_auto_venue trigger --
  // caught proactively here rather than left to fail mid-run, so
  // ConfirmationSummary can show this as its own labelled reason before
  // the admin ever clicks import.
  if (item.venueMatch.tier === "none" && !item.venueMatch.city) {
    return "New venue has no known city -- cannot be created without one.";
  }
  return null;
}

// Resolves the venue/city text actually written to gigs.venue/gigs.city.
// For an exact or admin-confirmed match, this is the MATCHED venue's own
// canonical name/city -- never the raw parsed text -- so the
// gig_auto_venue trigger's own naive exact-normalised-text match resolves
// to that same venue row instead of creating a duplicate (venues
// .name_normalised's generation expression is identical to the trigger's
// own normalisation, so this is guaranteed to round-trip correctly, not
// just a best effort). For "New Venue" rows (tier "none"), the raw parsed
// name/city is written and the trigger creates the venue fresh -- the same
// mechanism BulkImport already implicitly relies on today.
function resolveVenueFields(venueMatch) {
  if (venueMatch.tier === "exact" || venueMatch.tier === "confirmed") {
    return { venue: venueMatch.match.name, city: venueMatch.match.city };
  }
  return { venue: venueMatch.query, city: venueMatch.city };
}

// Maps one resolved dashboard row to import_gig_row's RPC parameters.
// time/genre are passed through as-is, including null/empty -- the RPC
// itself coalesces those to their DB defaults ('Time TBC'/'Indie Rock'),
// so that default logic exists in exactly one place, not duplicated here.
// band_profile_id is only ever set for exact/confirmed artist matches --
// "Missing Artist" rows always import as free text with no profile link
// (confirmed decision: Sprint 5C never auto-creates artist profiles, only
// venues, since only venues have an existing, already-proven auto-create
// trigger to build on).
export function buildGigInsertPayload(item) {
  const { venue, city } = resolveVenueFields(item.venueMatch);
  const bandProfileId =
    item.artistMatch.tier === "exact" || item.artistMatch.tier === "confirmed" ? item.artistMatch.match.id : null;

  return {
    band_name: item.fields.artistName,
    venue,
    city,
    date: item.fields.date,
    time: item.fields.time,
    genre: item.fields.genre,
    notes: item.fields.notes,
    tickets: item.fields.ticketUrl,
    band_profile_id: bandProfileId,
    raw_text: item.raw,
  };
}

function groupReasons(reasons) {
  const counts = new Map();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) || 0) + 1);
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

// Pure aggregation of an import run's outcome into the counts/grouped
// reasons the results panel shows -- same shape/spirit as
// batchSelection.js's summariseBatch/groupSkippedReasons, for UI
// consistency between the review stage and the import-results stage.
export function summariseImportResult({ results, blocked }) {
  const created = results.filter((r) => r.outcome === "created").length;
  const failed = results.filter((r) => r.outcome !== "created").length;
  return {
    totalAttempted: results.length + blocked.length,
    created,
    failed,
    blocked: blocked.length,
    failureReasons: groupReasons(results.filter((r) => r.outcome !== "created").map((r) => r.error || "Unknown error")),
    blockedReasons: groupReasons(blocked.map((b) => b.reason)),
  };
}

// startRunFn({ sourceProfileId, totalRows }) -> Promise<importRunId>
// importRowFn({ importRunId, ...buildGigInsertPayload() fields }) -> Promise<{ outcome: "created"|"failed", gig_id: string|null }>
// completeRunFn({ importRunId, succeeded, failed }) -> Promise<void>
//
// One bad row must never block the rest of the batch: import_gig_row's own
// nested exception handling covers DB-level failures (constraint
// violations, the unique_violation venue race), but a network-level
// failure calling the RPC at all (a dropped connection, a timeout) would
// otherwise reject inside mapWithConcurrency and abort every row still in
// flight or queued. The try/catch here is what actually guarantees row
// independence at the JS layer, not just the SQL layer.
export async function runImport(rows, { startRunFn, importRowFn, completeRunFn, sourceProfileId = null, concurrency = IMPORT_CONCURRENCY } = {}) {
  const importable = [];
  const blocked = [];
  for (const item of rows) {
    const reason = validateRowForImport(item);
    if (reason) blocked.push({ item, reason });
    else importable.push(item);
  }

  const importRunId = await startRunFn({ sourceProfileId, totalRows: importable.length });

  const results = await mapWithConcurrency(importable, concurrency, async (item) => {
    try {
      const payload = buildGigInsertPayload(item);
      const outcome = await importRowFn({ importRunId, ...payload });
      return { item, outcome: outcome.outcome, gigId: outcome.gig_id ?? null, error: null };
    } catch (e) {
      return { item, outcome: "failed", gigId: null, error: e.message || String(e) };
    }
  });

  const succeeded = results.filter((r) => r.outcome === "created").length;
  const failed = results.filter((r) => r.outcome !== "created").length;

  await completeRunFn({ importRunId, succeeded, failed });

  return { importRunId, results, blocked };
}
