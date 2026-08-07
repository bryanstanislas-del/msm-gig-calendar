import { describe, it, expect } from "vitest";
import { applyGroupDecisionToRow, composeResolvedRow } from "./groupResolution.js";
import { deriveRowState, ROW_STATES, isLocked } from "./reviewBatch.js";
import { VENUE_MISSING_ACTIONS, VENUE_FUZZY_ACTIONS } from "./venueResolutionGroups.js";
import { ARTIST_MISSING_ACTIONS, ARTIST_FUZZY_ACTIONS } from "./artistResolutionGroups.js";
import { DUPLICATE_CLUSTER_ACTIONS } from "./duplicateResolutionGroups.js";

// Defaults resolve venue/artist independently of each other (venue exact,
// artist not_applicable -- i.e. both already "clean") so a test exercising
// ONE dimension (e.g. only venueMatch) isn't also blocked on READY by the
// other, untouched dimension. Tests that want to exercise venue/artist
// together override both explicitly.
function row(id, overrides = {}) {
  return {
    id,
    fields: { date: "2026-09-01", isCancelled: false, isPostponed: false, isRescheduled: false, ...overrides.fields },
    status: "ok",
    venueMatch: {
      tier: "exact", query: "Southampton 1865", city: "Southampton",
      match: { id: "v0", name: "Southampton 1865", city: "Southampton" }, candidates: [],
      ...overrides.venueMatch,
    },
    artistMatch: { tier: "not_applicable", query: null, match: null, candidates: [], ...overrides.artistMatch },
    duplicate: { tier: "none", withRowIds: [], existingGigId: null, ...overrides.duplicate },
  };
}

function stateOf(resolved) {
  return deriveRowState({
    parserStatus: resolved.status,
    fields: resolved.fields,
    duplicate: resolved.duplicate,
    venueMatch: resolved.venueMatch,
    artistMatch: resolved.artistMatch,
  });
}

const missingVenueRow = (id, overrides = {}) =>
  row(id, { venueMatch: { tier: "none", city: null, match: null, candidates: [] }, ...overrides });

describe("applyGroupDecisionToRow -- venue", () => {
  it("APPROVE_NEW requires a city -- no-ops without one", () => {
    const decision = { groupId: "g1", kind: "venue_missing", action: VENUE_MISSING_ACTIONS.APPROVE_NEW };
    const resolved = applyGroupDecisionToRow(missingVenueRow("r1"), decision);
    expect(resolved.venueMatch.tier).toBe("none");
  });

  it("APPROVE_NEW with a city resolves the row to approved_new and clears the missing-venue state", () => {
    const decision = { groupId: "g1", kind: "venue_missing", action: VENUE_MISSING_ACTIONS.APPROVE_NEW, approvedNewVenueCity: "Fareham" };
    const resolved = applyGroupDecisionToRow(missingVenueRow("r1"), decision);
    expect(resolved.venueMatch).toMatchObject({ tier: "approved_new", city: "Fareham", match: null });
    expect(stateOf(resolved)).toBe(ROW_STATES.READY);
  });

  it("LINK_EXISTING resolves to a confirmed match against the given venue", () => {
    const decision = {
      groupId: "g1", kind: "venue_missing", action: VENUE_MISSING_ACTIONS.LINK_EXISTING,
      resolvedVenue: { id: "v1", name: "The Brook", city: "Southampton" },
    };
    const resolved = applyGroupDecisionToRow(missingVenueRow("r1"), decision);
    expect(resolved.venueMatch).toMatchObject({ tier: "confirmed", match: { id: "v1", name: "The Brook", city: "Southampton" } });
  });

  it("LEAVE_UNRESOLVED and EXCLUDE_AFFECTED never touch match data", () => {
    for (const action of [VENUE_MISSING_ACTIONS.LEAVE_UNRESOLVED, VENUE_MISSING_ACTIONS.EXCLUDE_AFFECTED]) {
      const resolved = applyGroupDecisionToRow(missingVenueRow("r1"), { groupId: "g1", kind: "venue_missing", action });
      expect(resolved.venueMatch.tier).toBe("none");
    }
  });

  it("REJECT_MATCH on a fuzzy venue reverts it to tier none (back to unresolved)", () => {
    const r = row("r1", { venueMatch: { tier: "fuzzy", candidates: [{ id: "v1", name: "X", city: "Y", similarity_score: 0.5 }] } });
    const resolved = applyGroupDecisionToRow(r, { groupId: "g1", kind: "venue_fuzzy", action: VENUE_FUZZY_ACTIONS.REJECT_MATCH });
    expect(resolved.venueMatch).toMatchObject({ tier: "none", match: null, candidates: [] });
  });
});

