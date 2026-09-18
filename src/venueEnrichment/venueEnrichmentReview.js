// Venue Data Enrichment, Phase 3B -- pure, side-effect-free helpers for the
// READ-ONLY Admin Venue Research review screen (AdminVenueEnrichment.jsx).
//
// Nothing in this module reads or writes Supabase/the DB -- it only shapes
// data the component already fetched (mirrors moderationHelpers.js's own
// "kept out of App.jsx, free of any Supabase/React import" convention, and
// PromoSlot.jsx's "every piece of logic with a real correctness
// requirement is factored into a plain, exported, fully-unit-tested
// function" convention, since this repo still has no jsdom/
// @testing-library/react dependency to render components in tests).
//
// SCOPE: Phase 3B is read-only. There is no function anywhere in this file
// capable of producing an INSERT/UPDATE/DELETE/UPSERT payload for
// venue_enrichment_candidates or public.venues -- see this module's own
// review (Phase 3A architecture audit) for why that boundary matters.

import { ENRICHMENT_FIELDS } from "./researchExport.js";
import { isValidHttpUrl } from "../components/PromoSlot.jsx";
// Independent review (PR #41): imports the neutral src/fetchAllPages.js
// module, NOT App.jsx -- App.jsx itself imports AdminVenueEnrichment.jsx,
// which imports this file, so importing fetchAllPages from App.jsx would
// close a circular dependency (App.jsx -> AdminVenueEnrichment.jsx ->
// venueEnrichmentReview.js -> App.jsx). fetchAllPages was extracted out of
// App.jsx into its own dependency-free module specifically to give this
// file a one-directional import instead.
import { fetchAllPages } from "../fetchAllPages.js";

// Re-exported under its own name here so AdminVenueEnrichment.jsx has one
// single import path for every venue-research helper it needs, rather than
// reaching into components/PromoSlot.jsx directly for one function. This
// IS the "suitable safe URL helper" the project already has (rejects
// anything whose parsed protocol isn't http:/https: -- javascript:, data:,
// and unparsable/malformed strings are all rejected by construction, since
// `new URL(...)` either throws or yields some other protocol for all of
// them). No second implementation is added.
export { isValidHttpUrl };

// The DB's own venue_enrichment_candidates_status_check vocabulary --
// mirrored here (not re-imported from researchFormat.js's
// CANDIDATE_STATUSES) because this module's concern is purely "how does
// each status display", not the write-side rules researchFormat.js exists
// for.
export const SKIPPED_STATUSES = ["skipped_no_source", "skipped_ambiguous"];
export const ALL_STATUSES = [
  "pending", "approved", "rejected", "applied",
  "stale_conflict", "skipped_no_source", "skipped_ambiguous",
];

// Deliberate reviewer-facing order (Phase 3A §21 / the approved audit's own
// recommendation) -- NOT the same order as researchExport.js's
// ENRICHMENT_FIELDS (that constant's order reflects the DB CHECK/JS
// source-of-truth listing, not what's easiest for a human reviewing one
// venue at a time). Kept as its own constant rather than reusing
// ENRICHMENT_FIELDS's order directly; venueEnrichmentReview.test.js
// asserts this is exactly a reordering of ENRICHMENT_FIELDS (same set, no
// field invented or dropped) so the two can never silently drift apart.
export const FIELD_REVIEW_ORDER = [
  "address", "postcode", "website", "phone", "contact_email",
  "facebook", "instagram", "twitter", "capacity", "description",
  "photo_url", "seo_title", "seo_description", "seo_search_phrases",
];

// Safe, human-readable label for every status the DB can hold -- including
// ones the current pilot batch has none of yet (approved/rejected/applied/
// stale_conflict), per Phase 3A/3B's own "must be capable of displaying
// the complete vocabulary" requirement. Falls back to an upper-cased
// echo of an unrecognised status rather than throwing or rendering
// nothing, so an unexpected future status value can never break this
// screen.
export const STATUS_LABELS = {
  pending: "PENDING REVIEW",
  approved: "APPROVED",
  rejected: "REJECTED",
  applied: "APPLIED",
  stale_conflict: "STALE CONFLICT",
  skipped_no_source: "NO RELIABLE SOURCE FOUND",
  skipped_ambiguous: "RESEARCH AMBIGUOUS",
};

