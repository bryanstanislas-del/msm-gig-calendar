import { describe, it, expect } from "vitest";
import { normalizeCityKey, buildCityOptions, gigMatchesCityFilter } from "./App";

// Regression coverage for the CITY filter whitespace/case normalization
// fix -- see normalizeCityKey/buildCityOptions/gigMatchesCityFilter in
// App.jsx, and the City/Location data audit that found free-text
// gigs.city values silently fragmenting the public "Search by City"
// dropdown (e.g. "Southampton" vs "Southampton " appearing as two
// separate, mutually-exclusive options).

const gig = (id, city) => ({ id, band_name: `Band ${id}`, venue: "Venue", city, date: "2026-09-01" });

describe("normalizeCityKey", () => {
  it("collapses trailing whitespace", () => {
    expect(normalizeCityKey("Southampton ")).toBe(normalizeCityKey("Southampton"));
  });

  it("collapses leading whitespace", () => {
    expect(normalizeCityKey(" Southampton")).toBe(normalizeCityKey("Southampton"));
  });

  it("collapses repeated internal whitespace", () => {
    expect(normalizeCityKey("Everton,  Nr  Lymington")).toBe(normalizeCityKey("Everton, Nr Lymington"));
  });

  it("compares case-insensitively", () => {
    expect(normalizeCityKey(" PORTSMOUTH ")).toBe(normalizeCityKey("Portsmouth"));
  });

  it("does not strip punctuation", () => {
    expect(normalizeCityKey("Town Quay Southampton")).not.toBe(normalizeCityKey("Town Quay, Southampton"));
  });

  it("returns an empty key for null/undefined/blank city", () => {
    expect(normalizeCityKey(null)).toBe("");
    expect(normalizeCityKey(undefined)).toBe("");
    expect(normalizeCityKey("")).toBe("");
    expect(normalizeCityKey("   ")).toBe("");
  });
});

describe("buildCityOptions", () => {
  it("collapses whitespace-only duplicates into a single option", () => {
    const gigs = [gig(1, "Southampton"), gig(2, "Southampton "), gig(3, "Portsmouth"), gig(4, " PORTSMOUTH ")];
    const options = buildCityOptions(gigs);
    expect(options).toEqual(["All", "Portsmouth", "Southampton"]);
  });

  it("keeps punctuation-distinct locality values separate", () => {
    const gigs = [gig(1, "Town Quay Southampton"), gig(2, "Town Quay, Southampton")];
    const options = buildCityOptions(gigs);
    expect(options).toContain("Town Quay Southampton");
    expect(options).toContain("Town Quay, Southampton");
    expect(options.length).toBe(3); // "All" + the two distinct values
  });

  it("keeps genuinely different localities separate", () => {
    const gigs = [gig(1, "Botley"), gig(2, "Curdridge"), gig(3, "Southampton")];
    const options = buildCityOptions(gigs);
    expect(options).toEqual(["All", "Botley", "Curdridge", "Southampton"]);
  });

  it("skips blank/null city values instead of producing a broken option", () => {
    const gigs = [gig(1, "Southampton"), gig(2, null), gig(3, ""), gig(4, "   "), gig(5, undefined)];
    const options = buildCityOptions(gigs);
    expect(options).toEqual(["All", "Southampton"]);
    expect(options).not.toContain("");
    expect(options).not.toContain(null);
  });

  it("labels the collapsed option with a whitespace-cleaned form, not a raw stray-whitespace variant", () => {
    const gigs = [gig(1, "Southampton "), gig(2, "Southampton")];
    const options = buildCityOptions(gigs);
    expect(options).toContain("Southampton");
    expect(options.some(o => o !== "Southampton" && o !== "All")).toBe(false);
  });
});

describe("gigMatchesCityFilter", () => {
  it("matches all raw variants that normalize to the selected city", () => {
    const gigs = [gig(1, "Southampton"), gig(2, "Southampton "), gig(3, "Portsmouth")];
    const matched = gigs.filter(g => gigMatchesCityFilter(g, "Southampton"));
    expect(matched.map(g => g.id)).toEqual([1, 2]);
  });

  it("matches case-insensitively", () => {
    expect(gigMatchesCityFilter(gig(1, " PORTSMOUTH "), "Portsmouth")).toBe(true);
  });

  it("does not match a punctuation-distinct locality", () => {
    expect(gigMatchesCityFilter(gig(1, "Town Quay Southampton"), "Town Quay, Southampton")).toBe(false);
  });

  it("does not match a genuinely different locality", () => {
    expect(gigMatchesCityFilter(gig(1, "Botley"), "Southampton")).toBe(false);
  });

  it("returns true for every gig when the filter is \"All\"", () => {
    expect(gigMatchesCityFilter(gig(1, "Southampton"), "All")).toBe(true);
    expect(gigMatchesCityFilter(gig(1, null), "All")).toBe(true);
  });
});
