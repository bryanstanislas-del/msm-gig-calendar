import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sniffDelimitedFormat, parseDelimited, COLUMN_ALIASES } from "./csvTsv.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures", name), "utf8");

describe("sniffDelimitedFormat", () => {
  it("detects CSV from a consistent comma-delimited header + rows", () => {
    expect(sniffDelimitedFormat(fixture("csv-basic.csv"))).toBe("csv");
  });

  it("detects TSV, and prefers it over CSV when both could plausibly match", () => {
    expect(sniffDelimitedFormat(fixture("tsv-basic.tsv"))).toBe("tsv");
  });

  it("falls back to 'text' for a free-text paste that only occasionally contains a comma", () => {
    // realistic gig lines like "Venue, City" have exactly one comma each --
    // not enough rows share a consistent column count to look like real CSV.
    expect(sniffDelimitedFormat(fixture("generic-dash-list-basic.txt"))).toBe("text");
  });

  it("falls back to 'text' for empty input", () => {
    expect(sniffDelimitedFormat("")).toBe("text");
    expect(sniffDelimitedFormat("   ")).toBe("text");
  });

  it("falls back to 'text' for an ordinary prose paragraph with multiple commas per sentence", () => {
    // Real page-furniture copy (see webpage-copy-with-furniture.txt-style
    // intro text) routinely has 2-3 commas in a single descriptive sentence
    // -- this must not look like a 3+ column CSV row.
    const prose = "Whether you're a live music fanatic, theatre lover, or fan of comedy, you're at the right place.\nOur extensive event listings feature all kinds of live events, happening worldwide, from small clubs to arenas.\nSearch by location, genre, or keyword, and find your next night out, tonight.";
    expect(sniffDelimitedFormat(prose)).toBe("text");
  });

  it("falls back to 'text' for the real msm-gig-guide-sample.txt fixture (never misdetected as CSV despite comma-bearing addresses like 'PO5 2QJ, UK')", () => {
    expect(sniffDelimitedFormat(fixture("msm-gig-guide-sample.txt"))).toBe("text");
  });
});

describe("parseDelimited", () => {
  it("maps a recognized header row to the right fields, case-insensitively, via aliases", () => {
    const { records, usedPositionalFallback, mapping } = parseDelimited(fixture("csv-basic.csv"), ",");
    expect(usedPositionalFallback).toBe(false);
    expect(mapping).toEqual({ artistName: 0, venueName: 1, city: 2, date: 3, time: 4 });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ artistName: "The Mafia", venueName: "The Obelisk", city: "Woolston", date: "2026-06-06", time: "20:00" });
    expect(records[1]).toMatchObject({ artistName: "Chicago9", venueName: "The Wig & Quill", city: "Salisbury" });
  });

  it("maps a differently-worded header via aliases (Band/Doors instead of Artist/Time)", () => {
    const { records, mapping } = parseDelimited(fixture("tsv-basic.tsv"), "\t");
    expect(mapping).toEqual({ artistName: 0, venueName: 1, city: 2, date: 3, time: 4 });
    expect(records[0]).toMatchObject({ artistName: "The Mafia", time: "20:00" });
  });

  it("keeps a comma embedded inside a quoted field as one value, not an extra column (the reason a proven CSV library is used instead of a naive split)", () => {
    const { records } = parseDelimited(fixture("csv-quoted-commas.csv"), ",");
    expect(records).toHaveLength(1);
    expect(records[0].venueName).toBe("The Wig & Quill, 1 New Street");
    expect(records[0].city).toBe("Salisbury");
  });

  it("falls back to positional column order (Artist, Venue, City, Date, Time) and flags every row when no header is recognized", () => {
    const noHeaderCsv = "The Mafia,The Obelisk,Woolston,2026-06-06,20:00";
    const { records, usedPositionalFallback } = parseDelimited(noHeaderCsv, ",");
    expect(usedPositionalFallback).toBe(true);
    expect(records[0]).toMatchObject({ artistName: "The Mafia", venueName: "The Obelisk", city: "Woolston", date: "2026-06-06", time: "20:00" });
  });

  it("flags a row with fewer columns than the header as a column-count mismatch instead of throwing", () => {
    const shortRowCsv = "Artist,Venue,City,Date,Time\nThe Mafia,The Obelisk,Woolston";
    const { records } = parseDelimited(shortRowCsv, ",");
    expect(records).toHaveLength(1);
    expect(records[0].columnCountMismatch).toBe(true);
    expect(records[0].date).toBeNull();
  });

  it("returns no records (not an error) for empty input", () => {
    expect(parseDelimited("", ",").records).toEqual([]);
  });

  it("unescapes a doubled quote ('\"\"') inside a quoted field back to a single literal quote", () => {
    const csv = 'Artist,Venue,City,Date,Time\nThe Mafia,"The ""Wig & Quill""",Salisbury,2026-06-06,20:00';
    const { records } = parseDelimited(csv, ",");
    expect(records).toHaveLength(1);
    expect(records[0].venueName).toBe('The "Wig & Quill"');
  });

  it("keeps an embedded newline inside a quoted field as part of one cell, not a second row", () => {
    const csv = 'Artist,Venue,City,Date,Time,Notes\nThe Mafia,The Obelisk,Woolston,2026-06-06,20:00,"Line one\nLine two"';
    const { records } = parseDelimited(csv, ",");
    expect(records).toHaveLength(1);
    expect(records[0].notes).toBe("Line one\nLine two");
  });

  it("maps an explicit Genre header column alongside the base five", () => {
    const csv = "Artist,Venue,City,Date,Time,Genre\nThe Mafia,The Obelisk,Woolston,2026-06-06,20:00,Punk";
    const { records, mapping } = parseDelimited(csv, ",");
    expect(mapping.genre).toBe(5);
    expect(records[0].genre).toBe("Punk");
  });

  it("maps an optional 6th positional column to genre when no header is recognized, without flagging ordinary 5-column rows as a mismatch", () => {
    const sixCol = "Fleetingwood Mac,The Wedgewood Rooms,Portsmouth,2026-12-04,19:30,Tribute";
    const { records: sixRecords, usedPositionalFallback } = parseDelimited(sixCol, ",");
    expect(usedPositionalFallback).toBe(true);
    expect(sixRecords[0].genre).toBe("Tribute");
    expect(sixRecords[0].columnCountMismatch).toBe(false);

    // The existing 5-column shape (no genre) must keep working exactly as
    // before -- no genre column attempted, no spurious mismatch flag.
    const fiveCol = "The Mafia,The Obelisk,Woolston,2026-06-06,20:00";
    const { records: fiveRecords } = parseDelimited(fiveCol, ",");
    expect(fiveRecords[0].genre).toBeNull();
    expect(fiveRecords[0].columnCountMismatch).toBe(false);
  });

  it("leaves genre null (not an empty string) when the Genre column exists but the cell is blank", () => {
    const csv = "Artist,Venue,City,Date,Time,Genre\nThe Mafia,The Obelisk,Woolston,2026-06-06,20:00,";
    const { records } = parseDelimited(csv, ",");
    expect(records[0].genre).toBeNull();
  });

  it("every alias variant maps to its target field", () => {
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      for (const alias of aliases) {
        const header = ["x", "y", "z"];
        header[1] = alias;
        const { mapping } = parseDelimited(`${header.join(",")}\nval1,val2,val3`, ",");
        expect(mapping[field]).toBe(1);
      }
    }
  });
});
