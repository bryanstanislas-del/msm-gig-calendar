import { describe, it, expect } from "vitest";
import {
  computeDefaultSelection,
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
import { ROW_STATES } from "./reviewBatch.js";

const exact = { tier: "exact", candidates: [] };
const none = { tier: "none", candidates: [], query: "Unknown" };

function item(id, rowState, overrides = {}) {
  return { id, rowState, venueMatch: exact, artistMatch: exact, ...overrides };
}

describe("computeDefaultSelection", () => {
  it("selects only 'ready' rows", () => {
    const items = [item("r1", ROW_STATES.READY), item("r2", ROW_STATES.NEEDS_REVIEW), item("r3", ROW_STATES.READY)];
    expect(computeDefaultSelection(items)).toEqual(new Set(["r1", "r3"]));
  });

  it("never includes a locked state even in a hypothetical forced scenario (locked states are never 'ready')", () => {
    const items = [item("r1", ROW_STATES.EXACT_DUPLICATE), item("r2", ROW_STATES.INVALID_DATE)];
    expect(computeDefaultSelection(items).size).toBe(0);
  });
});

describe("whole-batch bulk selection helpers", () => {
  const items = [
    item("ready1", ROW_STATES.READY),
    item("ready2", ROW_STATES.READY),
    item("error1", ROW_STATES.MISSING_VENUE),
    item("error2", ROW_STATES.NEEDS_REVIEW),
    item("dup1", ROW_STATES.EXACT_DUPLICATE),
    item("dup2", ROW_STATES.POSSIBLE_DUPLICATE),
    item("cancelled1", ROW_STATES.CANCELLED),
  ];

  it("selectAllReady adds every ready row without touching others", () => {
    const selected = new Set(["dup1"]); // pre-existing unrelated selection
    const next = selectAllReady(items, selected);
    expect(next).toEqual(new Set(["dup1", "ready1", "ready2"]));
  });

  it("excludeAllErrors removes only ERROR_STATES rows", () => {
    const selected = new Set(["ready1", "error1", "error2", "dup1", "cancelled1"]);
    const next = excludeAllErrors(items, selected);
    expect(next).toEqual(new Set(["ready1", "dup1", "cancelled1"]));
  });

  it("excludeAllDuplicates removes only DUPLICATE_STATES rows", () => {
    const selected = new Set(["ready1", "error1", "dup1", "dup2", "cancelled1"]);
    const next = excludeAllDuplicates(items, selected);
    expect(next).toEqual(new Set(["ready1", "error1", "cancelled1"]));
  });

  it("neither bulk action touches cancelled/postponed/rescheduled rows", () => {
    const selected = new Set(["cancelled1"]);
    expect(excludeAllErrors(items, selected)).toEqual(new Set(["cancelled1"]));
    expect(excludeAllDuplicates(items, selected)).toEqual(new Set(["cancelled1"]));
  });

  it("excludeVisibleSelected only removes rows present in the filtered list", () => {
    const selected = new Set(["ready1", "ready2", "dup1"]);
    const filtered = [item("ready1", ROW_STATES.READY)]; // only ready1 is "visible"
    const next = excludeVisibleSelected(filtered, selected);
    expect(next).toEqual(new Set(["ready2", "dup1"]));
  });
});

describe("applyMatchOverride / withOverridesApplied", () => {
  const fuzzyMatch = {
    tier: "fuzzy",
    query: "The Brooky",
    candidates: [
      { id: "v1", name: "The Brook", city: "Southampton", similarity_score: 0.6 },
      { id: "v2", name: "The Brookside", city: "Southampton", similarity_score: 0.4 },
    ],
  };

  it("turns a chosen candidate into a 'confirmed' match", () => {
    const result = applyMatchOverride(fuzzyMatch, "v2");
    expect(result.tier).toBe("confirmed");
    expect(result.match).toEqual({ id: "v2", name: "The Brookside", city: "Southampton" });
    expect(result.candidates).toEqual([]);
  });

  it("returns the match unchanged when candidateId is missing or not found", () => {
    expect(applyMatchOverride(fuzzyMatch, null)).toBe(fuzzyMatch);
    expect(applyMatchOverride(fuzzyMatch, "nonexistent")).toBe(fuzzyMatch);
  });

  it("withOverridesApplied applies venue and/or artist overrides independently", () => {
    const row = { venueMatch: fuzzyMatch, artistMatch: none };
    const result = withOverridesApplied(row, { venueCandidateId: "v1" });
    expect(result.venueMatch.tier).toBe("confirmed");
    expect(result.artistMatch).toBe(none); // untouched
  });

  it("withOverridesApplied is a no-op when there's no override for this row", () => {
    const row = { venueMatch: fuzzyMatch, artistMatch: none };
    expect(withOverridesApplied(row, undefined)).toBe(row);
  });
});

describe("applyBulkApproveSuggestions", () => {
  it("picks the top candidate for every currently-fuzzy row, on both fields independently", () => {
    const items = [
      {
        id: "r1",
        venueMatch: { tier: "fuzzy", candidates: [{ id: "v1", name: "The Brook", city: null, similarity_score: 0.6 }] },
        artistMatch: none,
      },
      { id: "r2", venueMatch: exact, artistMatch: { tier: "fuzzy", candidates: [{ id: "a1", name: "The Mafia", city: null, similarity_score: 0.5 }] } },
      { id: "r3", venueMatch: exact, artistMatch: exact },
    ];
    const overrides = applyBulkApproveSuggestions(items);
    expect(overrides).toEqual({ r1: { venueCandidateId: "v1" }, r2: { artistCandidateId: "a1" } });
  });

  it("never touches selection -- only returns overrides", () => {
    const items = [{ id: "r1", venueMatch: { tier: "fuzzy", candidates: [{ id: "v1", name: "X", city: null, similarity_score: 0.6 }] }, artistMatch: exact }];
    const overrides = applyBulkApproveSuggestions(items);
    expect(overrides).not.toHaveProperty("selected");
    expect(Object.keys(overrides)).toEqual(["r1"]);
  });
});

describe("summariseBatch", () => {
  it("produces the exact 10 required metrics, with possible+probable duplicates combined", () => {
    const items = [
      item("r1", ROW_STATES.READY),
      item("r2", ROW_STATES.READY),
      item("r3", ROW_STATES.NEEDS_REVIEW),
      item("r4", ROW_STATES.EXACT_DUPLICATE),
      item("r5", ROW_STATES.POSSIBLE_DUPLICATE),
      item("r6", ROW_STATES.PROBABLE_DUPLICATE),
      item("r7", ROW_STATES.MISSING_ARTIST),
      item("r8", ROW_STATES.MISSING_VENUE),
      item("r9", ROW_STATES.INVALID_DATE),
      item("r10", ROW_STATES.CANCELLED),
      item("r11", ROW_STATES.POSTPONED),
      item("r12", ROW_STATES.RESCHEDULED),
    ];
    const selected = new Set(["r1"]); // r2 (ready) is unselected -> manually excluded
    const counts = summariseBatch(items, selected);
    expect(counts).toEqual({
      totalParsed: 12,
      ready: 2,
      selectedForImport: 1,
      needsReview: 1,
      exactDuplicates: 1,
      possibleDuplicates: 2, // possible + probable combined
      missingArtists: 1,
      missingVenues: 1,
      invalidRows: 1,
      manuallyExcluded: 1, // r2
    });
  });

  it("selectedForImport always equals selected.size, independent of row states", () => {
    const items = [item("r1", ROW_STATES.READY)];
    expect(summariseBatch(items, new Set(["r1", "phantom-id"])).selectedForImport).toBe(2);
  });
});

describe("groupSkippedReasons", () => {
  it("groups and counts unselected rows by display state, sorted descending", () => {
    const items = [
      item("r1", ROW_STATES.EXACT_DUPLICATE),
      item("r2", ROW_STATES.EXACT_DUPLICATE),
      item("r3", ROW_STATES.EXACT_DUPLICATE),
      item("r4", ROW_STATES.CANCELLED),
      item("r5", ROW_STATES.READY), // unselected ready -> excluded_manually
    ];
    const groups = groupSkippedReasons(items, new Set());
    expect(groups).toEqual([
      { state: ROW_STATES.EXACT_DUPLICATE, label: "Exact Duplicate", count: 3 },
      { state: ROW_STATES.CANCELLED, label: "Cancelled", count: 1 },
      { state: "excluded_manually", label: "Excluded Manually", count: 1 },
    ]);
  });

  it("never includes a selected row in the skip list", () => {
    const items = [item("r1", ROW_STATES.EXACT_DUPLICATE)];
    expect(groupSkippedReasons(items, new Set(["r1"]))).toEqual([]);
  });
});
