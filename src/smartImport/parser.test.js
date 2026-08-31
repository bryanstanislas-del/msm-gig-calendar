import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseImportText } from "./parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");

describe("parseImportText", () => {
  it("returns an empty result, not an error, for empty/whitespace-only input", () => {
    for (const input of ["", "   ", "\n\n"]) {
      const result = parseImportText(input);
      expect(result.rows).toEqual([]);
      expect(result.sourceProfile).toBeNull();
      expect(result.stats).toEqual({ totalInputLines: 0, parsedRows: 0, skippedFurniture: 0, malformed: 0 });
    }
  });

  describe("CSV/TSV path", () => {
    it("auto-detects CSV, maps headers, and stamps sourceProfile metadata (id/version/confidence/reason)", () => {
      const result = parseImportText(fixture("csv-basic.csv"));
      expect(result.detectedFormat).toBe("csv");
      expect(result.rows).toHaveLength(2);
      expect(result.rows.every((r) => r.status === "ok")).toBe(true);
      expect(result.sourceProfile).toMatchObject({ id: "csv-delimited", version: "1.0.0", matchConfidence: 1 });
      expect(typeof result.sourceProfile.matchReason).toBe("string");
      expect(result.stats).toEqual({ totalInputLines: 2, parsedRows: 2, skippedFurniture: 0, malformed: 0 });
    });

    it("auto-detects TSV over CSV and assigns unique, stable row ids", () => {
      const result = parseImportText(fixture("tsv-basic.tsv"));
      expect(result.detectedFormat).toBe("tsv");
      expect(result.sourceProfile.id).toBe("tsv-delimited");
      expect(result.rows.map((r) => r.id)).toEqual(["row-0", "row-1"]);
    });

    it("preserves a comma embedded in a quoted CSV field as one value", () => {
      const result = parseImportText(fixture("csv-quoted-commas.csv"));
      expect(result.rows[0].fields.venueName).toBe("The Wig & Quill, 1 New Street");
    });

    it("flags every row when no header is recognized, via positional fallback", () => {
      const result = parseImportText("The Mafia,The Obelisk,Woolston,2026-06-06,20:00");
      expect(result.sourceProfile.matchReason).toMatch(/positionally/);
      expect(result.rows[0].issues.some((i) => i.includes("No header row detected"))).toBe(true);
    });

    it("respects an explicit format override instead of auto-sniffing", () => {
      const result = parseImportText("a,b,c", { format: "text" });
      expect(result.detectedFormat).toBe("text");
    });

    it("flags cancelled/postponed/rescheduled/sold-out as independent structured flags in a CSV row's artist/notes text", () => {
      const csv = "Artist,Venue,City,Date,Notes\nThe Mafia (CANCELLED),The Obelisk,Woolston,2026-06-06,Rescheduled from May";
      const result = parseImportText(csv);
      expect(result.rows[0].fields).toMatchObject({ isCancelled: true, isPostponed: false, isRescheduled: true, isSoldOut: false });
    });

    describe("optional Venue Address column (structured bulk imports)", () => {
      it("maps an explicit Address header into fields.venueAddress", () => {
        const csv = "Artist,Venue,Address,City,Date,Time\nThe Mafia,Southampton 1865,Above Bar Street,Southampton,2026-06-06,20:00";
        const result = parseImportText(csv);
        expect(result.rows[0].fields.venueAddress).toBe("Above Bar Street");
      });

      it("leaves fields.venueAddress null when no Address column is present -- existing 5-column CSVs are unaffected", () => {
        const result = parseImportText(fixture("csv-basic.csv"));
        expect(result.rows.every((r) => r.fields.venueAddress === null)).toBe(true);
        expect(result.rows.every((r) => r.status === "ok")).toBe(true);
      });
    });

    describe("optional Genre column", () => {
      it("passes through a recognized genre value, canonicalized to the taxonomy's casing", () => {
        const csv = "Artist,Venue,City,Date,Time,Genre\nThe Mafia,The Obelisk,Woolston,2026-06-06,20:00,blues";
        const result = parseImportText(csv);
        expect(result.rows[0].fields.genre).toBe("Blues");
        expect(result.rows[0].issues.some((i) => /genre/i.test(i))).toBe(false);
      });

      it("assigns no genre (null) when the Genre column is absent -- existing 5-column CSVs are unaffected", () => {
        const result = parseImportText(fixture("csv-basic.csv"));
        expect(result.rows.every((r) => r.fields.genre === null)).toBe(true);
        expect(result.rows.every((r) => r.status === "ok")).toBe(true);
      });

      it("assigns no genre when the Genre cell is blank", () => {
        const csv = "Artist,Venue,City,Date,Time,Genre\nThe Mafia,The Obelisk,Woolston,2026-06-06,20:00,";
        const result = parseImportText(csv);
        expect(result.rows[0].fields.genre).toBeNull();
      });

      it("assigns no genre and flags an issue for an unrecognized genre value, without dropping the row", () => {
        const csv = "Artist,Venue,City,Date,Time,Genre\nThe Mafia,The Obelisk,Woolston,2026-06-06,20:00,Not A Real Genre";
        const result = parseImportText(csv);
        expect(result.rows[0].fields.genre).toBeNull();
        expect(result.rows[0].issues.some((i) => i.includes("Unrecognized genre"))).toBe(true);
      });

      it("supports the optional 6th positional Genre column when no header row is present", () => {
        const csv = "Fleetingwood Mac,The Wedgewood Rooms,Portsmouth,2026-12-04,19:30,Tribute";
        const result = parseImportText(csv);
        expect(result.rows[0].fields.genre).toBe("Tribute");
      });
    });
  });

  describe("text path", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 7, 5));
    });
    afterEach(() => vi.useRealTimers());

    it("parses generic-dash-list-basic.txt end-to-end with the generic-dash-list source profile", () => {
      const result = parseImportText(fixture("generic-dash-list-basic.txt"));
      expect(result.detectedFormat).toBe("text");
      expect(result.sourceProfile.id).toBe("generic-dash-list");
      expect(result.rows).toHaveLength(3);
      expect(result.stats).toEqual({ totalInputLines: 3, parsedRows: 3, skippedFurniture: 0, malformed: 0 });
    });

    it("filters obvious page furniture out of a whole-webpage paste, keeps ambiguous short lines as visible unparseable rows, and reports accurate stats", () => {
      const result = parseImportText(fixture("webpage-copy-with-furniture.txt"));
      expect(result.detectedFormat).toBe("text");
      // 5 nav words survive as unparseable (conservative filtering, see furniture.test.js)
      // + 2 real gig lines parsed "ok" = 7 rows total
      expect(result.rows).toHaveLength(7);
      const okRows = result.rows.filter((r) => r.status === "ok");
      expect(okRows).toHaveLength(2);
      expect(okRows[0].fields.venueName).toBe("The Wig & Quill");
      expect(okRows[1].fields.venueName).toBe("The Cabin");
      // discarded: ©-line, Privacy Policy, Terms and Conditions, 3x "Follow us", 1 URL = 7
      expect(result.stats.skippedFurniture).toBe(7);
      expect(result.stats.malformed).toBe(5);
      expect(result.stats.parsedRows).toBe(2);
    });

    it("carries malformed rows through without throwing, matching per-row status expectations", () => {
      const result = parseImportText(fixture("malformed-mixed.txt"));
      expect(result.rows).toHaveLength(4);
      expect(result.rows.map((r) => r.status)).toEqual(["ok", "unparseable", "unparseable", "needs_review"]);
      expect(result.stats.malformed).toBe(2);
    });

    it("passes through contextYear/defaultTime options", () => {
      const result = parseImportText("5 July - The Brook, Southampton", { contextYear: 2030, defaultTime: "19:30" });
      expect(result.rows[0].fields.date).toBe("2030-07-05");
      expect(result.rows[0].fields.time).toBe("19:30");
    });

    it("parses the real msm-gig-guide-sample.txt end-to-end: detects msm-gig-guide over the generic-dash-list fallback, extracts every row, skips furniture via marker-anchoring (not the generic filter)", () => {
      const result = parseImportText(fixture("msm-gig-guide-sample.txt"));
      expect(result.detectedFormat).toBe("text");
      expect(result.sourceProfile.id).toBe("msm-gig-guide");
      expect(result.sourceProfile.version).toBe("1.1.0");
      expect(result.sourceProfile.matchConfidence).toBeGreaterThan(0.9);
      expect(result.sourceProfile.matchReason).toMatch(/View Details/);
      expect(result.rows).toHaveLength(226);
      expect(result.rows.every((r) => r.status === "ok")).toBe(true);
      expect(result.stats.parsedRows).toBe(226);
      expect(result.stats.malformed).toBe(0);
      // msm-gig-guide ignores furniture by anchoring on "View Details" rather
      // than running the generic furniture.js filter -- see sourceProfiles.js.
      expect(result.stats.skippedFurniture).toBe(0);
    });

    it("never surfaces the 'View Details' furniture marker anywhere in the parsed output the editor sees, through the full public parseImportText() entry point", () => {
      const result = parseImportText(fixture("msm-gig-guide-sample.txt"));
      for (const row of result.rows) {
        expect(row.raw.toLowerCase()).not.toContain("view details");
        for (const value of Object.values(row.fields)) {
          if (typeof value === "string") expect(value.toLowerCase()).not.toContain("view details");
        }
      }
    });
  });

  // Deliberately contains raw control-byte and multi-byte UTF-8 literals
  // (not escaped source text) -- if a plain-text search tool ever reports
  // this file as "binary", that's why; the file itself is not corrupted.
  it("never throws on adversarial input (binary-ish noise, extremely long lines, unicode)", () => {
    const inputs = [
      "  - ",
      "a".repeat(5000) + " - " + "b".repeat(5000),
      "🎸🎤 - 🏟️, 🌆",
      "-,-,-\n,,,,,\n\t\t\t",
    ];
    for (const input of inputs) {
      expect(() => parseImportText(input)).not.toThrow();
    }
  });
});
