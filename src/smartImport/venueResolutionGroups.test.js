import { describe, it, expect } from "vitest";
import { groupMissingVenues, groupFuzzyVenues, VENUE_MISSING_ACTIONS, VENUE_FUZZY_ACTIONS } from "./venueResolutionGroups.js";

function row(id, overrides = {}) {
  return {
    id,
    fields: { venueBlock: null, ...overrides.fields },
    venueMatch: { tier: "none", query: "Southampton 1865", city: null, match: null, candidates: [], ...overrides.venueMatch },
  };
}

describe("groupMissingVenues", () => {
  it("groups rows sharing the same normalised venue text into one group", () => {
    const rows = [row("r1"), row("r2"), row("r3")];
    const groups = groupMissingVenues(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual(["r1", "r2", "r3"]);
    expect(groups[0].id).toBe("venue_missing:southampton 1865");
  });

  it("collapses whitespace/case aliases of the same venue via normaliseName", () => {
    const rows = [
      row("r1", { venueMatch: { query: "Southampton 1865" } }),
      row("r2", { venueMatch: { query: "  southampton   1865 " } }),
      row("r3", { venueMatch: { query: "SOUTHAMPTON 1865" } }),
    ];
    expect(groupMissingVenues(rows)).toHaveLength(1);
    expect(groupMissingVenues(rows)[0].rowIds).toHaveLength(3);
  });

  it("keeps a genuinely different wording as a separate group (documented limitation)", () => {
    const rows = [
      row("r1", { venueMatch: { query: "The Joiners" } }),
      row("r2", { venueMatch: { query: "Joiners Arms" } }),
    ];
    expect(groupMissingVenues(rows)).toHaveLength(2);
  });

  it("only includes tier=none rows, ignoring exact/fuzzy rows", () => {
    const rows = [
      row("r1", { venueMatch: { tier: "none" } }),
      row("r2", { venueMatch: { tier: "exact", query: "Southampton 1865" } }),
      row("r3", { venueMatch: { tier: "fuzzy", query: "Southampton 1865" } }),
    ];
    const groups = groupMissingVenues(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual(["r1"]);
  });

  it("skips rows with an empty query rather than producing a bogus group", () => {
    const rows = [row("r1", { venueMatch: { query: "" } })];
    expect(groupMissingVenues(rows)).toEqual([]);
  });

  it("captures the raw venueBlock as sourceAddressBlock when the source profile provides one", () => {
    const rows = [row("r1", { fields: { venueBlock: "Southampton 1865, Brunswick Square" } })];
    expect(groupMissingVenues(rows)[0].sourceAddressBlock).toBe("Southampton 1865, Brunswick Square");
  });

  it("uses null sourceAddressBlock when the profile never populated venueBlock", () => {
    const rows = [row("r1", { fields: { venueBlock: null } })];
    expect(groupMissingVenues(rows)[0].sourceAddressBlock).toBeNull();
  });

  it("caps sampleRowIds at GROUP_SAMPLE_SIZE while rowIds keeps every affected row", () => {
    const rows = Array.from({ length: 83 }, (_, i) => row(`r${i}`));
    const group = groupMissingVenues(rows)[0];
    expect(group.rowIds).toHaveLength(83);
    expect(group.sampleRowIds).toHaveLength(5);
    expect(group.sampleRowIds).toEqual(group.rowIds.slice(0, 5));
  });

  it("sorts groups by affected-row-count descending", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => row(`brook-${i}`, { venueMatch: { query: "The Brook" } })),
      ...Array.from({ length: 10 }, (_, i) => row(`sh-${i}`, { venueMatch: { query: "Southampton 1865" } })),
    ];
    const groups = groupMissingVenues(rows);
    expect(groups[0].sourceText).toBe("Southampton 1865");
    expect(groups[1].sourceText).toBe("The Brook");
  });

  it("has stable required action set", () => {
    expect(VENUE_MISSING_ACTIONS).toEqual({
      LINK_EXISTING: "link_existing",
      APPROVE_NEW: "approve_new",
      LEAVE_UNRESOLVED: "leave_unresolved",
      EXCLUDE_AFFECTED: "exclude_affected",
    });
  });
});

describe("groupFuzzyVenues", () => {
  const candidates = [{ id: "v1", name: "The Joiners", city: "Southampton", similarity_score: 0.6 }];

  it("only includes tier=fuzzy rows and carries the suggested candidates", () => {
    const rows = [
      row("r1", { venueMatch: { tier: "fuzzy", query: "The Joyners", candidates } }),
      row("r2", { venueMatch: { tier: "none", query: "The Joyners" } }),
    ];
    const groups = groupFuzzyVenues(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual(["r1"]);
    expect(groups[0].suggestedCandidates).toEqual(candidates);
  });

  it("flags hasCandidateDisagreement when member rows' top candidate differs", () => {
    const rows = [
      row("r1", { venueMatch: { tier: "fuzzy", query: "The Joyners", candidates: [{ id: "v1", name: "A", city: "X", similarity_score: 0.6 }] } }),
      row("r2", { venueMatch: { tier: "fuzzy", query: "The Joyners", candidates: [{ id: "v2", name: "B", city: "X", similarity_score: 0.5 }] } }),
    ];
    expect(groupFuzzyVenues(rows)[0].hasCandidateDisagreement).toBe(true);
  });

  it("does not flag disagreement when every member row agrees on the top candidate", () => {
    const rows = [
      row("r1", { venueMatch: { tier: "fuzzy", query: "The Joyners", candidates } }),
      row("r2", { venueMatch: { tier: "fuzzy", query: "The Joyners", candidates } }),
    ];
    expect(groupFuzzyVenues(rows)[0].hasCandidateDisagreement).toBe(false);
  });

  it("has stable required action set", () => {
    expect(VENUE_FUZZY_ACTIONS).toEqual({
      ACCEPT_SUGGESTED: "accept_suggested",
      CHOOSE_DIFFERENT: "choose_different",
      REJECT_MATCH: "reject_match",
      LEAVE_UNRESOLVED: "leave_unresolved",
    });
  });
});

describe("determinism", () => {
  it("produces the same group ids and order across repeated calls on the same batch", () => {
    const rows = [row("r1"), row("r2", { venueMatch: { query: "The Brook" } })];
    const first = groupMissingVenues(rows).map((g) => g.id);
    const second = groupMissingVenues(rows).map((g) => g.id);
    expect(first).toEqual(second);
  });
});