const missingArtistRow = (id, overrides = {}) =>
  row(id, { artistMatch: { tier: "none", query: "Unknown Act", match: null, candidates: [] }, ...overrides });

describe("applyGroupDecisionToRow -- artist", () => {
  it("LEAVE_AS_FREE_TEXT never sets band_profile_id-relevant match, and clears missing-artist state", () => {
    const decision = { groupId: "g1", kind: "artist_missing", action: ARTIST_MISSING_ACTIONS.LEAVE_AS_FREE_TEXT };
    const resolved = applyGroupDecisionToRow(missingArtistRow("r1"), decision);
    expect(resolved.artistMatch).toMatchObject({ tier: "confirmed_free_text", match: null });
    expect(stateOf(resolved)).toBe(ROW_STATES.READY);
  });

  it("has no auto-create action for artists -- LINK_EXISTING requires an explicit resolvedArtist, nothing implicit", () => {
    const decision = { groupId: "g1", kind: "artist_missing", action: ARTIST_MISSING_ACTIONS.LINK_EXISTING };
    const resolved = applyGroupDecisionToRow(missingArtistRow("r1"), decision); // no resolvedArtist given
    expect(resolved.artistMatch.tier).toBe("none"); // unchanged, no silent creation of anything
  });
});

describe("applyGroupDecisionToRow -- duplicate safety (structural, not just UI)", () => {
  it("IMPORT_ANYWAY never moves an exact_in_batch row off its lock", () => {
    const r = row("r1", { duplicate: { tier: "exact_in_batch", withRowIds: ["r2"] } });
    const decision = { groupId: "g1", kind: "duplicate_cluster", action: DUPLICATE_CLUSTER_ACTIONS.IMPORT_ANYWAY };
    const resolved = applyGroupDecisionToRow(r, decision);
    expect(resolved.duplicate.tier).toBe("exact_in_batch");
    expect(stateOf(resolved)).toBe(ROW_STATES.EXACT_DUPLICATE);
    expect(isLocked(stateOf(resolved))).toBe(true);
  });

  it("IMPORT_ANYWAY never moves an exact_existing row off its lock", () => {
    const r = row("r1", { duplicate: { tier: "exact_existing", existingGigId: "g1" } });
    const decision = { groupId: "g1", kind: "duplicate_cluster", action: DUPLICATE_CLUSTER_ACTIONS.IMPORT_ANYWAY };
    const resolved = applyGroupDecisionToRow(r, decision);
    expect(resolved.duplicate.tier).toBe("exact_existing");
    expect(stateOf(resolved)).toBe(ROW_STATES.EXACT_DUPLICATE);
  });

  it("IMPORT_ANYWAY on a near_existing (probable duplicate) row clears the flag -- the one spec-approved escape hatch", () => {
    const r = row("r1", { duplicate: { tier: "near_existing", existingGigId: "g1" } });
    const decision = { groupId: "g1", kind: "duplicate_cluster", action: DUPLICATE_CLUSTER_ACTIONS.IMPORT_ANYWAY };
    const resolved = applyGroupDecisionToRow(r, decision);
    expect(resolved.duplicate.tier).toBe("none");
    expect(stateOf(resolved)).toBe(ROW_STATES.READY);
  });

  it("IMPORT_ANYWAY on a near_in_batch (possible duplicate) row clears the flag", () => {
    const r = row("r1", { duplicate: { tier: "near_in_batch", withRowIds: ["r2"] } });
    const decision = { groupId: "g1", kind: "duplicate_cluster", action: DUPLICATE_CLUSTER_ACTIONS.IMPORT_ANYWAY };
    const resolved = applyGroupDecisionToRow(r, decision);
    expect(resolved.duplicate.tier).toBe("none");
  });

  it("SKIP_EXISTING and LEAVE_FOR_MANUAL_REVIEW never change duplicate data", () => {
    const r = row("r1", { duplicate: { tier: "near_existing", existingGigId: "g1" } });
    for (const action of [DUPLICATE_CLUSTER_ACTIONS.SKIP_EXISTING, DUPLICATE_CLUSTER_ACTIONS.LEAVE_FOR_MANUAL_REVIEW]) {
      const resolved = applyGroupDecisionToRow(r, { groupId: "g1", kind: "duplicate_cluster", action });
      expect(resolved.duplicate.tier).toBe("near_existing");
    }
  });
});

