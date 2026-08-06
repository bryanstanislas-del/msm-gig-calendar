import { describe, it, expect } from "vitest";
import { deriveVenueQuery, classifyVenueMatch } from "./venueMatching.js";

const venues = [
  { id: "v1", name: "The Brook", name_normalised: "the brook", city: "Southampton" },
  { id: "v2", name: "O2 Academy Bournemouth", name_normalised: "o2 academy bournemouth", city: "Bournemouth" },
  // deliberately ambiguous: same normalised name, two different cities
  { id: "v3", name: "The Cellar", name_normalised: "the cellar", city: "Southampton" },
  { id: "v4", name: "The Cellar", name_normalised: "the cellar", city: "Portsmouth" },
];

describe("deriveVenueQuery", () => {
  it("prefers fields.venueName when present", () => {
    expect(deriveVenueQuery({ venueName: "The Brook", city: "Southampton", venueBlock: null })).toEqual({
      query: "The Brook",
      city: "Southampton",
    });
  });

  it("derives the venue name from venueBlock (text before the first comma), with no city", () => {
    expect(deriveVenueQuery({ venueName: null, city: null, venueBlock: "Southampton 1865, Brunswick Square" })).toEqual({
      query: "Southampton 1865",
      city: null,
    });
  });

  it("strips trailing status wording from the derived query", () => {
    expect(deriveVenueQuery({ venueName: "The Brook - CANCELLED", city: null, venueBlock: null }).query).toBe("The Brook");
  });

  it("returns an empty query when neither venueName nor venueBlock is present", () => {
    expect(deriveVenueQuery({ venueName: null, city: null, venueBlock: null })).toEqual({ query: "", city: null });
  });
});

describe("classifyVenueMatch", () => {
  it("tier 'exact' when normalised name + city match an existing venue", () => {
    const result = classifyVenueMatch({ venueName: "the   brook", city: "SOUTHAMPTON", venueBlock: null }, venues);
    expect(result.tier).toBe("exact");
    expect(result.match).toEqual({ id: "v1", name: "The Brook", city: "Southampton" });
  });

  it("tier 'exact' from a venueBlock-derived name when unambiguous even without a known city", () => {
    const result = classifyVenueMatch(
      { venueName: null, city: null, venueBlock: "O2 Academy Bournemouth, 570 Christchurch Rd" },
      venues
    );
    expect(result.tier).toBe("exact");
    expect(result.match.id).toBe("v2");
  });

  it("does not guess an exact match when the name is ambiguous across cities and no city is known", () => {
    const result = classifyVenueMatch({ venueName: null, city: null, venueBlock: "The Cellar, 1 High St" }, venues);
    expect(result.tier).not.toBe("exact");
  });

  it("tier 'fuzzy' with sorted candidates when there's no exact match but the search returned candidates", () => {
    const fuzzyCandidates = [
      { id: "v9", name: "The Brooke Inn", city: "Southampton", similarity_score: 0.3 },
      { id: "v8", name: "The Brookside", city: "Southampton", similarity_score: 0.6 },
    ];
    const result = classifyVenueMatch({ venueName: "The Brooky", city: "Southampton", venueBlock: null }, venues, fuzzyCandidates);
    expect(result.tier).toBe("fuzzy");
    expect(result.candidates.map((c) => c.id)).toEqual(["v8", "v9"]);
  });

  it("tier 'none' when there's no exact match and no fuzzy candidates", () => {
    const result = classifyVenueMatch({ venueName: "Totally New Place", city: "Nowhere", venueBlock: null }, venues, []);
    expect(result.tier).toBe("none");
  });

  it("tier 'none' when the row has no venue information at all", () => {
    const result = classifyVenueMatch({ venueName: null, city: null, venueBlock: null }, venues, []);
    expect(result.tier).toBe("none");
    expect(result.query).toBe("");
  });
});
