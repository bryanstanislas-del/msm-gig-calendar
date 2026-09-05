import { describe, it, expect } from "vitest";
import { rankVenueCandidates, isAutoResolvableMatchType, MATCH_TYPES, MIN_FUZZY_SIMILARITY } from "./ranking.js";

const platformTavern = { id: "v-platform", name: "Platform Tavern", city: "Southampton", postcode: "SO14 2NY" };
const fillerVenues = [
  { id: "v-1", name: "The Joiners", city: "Southampton" },
  { id: "v-2", name: "Talking Heads", city: "Southampton" },
];

describe("rankVenueCandidates -- required search examples", () => {
  it("'Plat' ranks Platform Tavern highly (PREFIX)", () => {
    const results = rankVenueCandidates("Plat", [platformTavern, ...fillerVenues]);
    expect(results[0].id).toBe("v-platform");
    expect(results[0].matchType).toBe(MATCH_TYPES.PREFIX);
  });

  it("'The Plat' still ranks Platform Tavern highly (PREFIX via alias normalisation)", () => {
    const results = rankVenueCandidates("The Plat", [platformTavern, ...fillerVenues]);
    expect(results[0].id).toBe("v-platform");
    expect(results[0].matchType).toBe(MATCH_TYPES.PREFIX);
  });

  it("'platform tav' ranks Platform Tavern highly (PREFIX)", () => {
    const results = rankVenueCandidates("platform tav", [platformTavern, ...fillerVenues]);
    expect(results[0].id).toBe("v-platform");
    expect(results[0].matchType).toBe(MATCH_TYPES.PREFIX);
  });

  it("'Tavern' discovers Platform Tavern (TOKEN)", () => {
    const results = rankVenueCandidates("Tavern", [platformTavern, ...fillerVenues]);
    const found = results.find((r) => r.id === "v-platform");
    expect(found).toBeTruthy();
    expect(found.matchType).toBe(MATCH_TYPES.TOKEN);
  });

  it("'platform tavern' is an exact/highest match", () => {
    const results = rankVenueCandidates("platform tavern", [platformTavern, ...fillerVenues]);
    expect(results[0].id).toBe("v-platform");
    expect(results[0].matchType).toBe(MATCH_TYPES.EXACT);
  });

  it("'The Platform Tavern' is a strong ALIAS suggestion, not EXACT", () => {
    const results = rankVenueCandidates("The Platform Tavern", [platformTavern, ...fillerVenues]);
    expect(results[0].id).toBe("v-platform");
    expect(results[0].matchType).toBe(MATCH_TYPES.ALIAS);
  });

  it("'Platfrom Tavern' (typo) may be suggested via FUZZY only when a similarity_score qualifies it", () => {
    const withScore = { ...platformTavern, similarity_score: 0.5 };
    const results = rankVenueCandidates("Platfrom Tavern", [withScore, ...fillerVenues]);
    const found = results.find((r) => r.id === "v-platform");
    expect(found).toBeTruthy();
    expect(found.matchType).toBe(MATCH_TYPES.FUZZY);
  });

  it("'Platfrom Tavern' is NOT suggested when similarity_score is below the threshold or absent", () => {
    const results1 = rankVenueCandidates("Platfrom Tavern", [platformTavern, ...fillerVenues]);
    expect(results1.find((r) => r.id === "v-platform")).toBeUndefined();

    const belowThreshold = { ...platformTavern, similarity_score: MIN_FUZZY_SIMILARITY - 0.01 };
    const results2 = rankVenueCandidates("Platfrom Tavern", [belowThreshold, ...fillerVenues]);
    expect(results2.find((r) => r.id === "v-platform")).toBeUndefined();
  });

  it("case differences do not change classification", () => {
    const results = rankVenueCandidates("PLATFORM TAVERN", [platformTavern]);
    expect(results[0].matchType).toBe(MATCH_TYPES.EXACT);
  });

  it("repeated whitespace does not change classification", () => {
    const results = rankVenueCandidates("platform    tavern", [platformTavern]);
    expect(results[0].matchType).toBe(MATCH_TYPES.EXACT);
  });

  it("safe punctuation variation (trailing comma) still finds the venue -- as ALIAS, since strict DB identity normalisation deliberately does not strip punctuation", () => {
    const results = rankVenueCandidates("Platform Tavern,", [platformTavern]);
    expect(results[0].id).toBe("v-platform");
    expect(results[0].matchType).toBe(MATCH_TYPES.ALIAS);
  });

  it("appended location text ('Platform Tavern Town Quay') surfaces the venue only as CONTAINS, never EXACT/ALIAS", () => {
    const results = rankVenueCandidates("Platform Tavern Town Quay", [platformTavern, ...fillerVenues]);
    const found = results.find((r) => r.id === "v-platform");
    expect(found).toBeTruthy();
    expect(found.matchType).toBe(MATCH_TYPES.CONTAINS);
  });
});

