import { describe, it, expect } from "vitest";
import { DEMO_LISTINGS } from "./demoFixtures.js";
import { isValidId } from "./storage.js";
import { isValidDateOnly } from "./status.js";

describe("demo fixtures", () => {
  it("are all flagged demo, with unique valid ids", () => {
    const ids = DEMO_LISTINGS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of DEMO_LISTINGS) {
      expect(l.isDemo).toBe(true);
      expect(isValidId(l.id)).toBe(true);
      expect(l.id.startsWith("demo-")).toBe(true);
    }
  });
  it("only link to example.org placeholder pages", () => {
    for (const l of DEMO_LISTINGS) {
      for (const url of [l.applyUrl, l.sourceUrl]) {
        expect(new URL(url).hostname).toBe("example.org");
        expect(url).toMatch(/^https:\/\/example\.org\/festival-hub-demo\//);
      }
    }
  });
  it("use 'Example' names and demo locations, never real festival claims", () => {
    for (const l of DEMO_LISTINGS) {
      expect(l.name).toMatch(/Example/);
      expect(l.location).toMatch(/\(demo\)$/);
      if (l.fee) expect(l.fee).toMatch(/\(example\)$/);
    }
  });
  it("have required fields; dates are date-only or explicitly missing", () => {
    for (const l of DEMO_LISTINGS) {
      expect(l.region && l.name && Array.isArray(l.genres)).toBeTruthy();
      expect(isValidDateOnly(l.festivalDates.start)).toBe(true);
      for (const d of [l.application.opens, l.application.closes, l.lastChecked]) {
        expect(d === null || isValidDateOnly(d)).toBe(true);
      }
    }
  });
  it("application deadline falls before the festival starts, and the festival ends on or after it starts", () => {
    for (const l of DEMO_LISTINGS) {
      const { start, end } = l.festivalDates;
      if (end) expect(end >= start, `${l.id} end before start`).toBe(true);
      const { opens, closes } = l.application;
      if (closes) expect(closes < start, `${l.id} closes ${closes} on/after festival start ${start}`).toBe(true);
      if (opens) expect(opens < start, `${l.id} opens ${opens} on/after festival start ${start}`).toBe(true);
      if (opens && closes) expect(opens <= closes, `${l.id} opens after closes`).toBe(true);
    }
  });
});
