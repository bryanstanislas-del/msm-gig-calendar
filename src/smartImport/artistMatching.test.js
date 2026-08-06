import { describe, it, expect } from "vitest";
import { deriveArtistQuery, classifyArtistMatch } from "./artistMatching.js";

const profiles = [
  { id: "p1", band_name: "The Mafia", city: "Southampton", profile_type: "band" },
  { id: "p2", band_name: "Jamie Webster", city: "Liverpool", profile_type: "solo_artist" },
  { id: "p3", band_name: "MSM Festival", city: "Southampton", profile_type: "festival" },
];

describe("deriveArtistQuery", () => {
  it("returns applicable:false with a null query when artistName was never attempted (generic-dash-list rows)", () => {
    expect(deriveArtistQuery({ artistName: null })).toEqual({ query: null, applicable: false });
  });

  it("returns applicable:true and strips status wording when artistName is present", () => {
    expect(deriveArtistQuery({ artistName: "The Mafia (CANCELLED)" })).toEqual({ query: "The Mafia", applicable: true });
  });
});

describe("classifyArtistMatch", () => {
  it("tier 'not_applicable' when the row never attempted an artist name", () => {
    const result = classifyArtistMatch({ artistName: null }, profiles);
    expect(result.tier).toBe("not_applicable");
  });

  it("tier 'exact' on a normalised band_name match, case/whitespace-insensitive", () => {
    const result = classifyArtistMatch({ artistName: "the   mafia" }, profiles);
    expect(result.tier).toBe("exact");
    expect(result.match).toEqual({ id: "p1", name: "The Mafia", city: "Southampton", profileType: "band" });
  });

  it("matches solo_artist profiles as well as band profiles", () => {
    const result = classifyArtistMatch({ artistName: "Jamie Webster" }, profiles);
    expect(result.tier).toBe("exact");
    expect(result.match.profileType).toBe("solo_artist");
  });

  it("does not match a festival profile (out of scope for artist matching)", () => {
    const result = classifyArtistMatch({ artistName: "MSM Festival" }, profiles);
    expect(result.tier).not.toBe("exact");
  });

  it("strips status wording before matching so a flagged row still finds its exact match", () => {
    const result = classifyArtistMatch({ artistName: "The Mafia - POSTPONED" }, profiles);
    expect(result.tier).toBe("exact");
    expect(result.match.id).toBe("p1");
  });

  it("tier 'fuzzy' with sorted candidates when there's no exact match", () => {
    const fuzzyCandidates = [
      { id: "p5", name: "The Mafiosos", city: "Southampton", similarity_score: 0.4 },
      { id: "p6", name: "Mafia Kings", city: "Southampton", similarity_score: 0.5 },
    ];
    const result = classifyArtistMatch({ artistName: "Mafia" }, profiles, fuzzyCandidates);
    expect(result.tier).toBe("fuzzy");
    expect(result.candidates.map((c) => c.id)).toEqual(["p6", "p5"]);
  });

  it("tier 'none' (not 'fuzzy') when every candidate falls below MIN_FUZZY_SIMILARITY", () => {
    const fuzzyCandidates = [{ id: "p5", name: "The Mafiosos", city: "Southampton", similarity_score: 0.28 }];
    const result = classifyArtistMatch({ artistName: "Mafia" }, profiles, fuzzyCandidates);
    expect(result.tier).toBe("none");
    expect(result.candidates).toEqual([]);
  });

  it("tier 'none' with an empty query and no candidates", () => {
    const result = classifyArtistMatch({ artistName: "" }, profiles, []);
    expect(result.tier).toBe("none");
  });

  it("tier 'none' for an unmatched artist with no fuzzy candidates", () => {
    const result = classifyArtistMatch({ artistName: "Totally New Act" }, profiles, []);
    expect(result.tier).toBe("none");
  });
});
