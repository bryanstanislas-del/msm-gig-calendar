import { describe, it, expect } from "vitest";
import { groupDuplicateClusters, DUPLICATE_CLUSTER_ACTIONS, LOCKED_DUPLICATE_TIERS } from "./duplicateResolutionGroups.js";

function row(id, tier, withRowIds = [], existingGigId = null) {
  return { id, duplicate: { tier, withRowIds, existingGigId } };
}

describe("groupDuplicateClusters -- in-batch tiers", () => {
  it("groups two pairwise-linked exact_in_batch rows into one cluster", () => {
    const rows = [row("r1", "exact_in_batch", ["r2"]), row("r2", "exact_in_batch", ["r1"])];
    const groups = groupDuplicateClusters(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds.sort()).toEqual(["r1", "r2"]);
    expect(groups[0].tier).toBe("exact_in_batch");
  });

  it("unions a 3-row mutual cluster from only pairwise links via connected components", () => {
    // A links only to B; B links to both A and C; C links only to B --
    // A and C are not directly linked, but must still land in one group.
    const rows = [
      row("A", "near_in_batch", ["B"]),
      row("B", "near_in_batch", ["A", "C"]),
      row("C", "near_in_batch", ["B"]),
    ];
    const groups = groupDuplicateClusters(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds.sort()).toEqual(["A", "B", "C"]);
  });

  it("keeps exact_in_batch and near_in_batch rows in separate clusters even if unrelated", () => {
    const rows = [
      row("r1", "exact_in_batch", ["r2"]),
      row("r2", "exact_in_batch", ["r1"]),
      row("r3", "near_in_batch", ["r4"]),
      row("r4", "near_in_batch", ["r3"]),
    ];
    const groups = groupDuplicateClusters(rows);
    expect(groups).toHaveLength(2);
    const tiers = groups.map((g) => g.tier).sort();
    expect(tiers).toEqual(["exact_in_batch", "near_in_batch"]);
  });

  it("produces separate single-row clusters for two independent pairs", () => {
    const rows = [
      row("r1", "exact_in_batch", ["r2"]),
      row("r2", "exact_in_batch", ["r1"]),
      row("r3", "exact_in_batch", ["r4"]),
      row("r4", "exact_in_batch", ["r3"]),
    ];
    const groups = groupDuplicateClusters(rows);
    expect(groups).toHaveLength(2);
  });

  it("excludes rows with tier 'none'", () => {
    const rows = [row("r1", "none")];
    expect(groupDuplicateClusters(rows)).toEqual([]);
  });
});

describe("groupDuplicateClusters -- existing-gig tiers", () => {
  const existingGigs = [{ id: "g1", band_name: "The Mafia", venue: "The Brook", city: "Southampton", date: "2026-09-01" }];

  it("groups multiple rows sharing the same existingGigId into one cluster", () => {
    const rows = [
      row("r1", "exact_existing", [], "g1"),
      row("r2", "exact_existing", [], "g1"),
    ];
    const groups = groupDuplicateClusters(rows, { existingGigs });
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds.sort()).toEqual(["r1", "r2"]);
    expect(groups[0].existingGigSummary).toEqual({
      id: "g1", band_name: "The Mafia", venue: "The Brook", city: "Southampton", date: "2026-09-01",
    });
  });

  it("never merges exact_existing and near_existing rows sharing the same existingGigId -- tier is part of the key", () => {
    const rows = [
      row("r1", "exact_existing", [], "g1"),
      row("r2", "near_existing", [], "g1"),
    ];
    const groups = groupDuplicateClusters(rows, { existingGigs });
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.tier).sort()).toEqual(["exact_existing", "near_existing"]);
  });

  it("has a null existingGigSummary if the gig id isn't found in existingGigs (defensive)", () => {
    const rows = [row("r1", "exact_existing", [], "missing-gig")];
    const groups = groupDuplicateClusters(rows, { existingGigs });
    expect(groups[0].existingGigSummary).toBeNull();
  });
});

describe("caps and ordering", () => {
  it("caps sampleRowIds while keeping every rowId", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, "exact_existing", [], "g1"));
    const group = groupDuplicateClusters(rows, { existingGigs: [{ id: "g1" }] })[0];
    expect(group.rowIds).toHaveLength(10);
    expect(group.sampleRowIds).toHaveLength(5);
  });

  it("produces the same group id regardless of input row order", () => {
    const rowsA = [row("r1", "exact_in_batch", ["r2"]), row("r2", "exact_in_batch", ["r1"])];
    const rowsB = [row("r2", "exact_in_batch", ["r1"]), row("r1", "exact_in_batch", ["r2"])];
    expect(groupDuplicateClusters(rowsA)[0].id).toBe(groupDuplicateClusters(rowsB)[0].id);
  });
});

describe("action set and locked tiers", () => {
  it("has a stable action set", () => {
    expect(DUPLICATE_CLUSTER_ACTIONS).toEqual({
      SKIP_EXISTING: "skip_existing",
      IMPORT_ANYWAY: "import_anyway",
      LEAVE_FOR_MANUAL_REVIEW: "leave_for_manual_review",
    });
  });

  it("marks exact_in_batch and exact_existing as the locked, action-less tiers", () => {
    expect(LOCKED_DUPLICATE_TIERS).toEqual(["exact_in_batch", "exact_existing"]);
  });
});
