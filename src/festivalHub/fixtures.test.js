import { describe, it, expect } from "vitest";
import { DEMO_LISTINGS } from "./demoFixtures.js";
import { CURATED_LISTINGS } from "./curatedListings.js";
import { validateDirectory } from "./schema.js";
import { applicationStatus, STATUS } from "./status.js";
import { getDirectory, hubBasePath, HUB_FALLBACK_PATH, modeFromSearch, MODES } from "./listings.js";

const NOW = new Date("2026-10-27T12:00:00Z");

describe("demo fixtures", () => {
  it("validate as demo data with no errors", () => {
    const { problems } = validateDirectory(DEMO_LISTINGS, { demo: true, today: "2026-10-27" });
    expect(problems.filter((p) => p.errors.length)).toEqual([]);
  });
  it("are fictional: 'Example' names, demo- ids, example.org links only", () => {
    for (const l of DEMO_LISTINGS) {
      expect(l.isDemo).toBe(true);
      expect(l.id.startsWith("demo-")).toBe(true);
      expect(l.name).toMatch(/Example/);
      const urls = [l.officialUrl, l.application.url, l.application.sourceUrl, l.listingVerification.sourceUrl].filter(Boolean);
      for (const u of urls) expect(new URL(u).hostname).toBe("example.org");
    }
  });
  it("cover every status case", () => {
    const s = Object.fromEntries(DEMO_LISTINGS.map((l) => [l.id, applicationStatus(l, NOW).status]));
    expect(s).toEqual({
      "demo-northfields": STATUS.OPEN, "demo-coastline": STATUS.OPEN, "demo-highland": STATUS.NOT_YET_OPEN,
      "demo-valleys": STATUS.CLOSED, "demo-riverside": STATUS.UNVERIFIED, "demo-moorland": STATUS.OPEN,
      "demo-harbour": STATUS.NOT_YET_ANNOUNCED, "demo-midlands": STATUS.OPEN, "demo-lakeside": STATUS.UNVERIFIED,
      "demo-borders": STATUS.UNVERIFIED,
    });
  });
});

describe("modes never mix", () => {
  it("real and demo directories are disjoint and each validated for its mode", () => {
    const real = getDirectory(MODES.REAL, { today: "2026-10-27" });
    const demo = getDirectory(MODES.DEMO, { today: "2026-10-27" });
    expect(real.listings).toHaveLength(CURATED_LISTINGS.length);
    expect(demo.listings).toHaveLength(DEMO_LISTINGS.length);
    const realIds = new Set(real.listings.map((l) => l.id));
    expect(demo.listings.some((l) => realIds.has(l.id))).toBe(false);
    expect(real.listings.some((l) => l.isDemo)).toBe(false);
  });
  it("demo listings are rejected in real mode and vice versa", () => {
    expect(getDirectory(MODES.REAL, { real: DEMO_LISTINGS, today: "2026-10-27" }).listings).toEqual([]);
    expect(getDirectory(MODES.DEMO, { demo: CURATED_LISTINGS, today: "2026-10-27" }).listings).toEqual([]);
  });
  it("an empty real directory stays empty (no demo fallback)", () => {
    expect(getDirectory(MODES.REAL, { real: [] }).listings).toEqual([]);
  });
  it("only ?demo=1 selects demo mode", () => {
    expect(modeFromSearch("?demo=1")).toBe(MODES.DEMO);
    for (const q of ["", "?demo=0", "?demo=true", "?x=1"]) expect(modeFromSearch(q)).toBe(MODES.REAL);
  });
  it("mode toggles reuse only known hub paths", () => {
    for (const p of ["/", "/festival-hub", "/festival-hub/", "/festival-hub/index.html"]) expect(hubBasePath(p)).toBe(p);
    for (const p of ["//evil.example/", "//evil.example", "/\\evil.example/", "/festival-hub//x", "/festival-hub/x", "/x", "", "festival-hub", "/FESTIVAL-HUB/"]) {
      expect(hubBasePath(p)).toBe(HUB_FALLBACK_PATH);
    }
    expect(HUB_FALLBACK_PATH).toBe("/festival-hub/");
  });
});
