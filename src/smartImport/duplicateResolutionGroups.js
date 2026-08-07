// Sprint 5D: groups rows into duplicate clusters -- one decision per
// "these rows represent the same incoming/existing event relationship"
// instead of one per row. duplicateDetection.js already classifies each
// row's tier and, for in-batch tiers, records *pairwise* links via
// `withRowIds` -- but a 3+-row mutual cluster can have row A linked only to
// B while B links to both A and C, so this module runs a connected-
// components pass over those edges to find the FULL cluster regardless of
// how the pairwise links happened to be recorded. For "*_existing" tiers,
// multiple rows can already share the same `existingGigId`; this module is
// what actually aggregates them into one group (duplicateDetection.js's own
// per-row Map doesn't pre-aggregate that).
//
// This aggregation deliberately lives in its own module rather than inside
// duplicateDetection.js: that module owns a narrow, already-tested per-row
// tier-classification API that every other Sprint 5B/5B.5 module depends on
// unchanged -- cross-row clustering for display is a different, additive
// concern.
import { buildGroupId, sortGroups, GROUP_SAMPLE_SIZE } from "./resolutionGroupUtils.js";

export const DUPLICATE_CLUSTER_ACTIONS = {
  SKIP_EXISTING: "skip_existing",
  IMPORT_ANYWAY: "import_anyway",
  LEAVE_FOR_MANUAL_REVIEW: "leave_for_manual_review",
};

// Exact-tier clusters are informational only -- see groupResolution.js and
// the DuplicateClusterGroupPanel UI, neither of which offers any action for
// these tiers. Kept as a named export so both layers reference the same
// single source of truth instead of hand-checking tier strings separately.
export const LOCKED_DUPLICATE_TIERS = ["exact_in_batch", "exact_existing"];

function summariseGig(gig) {
  if (!gig) return null;
  return { id: gig.id, band_name: gig.band_name, venue: gig.venue, city: gig.city, date: gig.date };
}

// Connected components over the withRowIds pairwise-link graph, scoped to
// one tier at a time. duplicateDetection.js never links rows of different
// in-batch tiers to each other (a row is either exact_in_batch or
// near_in_batch, never both, and its own links only ever point at rows that
// share that same tier) -- but this function still filters neighbours to
// `relevantIds` defensively, so a future change to duplicateDetection.js
// that violated that invariant would fail loudly (an orphaned/missing
// neighbour is simply ignored) rather than silently merging tiers.
function groupInBatchByTier(rows, tier) {
  const relevant = rows.filter((r) => r.duplicate.tier === tier);
  const rowsById = new Map(relevant.map((r) => [r.id, r]));
  const visited = new Set();
  const groups = [];

  for (const row of relevant) {
    if (visited.has(row.id)) continue;
    const componentIds = new Set();
    const stack = [row.id];
    visited.add(row.id);
    while (stack.length > 0) {
      const id = stack.pop();
      componentIds.add(id);
      const current = rowsById.get(id);
      for (const neighbourId of current.duplicate.withRowIds) {
        if (!rowsById.has(neighbourId) || visited.has(neighbourId)) continue;
        visited.add(neighbourId);
        stack.push(neighbourId);
      }
    }
    // Preserve original batch order for display, but the group id is built
    // from a separately-sorted copy so the id itself never depends on scan
    // order (only on which rows are members).
    const rowIds = relevant.filter((r) => componentIds.has(r.id)).map((r) => r.id);
    const sortedMemberIds = [...rowIds].sort();
    groups.push({
      id: buildGroupId("in_batch", `${tier}:${sortedMemberIds.join(",")}`),
      kind: "duplicate_cluster",
      tier,
      rowIds,
      sampleRowIds: rowIds.slice(0, GROUP_SAMPLE_SIZE),
      existingGigId: null,
      existingGigSummary: null,
    });
  }
  return groups;
}

function groupExistingByTier(rows, tier, existingGigsById) {
  const byGigId = new Map();
  for (const row of rows) {
    if (row.duplicate.tier !== tier || !row.duplicate.existingGigId) continue;
    const gigId = row.duplicate.existingGigId;
    let entry = byGigId.get(gigId);
    if (!entry) {
      entry = {
        id: buildGroupId("existing", `${tier}:${gigId}`),
        kind: "duplicate_cluster",
        tier,
        rowIds: [],
        existingGigId: gigId,
        existingGigSummary: summariseGig(existingGigsById.get(gigId)),
      };
      byGigId.set(gigId, entry);
    }
    entry.rowIds.push(row.id);
  }
  return [...byGigId.values()].map((g) => ({ ...g, sampleRowIds: g.rowIds.slice(0, GROUP_SAMPLE_SIZE) }));
}

export function groupDuplicateClusters(rows, { existingGigs = [] } = {}) {
  const existingGigsById = new Map(existingGigs.map((g) => [g.id, g]));
  const groups = [
    ...groupInBatchByTier(rows, "exact_in_batch"),
    ...groupInBatchByTier(rows, "near_in_batch"),
    ...groupExistingByTier(rows, "exact_existing", existingGigsById),
    ...groupExistingByTier(rows, "near_existing", existingGigsById),
  ];
  return sortGroups(groups);
}
