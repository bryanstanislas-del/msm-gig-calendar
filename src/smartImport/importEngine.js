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
import { isLocked, ROW_STATE_LABELS, DUPLICATE_STATES } from "./reviewBatch.js";
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

// Snapshot of exactly what the admin's review decided for this row, kept
// alongside the raw text in import_run_items -- without this, a FAILED
// row's audit trail is just "raw text + error", with no record of what was
// actually about to be written or which match/duplicate call the admin
// made. A CREATED row's parsed fields are also implicitly the resulting
// gigs row, but a failed row has no gigs row to look at, so this is the
// only place that data survives.
function buildMatchDecisions(item) {
  return {
    rowState: item.rowState,
    venue: {
      tier: item.venueMatch.tier,
      query: item.venueMatch.query,
      matchedVenueId: item.venueMatch.match?.id ?? null,
      matchedVenueName: item.venueMatch.match?.name ?? null,
    },
    artist: {
      tier: item.artistMatch.tier,
      query: item.artistMatch.query,
      matchedArtistId: item.artistMatch.match?.id ?? null,
      matchedArtistName: item.artistMatch.match?.name ?? null,
    },
    duplicate: {
      tier: item.duplicate.tier,
      // Only meaningful for the two "resembles something" tiers -- any row
      // reaching this function already passed validateRowForImport, so a
      // near-duplicate tier here can only mean the admin explicitly
      // overrode the review dashboard's default-excluded warning.
      includedDespiteWarning: item.duplicate.tier === "near_existing" || item.duplicate.tier === "near_in_batch",
    },
  };
}

// Maps one resolved dashboard row to import_gig_row's RPC parameters.
// time/genre are passed through as-is, including null/empty -- the RPC
// itself coalesces empty time to its DB default ('Time TBC'). genre has no
// such fallback: a missing or unrecognised genre (see parser.js's
// normalizeGenre) stays null all the way into gigs.genre, which is
// nullable with no default -- an unclassified gig must never be silently
// mislabeled with a specific genre.
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
    parsed_fields: item.fields,
    match_decisions: buildMatchDecisions(item),
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

// Pure aggregation of one completed import run into exactly the fields the
// moderation batch email needs (see api/notify.js's "gig_import_batch"
// type) -- one email per completed batch, never one per row, and only
// meaningful when created > 0 (the caller's own gate: a batch that was
// entirely duplicates/invalid/failed sends nothing). `groups` is
// batchSelection.js's groupSkippedReasons(items, selected) output -- every
// row the admin's selection itself excluded, already grouped by state;
// `blocked` (from runImport) is the separate, smaller set of *selected*
// rows the RPC layer would still have rejected (e.g. a New Venue row with
// no known city). Kept here, not inline in App.jsx's ConfirmationSummary,
// so this aggregation is testable the same way as the rest of Smart Import
// -- App.jsx has no test coverage of its own (see importEngine.js's header
// comment on why this module exists at all).
export function buildModerationNotificationPayload({ results, groups, blocked }) {
  const created = results.filter((r) => r.outcome === "created");
  const venues = [...new Set(created.map((r) => r.item.fields.venueName).filter(Boolean))];
  const duplicatesSkipped = groups
    .filter((g) => DUPLICATE_STATES.includes(g.state))
    .reduce((sum, g) => sum + g.count, 0);
  const otherExcluded =
    groups.filter((g) => !DUPLICATE_STATES.includes(g.state)).reduce((sum, g) => sum + g.count, 0) + blocked.length;
  return { created: created.length, venues, duplicatesSkipped, otherExcluded };
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
