import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseDateWithConfidence,
  detectContextYear,
  detectFestivalOrTribute,
  detectCancelled,
  detectPostponed,
  detectRescheduled,
  detectSoldOut,
  extractGenericDashList,
  extractMsmGigGuide,
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

  it("flags cancelled/postponed/rescheduled/sold-out as independent structured flags, not a single merged one", () => {
    const rows = extractGenericDashList([
      "5 July - The Brook, Southampton - CANCELLED",
      "6 July - The Brook, Southampton - Postponed",
      "7 July - The Brook, Southampton - Rescheduled to 20 July",
      "8 July - The Brook, Southampton - SOLD OUT",
      "9 July - The Brook, Southampton",
    ].join("\n"));
    expect(rows).toHaveLength(5);
    expect(rows[0].fields).toMatchObject({ isCancelled: true, isPostponed: false, isRescheduled: false, isSoldOut: false });
    expect(rows[1].fields).toMatchObject({ isCancelled: false, isPostponed: true, isRescheduled: false, isSoldOut: false });
    expect(rows[2].fields).toMatchObject({ isCancelled: false, isPostponed: false, isRescheduled: true, isSoldOut: false });
    expect(rows[3].fields).toMatchObject({ isCancelled: false, isPostponed: false, isRescheduled: false, isSoldOut: true });
    expect(rows[4].fields).toMatchObject({ isCancelled: false, isPostponed: false, isRescheduled: false, isSoldOut: false });
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

describe("event status flags (structured, one boolean per status)", () => {
  it("detectCancelled flags 'cancelled' and 'canceled', case-insensitively", () => {
    expect(detectCancelled("Some Gig - Cancelled")).toBe(true);
    expect(detectCancelled("Some Gig - canceled")).toBe(true);
    expect(detectCancelled("Biohazard")).toBe(false);
  });
  it("detectPostponed flags 'postponed', case-insensitively", () => {
    expect(detectPostponed("A Skylit Drive - POSTPONED")).toBe(true);
    expect(detectPostponed("Biohazard")).toBe(false);
  });
  it("detectRescheduled flags 'rescheduled', case-insensitively", () => {
    expect(detectRescheduled("Some Gig - RESCHEDULED to 5th July")).toBe(true);
    expect(detectRescheduled("Biohazard")).toBe(false);
  });
  it("detectSoldOut flags 'sold out' (with or without a hyphen/space), case-insensitively", () => {
    expect(detectSoldOut("Some Gig - SOLD OUT")).toBe(true);
    expect(detectSoldOut("Some Gig - Sold-Out")).toBe(true);
    expect(detectSoldOut("Biohazard")).toBe(false);
  });
  it("the four flags are independent -- a title can match more than one, or none", () => {
    expect(detectCancelled("Postponed then later Cancelled")).toBe(true);
    expect(detectPostponed("Postponed then later Cancelled")).toBe(true);
    expect(detectRescheduled("Postponed then later Cancelled")).toBe(false);
    expect(detectSoldOut("Postponed then later Cancelled")).toBe(false);
  });
});

describe("detectSourceProfile", () => {
  it("falls back to generic-dash-list when no 'View Details' structural signature is present", () => {
    const profile = detectSourceProfile("anything at all");
    expect(profile.id).toBe("generic-dash-list");
    expect(profile.version).toBe(PROFILES.find((p) => p.id === "generic-dash-list").version);
    expect(typeof profile.matchConfidence).toBe("number");
    expect(typeof profile.matchReason).toBe("string");
    expect(typeof profile.extract).toBe("function");
  });

  it("matches msm-gig-guide when 'View Details' marker lines appear at least twice, on the current 5-line (title/date/venue/address) record structure", () => {
    const text = "Biohazard\n5th August 2026\nSouthampton 1865\nBrunswick Square\nView Details\nCrypta\n13th August 2026\nSouthampton 1865\nBrunswick Square\nView Details";
    const profile = detectSourceProfile(text);
    expect(profile.id).toBe("msm-gig-guide");
    expect(profile.matchConfidence).toBeGreaterThan(0);
    expect(profile.matchReason).toMatch(/View Details/);
  });

  it("does not match msm-gig-guide on a single 'View Details' occurrence (too weak a signature to trust)", () => {
    const text = "12 June 2026 - The Wig & Quill, Salisbury\nView Details";
    const profile = detectSourceProfile(text);
    expect(profile.id).toBe("generic-dash-list");
  });

  it("does not false-match msm-gig-guide on unrelated pasted text that merely repeats the phrase 'View Details' with no dates nearby", () => {
    // e.g. a copied product-listing page where every item has its own
    // "View Details" button, but nothing date-shaped sits near it.
    const text = [
      "Wireless Headphones",
      "In stock, ships today",
      "Free delivery",
      "£49.99",
      "View Details",
      "Bluetooth Speaker",
      "In stock, ships today",
      "Free delivery",
      "£29.99",
      "View Details",
    ].join("\n");
    const profile = detectSourceProfile(text);
    expect(profile.id).toBe("generic-dash-list");
  });
});

describe("extractMsmGigGuide (fixture-driven, real Gig Guide sample)", () => {
  const rows = extractMsmGigGuide(fixture("msm-gig-guide-sample.txt"));

  it("extracts exactly one row per 'View Details' marker, ignoring all page furniture", () => {
    const viewDetailsCount = (fixture("msm-gig-guide-sample.txt").match(/View Details/g) || []).length;
    expect(viewDetailsCount).toBe(226);
    expect(rows).toHaveLength(226);
  });

  it("extracts the complete event title, date and joined venue block for a simple row", () => {
    const row = rows.find((r) => r.fields.artistName === "Biohazard");
    expect(row.fields).toMatchObject({
      artistName: "Biohazard",
      date: "2026-08-05",
      dateRaw: "5th August 2026",
      venueName: null, // never guessed -- see profile comment in sourceProfiles.js
      city: null,
      venueBlock: "Southampton 1865, Brunswick Square",
    });
    expect(row.status).toBe("ok");
    expect(row.confidence.field.venueName).toBeNull(); // not attempted, not scored
    expect(row.confidence.field.city).toBeNull();
  });

  it("joins the source's own venue and address lines verbatim (comma-separated) rather than decomposing them further, even for tricky brand names with embedded digits/capitals", () => {
    // The live site delimits venue from address with a real line break --
    // no split heuristic is needed or attempted here. "O2 Academy
    // Bournemouth" / "570 Christchurch Rd" arrive as two clean lines and are
    // simply joined; nothing has to guess where the brand name ends.
    const o2Row = rows.find((r) => r.fields.venueBlock === "O2 Academy Bournemouth, 570 Christchurch Rd");
    expect(o2Row).toBeTruthy();
    const sotonRow = rows.find((r) => r.fields.venueBlock === "Southampton 1865, Brunswick Square");
    expect(sotonRow).toBeTruthy();
    for (const r of rows) {
      expect(r.fields.venueName).toBeNull();
      expect(r.fields.city).toBeNull();
    }
  });

  it("preserves the genuine event data (title/date/venue/address) verbatim in raw, but excludes the 'View Details' furniture marker", () => {
    const row = rows.find((r) => r.fields.artistName === "Biohazard");
    expect(row.raw).toBe("Biohazard\n5th August 2026\nSouthampton 1865\nBrunswick Square");
    expect(row.raw).not.toMatch(/view details/i);
  });

  it("never leaks the 'View Details' furniture marker into any row's raw or fields, even though extraction still uses it internally to find record boundaries", () => {
    for (const row of rows) {
      expect(row.raw.toLowerCase()).not.toContain("view details");
      for (const value of Object.values(row.fields)) {
        if (typeof value === "string") expect(value.toLowerCase()).not.toContain("view details");
      }
    }
  });

  it("removing the 'View Details' furniture marker from the preview does not reduce the number of events extracted -- boundary detection still runs on the unstripped text", () => {
    const viewDetailsCount = (fixture("msm-gig-guide-sample.txt").match(/View Details/g) || []).length;
    expect(rows).toHaveLength(viewDetailsCount);
    expect(rows).toHaveLength(226); // same count as before furniture was stripped from raw
  });

  it("removing the 'View Details' furniture marker from raw does not affect confidence scoring -- scores come only from fields, which are untouched", () => {
    // Every real row has an EXPLICIT date and a non-empty title, so overall
    // confidence is the full weighted average of those two fields (venue/
    // city are never attempted by this profile -- see confidence.js -- and
    // so are excluded from the average, not penalized): 1.0 either way,
    // exactly as it was when raw still contained the marker.
    for (const row of rows) {
      expect(row.confidence.overall).toBe(1);
      expect(row.confidence.field.date).toBe(1);
      expect(row.confidence.field.artistName).toBe(1);
      expect(row.status).toBe("ok");
    }
  });

  it("flags festival/tribute wording in the title", () => {
    const tributeRow = rows.find((r) => r.fields.artistName === "Sleep Broken (Sleep Token Tribute)");
    expect(tributeRow.fields.isFestivalOrTribute).toBe(true);
    const ordinaryRow = rows.find((r) => r.fields.artistName === "Biohazard");
    expect(ordinaryRow.fields.isFestivalOrTribute).toBe(false);
  });

  it("flags postponed wording in the title as a structured status flag, distinct from cancelled/rescheduled/sold out", () => {
    const row = rows.find((r) => r.fields.artistName === "A Skylit Drive / Vampires Everywhere - POSTPONED");
    expect(row).toBeTruthy();
    expect(row.fields.isPostponed).toBe(true);
    expect(row.fields.isCancelled).toBe(false);
    expect(row.fields.isRescheduled).toBe(false);
    expect(row.fields.isSoldOut).toBe(false);
    const postponedRows = rows.filter((r) => r.fields.isPostponed);
    expect(postponedRows).toHaveLength(1);
    const cancelledRows = rows.filter((r) => r.fields.isCancelled);
    expect(cancelledRows).toHaveLength(0);
  });

  it("keeps exact duplicate rows visible and separate -- Sprint 5A does not deduplicate", () => {
    const jamieRows = rows.filter((r) => r.fields.artistName === "Jamie Webster" && r.fields.date === "2026-09-05");
    expect(jamieRows).toHaveLength(2);

    const vampRows = rows.filter((r) => r.fields.artistName === "Transvision Vamp" && r.fields.date === "2026-10-21");
    expect(vampRows).toHaveLength(2);

    const avatarRows = rows.filter((r) => r.fields.artistName === "Avatar" && r.fields.date === "2026-11-21");
    expect(avatarRows).toHaveLength(2);
  });

  it("keeps capitalisation-only duplicate rows visible and separate", () => {
    const overpassRows = rows.filter((r) => r.fields.artistName?.toLowerCase() === "overpass" && r.fields.date === "2026-11-10");
    expect(overpassRows).toHaveLength(2);
    expect(overpassRows.map((r) => r.fields.artistName).sort()).toEqual(["Overpass", "overpass"]);
  });

  it("keeps near-duplicate rows (location text appended to the title) visible and separate", () => {
    const dayFeverBournemouth = rows.filter((r) => r.fields.date === "2026-09-26" && r.fields.artistName?.startsWith("Day Fever"));
    expect(dayFeverBournemouth.map((r) => r.fields.artistName).sort()).toEqual(["Day Fever", "Day Fever - Bournemouth"]);

    const dayFeverSouthampton = rows.filter((r) => r.fields.date === "2026-10-10" && r.fields.artistName?.startsWith("Day Fever"));
    expect(dayFeverSouthampton.map((r) => r.fields.artistName).sort()).toEqual(["Day Fever", "Day Fever - Southampton"]);
  });

  it("does not fabricate a row from the mid-list 'Promote Your Event' / 'Add Your Event' furniture block", () => {
    const promoRow = rows.find((r) => (r.fields.artistName || "").includes("Promote Your Event") || (r.fields.artistName || "").includes("Add Your Event"));
    expect(promoRow).toBeUndefined();
  });

  it("every row status is 'ok': title+date resolved with full confidence, venue decomposition deferred (not penalized)", () => {
    for (const r of rows) expect(r.status).toBe("ok");
  });

  it("matches the hand-verified expected JSON fixture row-for-row at every checked index", () => {
    const expected = JSON.parse(fixture("expected/msm-gig-guide-sample.expected.json"));
    expect(rows).toHaveLength(expected.rowCount);
    for (const expectedRow of expected.rows) {
      const actual = rows[expectedRow.index];
      if (expectedRow.raw) expect(actual.raw).toBe(expectedRow.raw);
      expect(actual.fields).toMatchObject(expectedRow.fields);
      expect(actual.status).toBe(expectedRow.status);
    }
  });
});
