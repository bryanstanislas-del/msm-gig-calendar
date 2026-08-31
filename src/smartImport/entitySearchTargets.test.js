// Regression coverage for the EntitySearchPicker bug: entityType="festival"
// (and, latently, anything besides "venue"/"artist") fell through a
// hardcoded `DB.searchEntities("venue", q)` literal instead of the actual
// entityType, so the picker silently searched venues no matter what was
// asked for. This pins the routing decision itself -- see App.jsx's
// EntitySearchPicker for where it's actually used.
import { describe, it, expect } from "vitest";
import { entitySearchTargets } from "./entitySearchTargets.js";

describe("entitySearchTargets", () => {
  it("artist searches both band and solo_artist -- unchanged existing behaviour", () => {
    expect(entitySearchTargets("artist")).toEqual(["band", "solo_artist"]);
  });

  it("venue searches only venue", () => {
    expect(entitySearchTargets("venue")).toEqual(["venue"]);
  });

  it("festival searches only festival -- the fix: this used to silently resolve to venue", () => {
    expect(entitySearchTargets("festival")).toEqual(["festival"]);
  });

  it("never returns venue for a non-venue entityType (the exact shape of the bug)", () => {
    for (const entityType of ["festival", "promoter", "organisation"]) {
      expect(entitySearchTargets(entityType)).not.toContain("venue");
    }
  });

  it("passes through any other entity type 1:1, with no special-casing beyond artist", () => {
    expect(entitySearchTargets("promoter")).toEqual(["promoter"]);
    expect(entitySearchTargets("organisation")).toEqual(["organisation"]);
  });
});