export function getStatusLabel(status) {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  return typeof status === "string" && status.trim() ? status.trim().toUpperCase() : "UNKNOWN STATUS";
}

export function isSkippedOutcome(candidate) {
  return SKIPPED_STATUSES.includes(candidate?.status);
}

// A candidate "has a proposed value" iff suggested_value is non-null --
// this is exactly the DB's own venue_enrichment_candidates_skip_has_no_value
// pairing (only skipped_no_source/skipped_ambiguous rows have a null
// suggested_value), checked directly on the data rather than re-deriving
// it from status so this stays correct even for a future status this
// module doesn't otherwise special-case.
export function isProposedCandidate(candidate) {
  return candidate?.suggested_value !== null && candidate?.suggested_value !== undefined;
}

export function isGeneratedCandidate(candidate) {
  return candidate?.source_type === "generated";
}

// Ordered by FIELD_REVIEW_ORDER; any field not in that list (should never
// happen -- the DB CHECK only allows ENRICHMENT_FIELDS, which
// FIELD_REVIEW_ORDER is asserted to fully cover) sorts after every known
// field rather than crashing or disappearing.
export function orderCandidatesByField(candidates) {
  const rank = new Map(FIELD_REVIEW_ORDER.map((field, i) => [field, i]));
  return [...(candidates || [])].sort(
    (a, b) => (rank.has(a?.field) ? rank.get(a.field) : FIELD_REVIEW_ORDER.length) -
              (rank.has(b?.field) ? rank.get(b.field) : FIELD_REVIEW_ORDER.length)
  );
}

// Splits an already-ordered candidate list into "has a real proposed
// value to review" vs "skipped -- informational only" (Phase 3A §K/§L),
// preserving each sub-list's relative field order.
export function splitProposedAndSkipped(candidates) {
  const proposed = [];
  const skipped = [];
  for (const candidate of candidates || []) {
    (isSkippedOutcome(candidate) ? skipped : proposed).push(candidate);
  }
  return { proposed, skipped };
}

function emptyStatusCounts() {
  const counts = {};
  for (const status of ALL_STATUSES) counts[status] = 0;
  return counts;
}

// Shared by both the batch-list and venue-list summaries below -- every
// known status always has a key (0 if absent) so a status this batch
// happens to have none of yet (e.g. 'approved', before any review has
// happened) still renders as an explicit "0", never an absent/undefined
// count.
function summarizeStatuses(rows) {
  const counts = emptyStatusCounts();
  for (const row of rows || []) {
    if (Object.prototype.hasOwnProperty.call(counts, row?.status)) counts[row.status]++;
  }
  return counts;
}

function minMax(values) {
  const present = (values || []).filter(Boolean).slice().sort();
  return { min: present[0] || null, max: present[present.length - 1] || null };
}

// One summary row per distinct batch_id present in `rows` -- the Venue
// Research screen's top-level list (Phase 3A §D level 1). Never hard-codes
// a batch id: whatever distinct batch_id values exist in the fetched rows
// (currently just VENUE-ENRICH-PILOT-001-REV1) produce their own entry.
// Sorted newest-created-first so the most recent research run is always
// the first thing an admin sees.
export function groupCandidatesByBatch(rows) {
  const byBatch = new Map();
  for (const row of rows || []) {
    if (!byBatch.has(row.batch_id)) byBatch.set(row.batch_id, []);
    byBatch.get(row.batch_id).push(row);
  }
  return Array.from(byBatch.entries())
    .map(([batchId, batchRows]) => {
      const retrieved = minMax(batchRows.map((r) => r.retrieved_at));
      const created = minMax(batchRows.map((r) => r.created_at));
      return {
        batch_id: batchId,
        venueCount: new Set(batchRows.map((r) => r.venue_id)).size,
        candidateCount: batchRows.length,
        statusCounts: summarizeStatuses(batchRows),
        earliestRetrievedAt: retrieved.min,
        latestRetrievedAt: retrieved.max,
        earliestCreatedAt: created.min,
        latestCreatedAt: created.max,
      };
    })
    .sort((a, b) => (b.latestCreatedAt || "").localeCompare(a.latestCreatedAt || ""));
}

