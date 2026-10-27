import { describe, it, expect } from "vitest";
import { ALL, DEFAULT_FILTERS, applyFilters, genresOf, regionsOf, isDefaultFilters } from "./filters.js";
import { DEMO_LISTINGS } from "./demoFixtures.js";
import { STATUS } from "./status.js";

const TODAY = "2026-10-27";
const run = (patch = {}, savedIds) => applyFilters(DEMO_LISTINGS, { ...DEFAULT_FILTERS, ...patch }, { today: TODAY, savedIds });
const ids = (r) => r.map((x) => x.listing.id);

describe("applyFilters", () => {
  it("default filters return every listing, open first, soonest deadline first", () => {
    const r = run();
    expect(r).toHaveLength(DEMO_LISTINGS.length);
    expect(ids(r).slice(0, 3)).toEqual(["demo-coastline", "demo-northfields", "demo-midlands"]);
    expect(r.at(-1).info.status).toBe(STATUS.CLOSED);
  });
  it("filters by region, genre and status, and combines them", () => {
    expect(ids(run({ region: "Scotland" }))).toEqual(["demo-highland"]);
    expect(ids(run({ genre: "Indie" })).sort()).toEqual(["demo-harbour", "demo-moorland", "demo-northfields"]);
    expect(ids(run({ status: STATUS.NOT_YET_OPEN })).sort()).toEqual(["demo-harbour", "demo-highland"]);
    expect(ids(run({ status: STATUS.UNVERIFIED })).sort()).toEqual(["demo-moorland", "demo-riverside"]);
    expect(ids(run({ genre: "Indie", status: STATUS.OPEN }))).toEqual(["demo-northfields"]);
    expect(run({ region: "Wales", status: STATUS.OPEN })).toHaveLength(0);
  });
  it("deadline window only matches open listings closing within N days", () => {
    expect(ids(run({ deadline: "7" }))).toEqual([]);
    expect(ids(run({ deadline: "30" }))).toEqual(["demo-coastline"]);
    expect(ids(run({ deadline: "90" }))).toEqual(["demo-coastline", "demo-northfields"]);
  });
  it("search is case-insensitive over name, region, location and genres", () => {
    expect(ids(run({ search: "  HIGHLAND " }))).toEqual(["demo-highland"]);
    expect(ids(run({ search: "hip-hop" }))).toEqual(["demo-midlands"]);
    expect(run({ search: "no such thing" })).toHaveLength(0);
  });
  it("shortlist-only uses saved ids", () => {
    expect(run({ savedOnly: true })).toHaveLength(0);
    expect(ids(run({ savedOnly: true }, new Set(["demo-valleys"])))).toEqual(["demo-valleys"]);
  });
  it("option lists and default detection", () => {
    expect(regionsOf(DEMO_LISTINGS)).toContain("Northern Ireland");
    expect(genresOf(DEMO_LISTINGS)).toEqual([...genresOf(DEMO_LISTINGS)].sort((a, b) => a.localeCompare(b)));
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, region: "Wales" })).toBe(false);
    expect(DEFAULT_FILTERS.region).toBe(ALL);
  });
});