describe("rankVenueCandidates -- safety classification", () => {
  it("ALIAS/PREFIX/TOKEN/CONTAINS/FUZZY are never auto-resolvable; only EXACT is", () => {
    expect(isAutoResolvableMatchType(MATCH_TYPES.EXACT)).toBe(true);
    for (const t of [MATCH_TYPES.ALIAS, MATCH_TYPES.PREFIX, MATCH_TYPES.TOKEN, MATCH_TYPES.CONTAINS, MATCH_TYPES.FUZZY]) {
      expect(isAutoResolvableMatchType(t)).toBe(false);
    }
  });

  it("exact CAN be classified as exact (sanity check on the tier itself)", () => {
    const results = rankVenueCandidates("Platform Tavern", [platformTavern]);
    expect(results[0].matchType).toBe(MATCH_TYPES.EXACT);
  });
});

describe("rankVenueCandidates -- location awareness", () => {
  const crownSouthampton = { id: "v-crown-soton", name: "The Crown", city: "Southampton" };
  const crownPortsmouth = { id: "v-crown-pom", name: "The Crown", city: "Portsmouth" };

  it("same venue name in two cities remains distinguishable -- both appear as separate candidates", () => {
    const results = rankVenueCandidates("Crown", [crownSouthampton, crownPortsmouth]);
    expect(results.map((r) => r.id).sort()).toEqual(["v-crown-pom", "v-crown-soton"]);
  });

  it("supplied city boosts the matching-city candidate to the top", () => {
    const results = rankVenueCandidates("The Crown", [crownPortsmouth, crownSouthampton], { city: "Southampton" });
    expect(results[0].id).toBe("v-crown-soton");
    expect(results[0].cityMatch).toBe(true);
    expect(results[1].id).toBe("v-crown-pom");
    expect(results[1].cityMatch).toBe(false);
  });

  it("a different-city candidate is never classified EXACT, even on an exact name match", () => {
    const results = rankVenueCandidates("The Crown", [crownPortsmouth], { city: "Southampton" });
    expect(results[0].id).toBe("v-crown-pom");
    expect(results[0].matchType).not.toBe(MATCH_TYPES.EXACT);
    expect(results[0].cityMatch).toBe(false);
  });

  it("with no city context, an ambiguous exact-name match across cities is downgraded from EXACT to ALIAS (never auto-resolvable)", () => {
    const results = rankVenueCandidates("The Crown", [crownSouthampton, crownPortsmouth]);
    for (const r of results) {
      expect(r.matchType).not.toBe(MATCH_TYPES.EXACT);
      expect(isAutoResolvableMatchType(r.matchType)).toBe(false);
    }
  });

  it("with no city context and only one candidate, an exact name match is still classified EXACT", () => {
    const results = rankVenueCandidates("The Crown", [crownSouthampton]);
    expect(results[0].matchType).toBe(MATCH_TYPES.EXACT);
  });

  it("postcode boosts a name-plausible candidate but never independently establishes identity", () => {
    const nearMatch = { id: "v-near", name: "Platform Tavern Bar", city: "Southampton", postcode: "SO14 2NY" };
    const noPostcode = { id: "v-far", name: "Platform Tavern Rooms", city: "Southampton", postcode: "SO15 9ZZ" };
    const results = rankVenueCandidates("Platform Tavern", [noPostcode, nearMatch], { postcode: "SO14 2NY" });
    expect(results[0].id).toBe("v-near");
    expect(results[0].postcodeMatch).toBe(true);
    // Neither is EXACT/ALIAS purely from the postcode -- both are PREFIX
    // (name-based), postcode only reordered them.
    expect(results[0].matchType).toBe(MATCH_TYPES.PREFIX);
  });

  it("a postcode match alone (no name relationship at all) never surfaces a candidate", () => {
    const unrelatedName = { id: "v-unrelated", name: "Talking Heads", city: "Southampton", postcode: "SO14 2NY" };
    const results = rankVenueCandidates("Platform Tavern", [unrelatedName], { postcode: "SO14 2NY" });
    expect(results).toEqual([]);
  });
});

describe("rankVenueCandidates -- misc", () => {
  it("returns an empty array for an empty/whitespace-only query", () => {
    expect(rankVenueCandidates("", [platformTavern])).toEqual([]);
    expect(rankVenueCandidates("   ", [platformTavern])).toEqual([]);
  });

  it("returns an empty array when there are no candidates", () => {
    expect(rankVenueCandidates("Platform", [])).toEqual([]);
    expect(rankVenueCandidates("Platform", undefined)).toEqual([]);
  });

  it("tolerates candidates with no address/postcode/similarity_score (current search_entities contract)", () => {
    const bare = { id: "v-bare", name: "Platform Tavern", city: "Southampton" };
    const results = rankVenueCandidates("Platform", [bare]);
    expect(results[0].matchType).toBe(MATCH_TYPES.PREFIX);
    expect(results[0].postcodeMatch).toBeNull();
  });
});
