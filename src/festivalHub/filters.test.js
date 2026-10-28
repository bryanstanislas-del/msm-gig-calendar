import { describe, it, expect } from "vitest";
import { DEFAULT_FILTERS, applyFilters, genresOf, regionsOf, isDefaultFilters } from "./filters.js";
import { CURATED_LISTINGS } from "./curatedListings.js";
import { STATUS } from "./status.js";

const now = new Date("2026-10-27T12:00:00Z");
const run = (patch = {}, savedIds) => applyFilters(CURATED_LISTINGS, { ...DEFAULT_FILTERS, ...patch }, { now, savedIds });
const ids = (r) => r.map((x) => x.listing.id);

describe("applyFilters (real directory on the check date)", () => {
  it("defaults return everything, open first then soonest deadline", () => {
    const r = run();
    expect(r).toHaveLength(26);
    expect(ids(r).slice(0, 3)).toEqual(["hanwell-hootie", "kelburn-garden-party", "buckle-and-boots"]);
    expect(r.at(-1).info.status).toBe(STATUS.CLOSED);
  });
  it("status filter counts", () => {
    expect(run({ status: STATUS.OPEN })).toHaveLength(13);
    expect(run({ status: STATUS.UNVERIFIED })).toHaveLength(7);
    expect(run({ status: STATUS.CLOSED })).toHaveLength(4);
  });
  it("region filter", () => {
    expect(ids(run({ region: "Scotland" })).sort()).toEqual(["butefest", "kelburn-garden-party"]);
  });
  it("genre filter includes 'All genres' festivals but not unknown-genre ones", () => {
    const jazz = ids(run({ genre: "Jazz" })).sort();
    expect(jazz).toEqual(["focus-wales", "kelburn-garden-party", "mostly-jazz-funk-and-soul", "the-great-escape"]);
    expect(genresOf(CURATED_LISTINGS)).not.toContain("All genres");
  });
  it("deadline window matches only open listings with a published deadline", () => {
    expect(ids(run({ deadline: "7" }))).toEqual([]);
    expect(ids(run({ deadline: "90" }))).toEqual(["hanwell-hootie", "kelburn-garden-party", "buckle-and-boots"]);
  });
  it("search and shortlist", () => {
    expect(ids(run({ search: "  dorset " })).sort()).toEqual(["dorsetfest", "teddy-rocks"]);
    expect(ids(run({ savedOnly: true }, new Set(["twyfest"])))).toEqual(["twyfest"]);
    expect(run({ savedOnly: true })).toHaveLength(0);
  });
  it("option lists and default detection", () => {
    expect(regionsOf(CURATED_LISTINGS)).toContain("Northern Ireland");
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, region: "Wales" })).toBe(false);
  });
});