// One summary row per distinct venue_id WITHIN one batch -- Phase 3A §D
// level 2. `candidates` on each entry is already ordered via
// orderCandidatesByField so the caller never needs to re-sort before
// rendering the venue's own field-candidate cards (level 3).
export function groupCandidatesByVenue(rows, batchId) {
  const filtered = (rows || []).filter((r) => r.batch_id === batchId);
  const byVenue = new Map();
  for (const row of filtered) {
    if (!byVenue.has(row.venue_id)) byVenue.set(row.venue_id, []);
    byVenue.get(row.venue_id).push(row);
  }
  return Array.from(byVenue.entries()).map(([venueId, venueRows]) => ({
    venue_id: venueId,
    candidateCount: venueRows.length,
    statusCounts: summarizeStatuses(venueRows),
    candidates: orderCandidatesByField(venueRows),
  }));
}

// Joins venue-group summaries (candidate-derived, no live DB fields) with
// each venue's own live public.venues row (name/city/claimed/...), keyed
// by id. Kept as a pure function separate from groupCandidatesByVenue
// itself so the grouping logic can be tested with no venue-fetch fixture
// at all, and the join logic can be tested with plain plain-object
// fixtures with no Supabase call involved either.
export function attachVenueInfo(venueGroups, venuesById) {
  return (venueGroups || []).map((group) => ({
    ...group,
    venue: venuesById?.[group.venue_id] || null,
  }));
}

// STALE COMPARISON (Phase 3A §P / Phase 3B §11) -- display-only. Treats
// null, undefined, and blank/whitespace-only strings as the same "not set"
// value (mirrors researchExport.js's own isBlank() normalisation), and
// compares a number against its own string form so a live integer
// (public.venues.capacity) can be compared against this table's text
// existing_value snapshot without a false "stale" purely from type
// difference (e.g. existing_value "100" vs live capacity 100 -- not
// stale).
export function normalizeCompareValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return String(value);
}

// true = the venue's live value has moved on since this candidate's own
// existing_value snapshot was taken, i.e. render the read-only STALE
// warning (Phase 3B §11). This performs no write of any kind and never
// touches candidate.status -- see this module's own header comment.
export function isStaleCandidate(existingValue, liveValue) {
  return normalizeCompareValue(existingValue) !== normalizeCompareValue(liveValue);
}

// Defensive, test-asserted invariant: FIELD_REVIEW_ORDER must be exactly a
// reordering of ENRICHMENT_FIELDS (Phase 1's own field allow-list) -- same
// set, nothing added or dropped -- so this module's review order can never
// silently omit a real enrichment field or invent one the DB CHECK
// constraint wouldn't allow. Exported so venueEnrichmentReview.test.js can
// assert it directly against the Phase 1 source of truth without
// duplicating ENRICHMENT_FIELDS's own contents.
export function fieldReviewOrderMatchesEnrichmentFields() {
  const a = [...FIELD_REVIEW_ORDER].sort();
  const b = [...ENRICHMENT_FIELDS].sort();
  return a.length === b.length && a.every((field, i) => field === b[i]);
}

// CORRECTION (independent review, PR #41): the original AdminVenueEnrichment
// mount effect called `supabase.from('venue_enrichment_candidates').select('*')`
// directly with no pagination -- Supabase/PostgREST silently truncates any
// unbounded select at its project-level max-rows ceiling (App.jsx's own
// fetchAllPages() header comment: "Supabase's own default is 1000"), the
// exact bug class DB.getAllGigs()/getApprovedGigs()/getVenues() in App.jsx
// were already fixed for (see dbPagination.test.js). Reuses that same,
// already-reviewed fetchAllPages() mechanism rather than a second
// pagination implementation. `id` is a stable, always-unique sort key, so
// no page can duplicate or skip a row regardless of how many candidate
// rows exist across however many research batches. Takes the Supabase
// client as a parameter (rather than importing the app's singleton
// directly) so this stays testable with a plain fake client object --
// see venueEnrichmentReview.test.js.
export function fetchAllCandidates(supabaseClient) {
  return fetchAllPages((from, to) =>
    supabaseClient.from("venue_enrichment_candidates").select("*")
      .order("id", { ascending: true })
      .range(from, to)
  );
}
