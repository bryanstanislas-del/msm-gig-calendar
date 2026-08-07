import { describe, it, expect } from "vitest";
import { groupMissingArtists, groupFuzzyArtists, ARTIST_MISSING_ACTIONS, ARTIST_FUZZY_ACTIONS } from "./artistResolutionGroups.js";

function row(id, overrides = {}) {
  return {
    id,
    artistMatch: { tier: "none", query: "Unknown Act", match: null, candidates: [], ...overrides.artistMatch },
  };
}

describe("groupMissingArtists", () => {
  it("groups rows sharing the same normalised artist text", () => {
    const rows = [row("r1"), row("r2"), row("r3")];
    const groups = groupMissingArtists(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual(["r1", "r2", "r3"]);
    expect(groups[0].id).toBe("artist_missing:unknown act");
  });

  it("collapses whitespace/case aliases via normaliseName", () => {
    const rows = [
      row("r1", { artistMatch: { query: "Fell Out Boy" } }),
      row("r2", { artistMatch: { query: "  fell   out boy " } }),
    ];
    expect(groupMissingArtists(rows)).toHaveLength(1);
  });

  it("only includes tier=none rows, excluding not_applicable and matched rows", () => {
    const rows = [
      row("r1", { artistMatch: { tier: "none" } }),
      row("r2", { artistMatch: { tier: "not_applicable", query: null } }),
      row("r3", { artistMatch: { tier: "exact", query: "Unknown Act" } }),
    ];
    const groups = groupMissingArtists(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual(["r1"]);
  });

  it("skips a null/empty query rather than producing a bogus group", () => {
    const rows = [row("r1", { artistMatch: { query: null } })];
    expect(groupMissingArtists(rows)).toEqual([]);
  });

  it("caps sampleRowIds while rowIds keeps every affected row", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`r${i}`));
    const group = groupMissingArtists(rows)[0];
    expect(group.rowIds).toHaveLength(12);
    expect(group.sampleRowIds).toHaveLength(5);
  });

  it("has no auto-create action -- LEAVE_AS_FREE_TEXT is the default, never creating a profile", () => {
    expect(ARTIST_MISSING_ACTIONS).toEqual({
      LEAVE_AS_FREE_TEXT: "leave_as_free_text",
      LINK_EXISTING: "link_existing",
      LEAVE_UNRESOLVED: "leave_unresolved",
      EXCLUDE_AFFECTED: "exclude_affected",
    });
    expect(Object.values(ARTIST_MISSING_ACTIONS)).not.toContain("approve_new");
  });
});

describe("groupFuzzyArtists", () => {
  const candidates = [{ id: "a1", name: "The Mafia", city: "Southampton", profileType: "band", similarity_score: 0.6 }];

  it("only includes tier=fuzzy rows and carries suggested candidates", () => {
    const rows = [
      row("r1", { artistMatch: { tier: "fuzzy", query: "The Mafias", candidates } }),
      row("r2", { artistMatch: { tier: "none", query: "The Mafias" } }),
    ];
    const groups = groupFuzzyArtists(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual(["r1"]);
    expect(groups[0].suggestedCandidates).toEqual(candidates);
  });

  it("flags hasCandidateDisagreement when member rows' top candidate differs", () => {
    const rows = [
      row("r1", { artistMatch: { tier: "fuzzy", query: "The Mafias", candidates: [{ id: "a1", name: "A", similarity_score: 0.6 }] } }),
      row("r2", { artistMatch: { tier: "fuzzy", query: "The Mafias", candidates: [{ id: "a2", name: "B", similarity_score: 0.5 }] } }),
    ];
    expect(groupFuzzyArtists(rows)[0].hasCandidateDisagreement).toBe(true);
  });

  it("action set includes LEAVE_AS_FREE_TEXT instead of LEAVE_UNRESOLVED", () => {
    expect(ARTIST_FUZZY_ACTIONS).toEqual({
      ACCEPT_SUGGESTED: "accept_suggested",
      CHOOSE_DIFFERENT: "choose_different",
      REJECT_MATCH: "reject_match",
      LEAVE_AS_FREE_TEXT: "leave_as_free_text",
    });
  });
});

describe("determinism", () => {
  it("produces the same group ids and order across repeated calls", () => {
    const rows = [row("r1"), row("r2", { artistMatch: { query: "Someone Else" } })];
    expect(groupMissingArtists(rows).map((g) => g.id)).toEqual(groupMissingArtists(rows).map((g) => g.id));
  });
});