describe("invalid-date protection is untouched by any decision", () => {
  it("a row with no date stays INVALID_DATE regardless of venue/artist/duplicate decisions", () => {
    const r = row("r1", { fields: { date: null } });
    const resolved = composeResolvedRow(r, {
      venueGroupDecision: { kind: "venue_missing", action: VENUE_MISSING_ACTIONS.APPROVE_NEW, approvedNewVenueCity: "X" },
      artistGroupDecision: { kind: "artist_missing", action: ARTIST_MISSING_ACTIONS.LEAVE_AS_FREE_TEXT },
    });
    expect(stateOf(resolved)).toBe(ROW_STATES.INVALID_DATE);
    expect(isLocked(stateOf(resolved))).toBe(true);
  });
});

describe("composeResolvedRow -- one grouped decision updates every member row identically", () => {
  it("applies the same venue decision across a whole group's rows", () => {
    const decision = {
      kind: "venue_missing", action: VENUE_MISSING_ACTIONS.LINK_EXISTING,
      resolvedVenue: { id: "v1", name: "Southampton 1865", city: "Southampton" },
    };
    const rows = [missingVenueRow("r1"), missingVenueRow("r2"), missingVenueRow("r3")];
    const resolvedRows = rows.map((r) => composeResolvedRow(r, { venueGroupDecision: decision }));
    for (const resolved of resolvedRows) {
      expect(resolved.venueMatch).toMatchObject({ tier: "confirmed", match: { id: "v1" } });
      expect(stateOf(resolved)).toBe(ROW_STATES.READY);
    }
  });
});

describe("composeResolvedRow -- a row-level override always wins for that row only", () => {
  it("one row's override differs from the group decision without affecting siblings", () => {
    const groupDecision = {
      kind: "venue_missing", action: VENUE_MISSING_ACTIONS.LINK_EXISTING,
      resolvedVenue: { id: "v1", name: "Southampton 1865", city: "Southampton" },
    };
    const rows = [missingVenueRow("r1"), missingVenueRow("r2"), missingVenueRow("r3")];
    const overrideForR2 = { rejectVenueMatch: true };

    const resolved = rows.map((r) =>
      composeResolvedRow(r, { venueGroupDecision: groupDecision, override: r.id === "r2" ? overrideForR2 : undefined })
    );

    expect(resolved[0].venueMatch.tier).toBe("confirmed"); // r1, group decision applied
    expect(resolved[2].venueMatch.tier).toBe("confirmed"); // r3, group decision applied
    expect(resolved[1].venueMatch.tier).toBe("none"); // r2, its own override wins instead
  });

  it("an override with overrideVenue links to a venue not present in the row's own candidates", () => {
    const r = row("r1", { venueMatch: { tier: "none", candidates: [] } }); // tier none has zero candidates -- nothing to accept
    const override = { overrideVenue: { id: "v9", name: "Some Other Venue", city: "Portsmouth" } };
    const resolved = composeResolvedRow(r, { override });
    expect(resolved.venueMatch).toMatchObject({ tier: "confirmed", match: { id: "v9", name: "Some Other Venue" } });
  });

  it("existing venueCandidateId/artistCandidateId override fields still work unchanged (backward compatible)", () => {
    const r = row("r1", {
      venueMatch: { tier: "fuzzy", candidates: [{ id: "v1", name: "The Brook", city: "Southampton", similarity_score: 0.6 }] },
    });
    const resolved = composeResolvedRow(r, { override: { venueCandidateId: "v1" } });
    expect(resolved.venueMatch).toMatchObject({ tier: "confirmed", match: { id: "v1", name: "The Brook" } });
  });
});

describe("composeResolvedRow -- undo (removing a decision reverts the row)", () => {
  it("a row with no decisions and no override resolves identically to its raw parsed match", () => {
    const r = missingVenueRow("r1");
    const resolved = composeResolvedRow(r, {});
    expect(resolved.venueMatch).toEqual(r.venueMatch);
    expect(resolved.artistMatch).toEqual(r.artistMatch);
    expect(resolved.duplicate).toEqual(r.duplicate);
    expect(stateOf(resolved)).toBe(ROW_STATES.MISSING_VENUE);
  });
});

describe("preserving manual exclusions is out of this module's scope by design", () => {
  it("composeResolvedRow only ever returns venueMatch/artistMatch/duplicate -- it never touches selection", () => {
    const r = row("r1");
    const resolved = composeResolvedRow(r, {
      venueGroupDecision: { kind: "venue_missing", action: VENUE_MISSING_ACTIONS.APPROVE_NEW, approvedNewVenueCity: "X" },
    });
    expect(resolved).not.toHaveProperty("selected");
    expect(resolved).not.toHaveProperty("explicitlyExcluded");
  });
});
