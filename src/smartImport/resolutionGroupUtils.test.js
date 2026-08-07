import { describe, it, expect } from "vitest";
import { buildGroupId, sortGroups, indexRowsByGroup, GROUP_SAMPLE_SIZE } from "./resolutionGroupUtils.js";

describe("buildGroupId", () => {
  it("is a pure function of kind prefix + normalised key", () => {
    expect(buildGroupId("venue_missing", "southampton 1865")).toBe("venue_missing:southampton 1865");
    expect(buildGroupId("venue_missing", "southampton 1865")).toBe(buildGroupId("venue_missing", "southampton 1865"));
  });

  it("keeps different kinds with the same key distinct", () => {
    expect(buildGroupId("venue_missing", "x")).not.toBe(buildGroupId("venue_fuzzy", "x"));
  });
});

describe("sortGroups", () => {
  it("sorts by rowIds.length descending", () => {
    const groups = [
      { id: "b", rowIds: ["r1"] },
      { id: "a", rowIds: ["r1", "r2", "r3"] },
      { id: "c", rowIds: ["r1", "r2"] },
    ];
    expect(sortGroups(groups).map((g) => g.id)).toEqual(["a", "c", "b"]);
  });

  it("breaks ties by id ascending, stably", () => {
    const groups = [
      { id: "z", rowIds: ["r1"] },
      { id: "a", rowIds: ["r1"] },
      { id: "m", rowIds: ["r1"] },
    ];
    expect(sortGroups(groups).map((g) => g.id)).toEqual(["a", "m", "z"]);
  });

  it("does not mutate the input array", () => {
    const groups = [{ id: "b", rowIds: ["r1"] }, { id: "a", rowIds: ["r1", "r2"] }];
    const original = [...groups];
    sortGroups(groups);
    expect(groups).toEqual(original);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const groups = [
      { id: "venue_missing:the brook", rowIds: ["r1", "r2"] },
      { id: "venue_missing:southampton 1865", rowIds: Array.from({ length: 83 }, (_, i) => `r${i}`) },
    ];
    const first = sortGroups(groups).map((g) => g.id);
    const second = sortGroups(groups).map((g) => g.id);
    expect(first).toEqual(second);
    expect(first[0]).toBe("venue_missing:southampton 1865");
  });
});

describe("indexRowsByGroup", () => {
  it("maps every member row id to its group id", () => {
    const groups = [
      { id: "g1", rowIds: ["r1", "r2"] },
      { id: "g2", rowIds: ["r3"] },
    ];
    const index = indexRowsByGroup(groups);
    expect(index.get("r1")).toBe("g1");
    expect(index.get("r2")).toBe("g1");
    expect(index.get("r3")).toBe("g2");
    expect(index.has("r4")).toBe(false);
  });

  it("returns an empty index for an empty group list", () => {
    expect(indexRowsByGroup([]).size).toBe(0);
  });
});

describe("GROUP_SAMPLE_SIZE", () => {
  it("is a small positive integer", () => {
    expect(GROUP_SAMPLE_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(GROUP_SAMPLE_SIZE)).toBe(true);
  });
});
