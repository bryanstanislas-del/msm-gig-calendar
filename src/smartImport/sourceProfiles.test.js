import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseDateWithConfidence,
  detectContextYear,
  detectFestivalOrTribute,
  extractGenericDashList,
  detectSourceProfile,
  PROFILES,
} from "./sourceProfiles.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");

describe("parseDateWithConfidence", () => {
  it("scores an explicit day+month+year as EXPLICIT, regardless of format", () => {
    for (const input of ["12 June 2026", "June 12 2026", "12/06/2026", "2026-06-12"]) {
      const { parsed, confidenceTier } = parseDateWithConfidence(input, null);
      expect(confidenceTier).toBe("EXPLICIT");
      expect(parsed).toEqual({ day: 12, month: 5, year: 2026 });
    }
  });

  it("scores day+month with an explicit context year as CONTEXT_YEAR", () => {
    const { parsed, confidenceTier } = parseDateWithConfidence("5 July", 2026);
    expect(confidenceTier).toBe("CONTEXT_YEAR");
    expect(parsed).toEqual({ day: 5, month: 6, year: 2026 });
  });

  it("scores day+month with no context year as INFERRED_YEAR, resolved via next-occurrence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5)); // pinned "now": 5 Aug 2026
    const { parsed, confidenceTier } = parseDateWithConfidence("6 June", null);
    expect(confidenceTier).toBe("INFERRED_YEAR");
    // 6 June 2026 has already passed relative to the pinned "now" -> rolls to 2027
    expect(parsed).toEqual({ day: 6, month: 5, year: 2027 });
    vi.useRealTimers();
  });

  it("scores a full weekday name only as DAY_NAME_ONLY (genuinely ambiguous)", () => {
    const { confidenceTier } = parseDateWithConfidence("saturday", null);
    expect(confidenceTier).toBe("DAY_NAME_ONLY");
  });

  it("does NOT resolve an abbreviated weekday + day-of-month with no month (pre-existing gap, preserved from the production parser this was ported from)", () => {
    const { parsed, confidenceTier } = parseDateWithConfidence("Sat 5th", 2026);
    expect(parsed).toBeNull();
    expect(confidenceTier).toBe("UNPARSEABLE");
  });

  it("returns UNPARSEABLE for text with no recognizable date", () => {
    const { parsed, confidenceTier } = parseDateWithConfidence("not a date", null);
    expect(parsed).toBeNull();
    expect(confidenceTier).toBe("UNPARSEABLE");
  });
});

describe("detectContextYear", () => {
  it("reads a 'Month YYYY' heading", () => {
    expect(detectContextYear("July 2026")).toBe(2026);
    expect(detectContextYear("July 2026 Dates")).toBe(2026);
  });

  it("reads a standalone 4-digit year", () => {
    expect(detectContextYear("2026 Dates")).toBe(2026);
  });

  it("returns null when no year is present", () => {
    expect(detectContextYear("Upcoming Shows")).toBeNull();
  });
});

describe("detectFestivalOrTribute", () => {
  it("flags 'festival' and 'tribute', case-insensitively", () => {
    expect(detectFestivalOrTribute("Meadow Sounds Festival")).toBe(true);
    expect(detectFestivalOrTribute("Queen TRIBUTE Night")).toBe(true);
  });
  it("does not flag an ordinary gig line", () => {
    expect(detectFestivalOrTribute("The Obelisk, Woolston")).toBe(false);
  });
});

describe("extractGenericDashList (fixture-driven)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5)); // pinned "now": 5 Aug 2026, for INFERRED_YEAR cases
  });
  afterEach(() => vi.useRealTimers());

  it("parses generic-dash-list-basic.txt: 3 valid rows, year inferred to next occurrence", () => {
    const rows = extractGenericDashList(fixture("generic-dash-list-basic.txt"));
    expect(rows).toHaveLength(3);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].fields).toMatchObject({ date: "2027-06-06", venueName: "The Obelisk", city: "Woolston", artistName: null });
    expect(rows[1].fields).toMatchObject({ date: "2027-06-13", venueName: "Hothampton Arms", city: "Bognor" });
    expect(rows[2].fields).toMatchObject({ date: "2027-06-26", venueName: "The Heroes", city: "Waterlooville" });
    for (const r of rows) expect(r.confidence.field.artistName).toBeNull();
  });

  it("parses generic-dash-list-with-times.txt: explicit dates/times, full confidence", () => {
    const rows = extractGenericDashList(fixture("generic-dash-list-with-times.txt"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "ok" });
    expect(rows[0].fields).toMatchObject({ date: "2026-06-12", venueName: "The Wig & Quill", city: "Salisbury", time: "21:00" });
    expect(rows[0].confidence.overall).toBe(1);
    expect(rows[1].fields).toMatchObject({ date: "2026-12-25", venueName: "Christmas Special", city: "Portsmouth", time: "20:30" });
  });

  it("parses generic-dash-list-year-heading.txt: a 'Month YYYY' heading supplies the year for subsequent day+month lines", () => {
    const rows = extractGenericDashList(fixture("generic-dash-list-year-heading.txt"));
    expect(rows).toHaveLength(2); // the heading line itself produces no row
    expect(rows[0].fields).toMatchObject({ date: "2026-07-05", venueName: "The Brook", city: "Southampton" });
    expect(rows[1].fields).toMatchObject({ date: "2026-07-11", venueName: "The Joiners", city: "Southampton" });
    for (const r of rows) expect(r.confidence.field.date).toBe(0.8); // CONTEXT_YEAR tier
  });

  it("parses malformed-mixed.txt: one ok, two unparseable, one needs_review, without throwing", () => {
    const rows = extractGenericDashList(fixture("malformed-mixed.txt"));
    expect(rows).toHaveLength(4);
    expect(rows[0].status).toBe("ok");
    expect(rows[1].status).toBe("unparseable"); // no separator at all
    expect(rows[1].issues).toContain("Can't find separator");
    expect(rows[2].status).toBe("unparseable"); // trailing dash, nothing after it
    expect(rows[3].status).toBe("needs_review"); // date+venue present, but no city (no comma to split on)
    expect(rows[3].fields.city).toBeNull();
  });

  it("parses festival-tribute-flagging.txt: keyword heuristic flags festival/tribute rows, leaves an ordinary row unflagged", () => {
    const rows = extractGenericDashList(fixture("festival-tribute-flagging.txt"));
    expect(rows).toHaveLength(3);
    expect(rows[0].fields.isFestivalOrTribute).toBe(true);
    expect(rows[1].fields.isFestivalOrTribute).toBe(true);
    expect(rows[2].fields.isFestivalOrTribute).toBe(false);
    for (const r of rows) expect(r.status).toBe("ok");
  });
});

describe("detectSourceProfile", () => {
  it("always resolves to the generic-dash-list fallback for Sprint 5A (no other profiles registered yet)", () => {
    const profile = detectSourceProfile("anything at all");
    expect(profile.id).toBe("generic-dash-list");
    expect(profile.version).toBe(PROFILES.find((p) => p.id === "generic-dash-list").version);
    expect(typeof profile.matchConfidence).toBe("number");
    expect(typeof profile.matchReason).toBe("string");
    expect(typeof profile.extract).toBe("function");
  });
});
