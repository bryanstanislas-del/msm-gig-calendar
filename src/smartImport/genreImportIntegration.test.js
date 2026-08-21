// Regression coverage for a live-smoke-test bug report: a valid genre
// column value (e.g. "Blues") appeared to come out as NULL in the
// Moderation Panel after a full Gig Parse import, even though blank and
// unrecognised genre values correctly became NULL.
//
// Root cause turned out to be a stale deployment (the browser was still
// running pre-fix code that never read a Genre column at all, from before
// this pipeline learned to parse one -- see COLUMN_ALIASES/positional
// fallback in csvTsv.js), not a break in the pipeline itself. This file
// exercises the pipeline as CLOSE to end-to-end as it can go from a plain
// unit test -- parseImportText -> runMatching -> composeResolvedRow ->
// buildGigInsertPayload, the exact same call sequence App.jsx's
// ImportReviewDashboard/ConfirmationSummary/runImport use -- so any future
// regression that drops genre somewhere in that chain (not just at the
// parser boundary, which parser.test.js already covers) fails a test
// instead of only showing up in a live smoke test.
import { describe, it, expect } from "vitest";
import { parseImportText } from "./parser.js";
import { runMatching } from "./runMatching.js";
import { composeResolvedRow } from "./groupResolution.js";
import { buildGigInsertPayload } from "./importEngine.js";
import { deriveRowState } from "./reviewBatch.js";

// Mirrors exactly what ImportReviewDashboard.resolvedBatch does (App.jsx):
// runMatching's output, then composeResolvedRow with no group/row
// decisions, then deriveRowState -- the shape buildGigInsertPayload expects.
async function resolveBatch(text, matchingOptions = {}) {
  const parsed = parseImportText(text);
  const matched = await runMatching(parsed, { venues: [], artistProfiles: [], existingGigs: [], searchFn: async () => [], ...matchingOptions });
  return matched.map((row) => {
    const composed = composeResolvedRow(row, {});
    const rowState = deriveRowState({
      parserStatus: composed.status,
      fields: composed.fields,
      duplicate: composed.duplicate,
      venueMatch: composed.venueMatch,
      artistMatch: composed.artistMatch,
    });
    return { ...composed, rowState };
  });
}

describe("genre survives the full Gig Parse import pipeline", () => {
  it("a valid canonical genre reaches the final import payload unchanged", async () => {
    const csv = "Test Blues Band, The Wedgewood Rooms, Portsmouth, 07/12/2026, 19:30, Blues";
    const [item] = await resolveBatch(csv);
    expect(item.fields.genre).toBe("Blues");
    expect(buildGigInsertPayload(item).genre).toBe("Blues");
  });

  it("survives even when the row needs a fuzzy artist-match decision (the exact scenario from the bug report)", async () => {
    const csv = "Test Blues Band, The Wedgewood Rooms, Portsmouth, 07/12/2026, 19:30, Blues";
    const fuzzyArtist = [{ id: "a1", name: "Test Blues Banned", city: "Portsmouth", similarity_score: 0.5 }];
    const [item] = await resolveBatch(csv, { searchFn: async (entityType) => (entityType === "band" ? fuzzyArtist : []) });
    expect(item.artistMatch.tier).toBe("fuzzy");
    expect(item.fields.genre).toBe("Blues");
    expect(buildGigInsertPayload(item).genre).toBe("Blues");
  });

  it("a blank genre cell reaches the payload as null", async () => {
    const csv = "Test Unknown Band, The Wedgewood Rooms, Portsmouth, 05/12/2026, 19:30,";
    const [item] = await resolveBatch(csv);
    expect(buildGigInsertPayload(item).genre).toBeNull();
  });

  it("an unrecognised genre reaches the payload as null, never the raw text", async () => {
    const csv = "Test Weird Genre, The Wedgewood Rooms, Portsmouth, 06/12/2026, 19:30, Martian Funk";
    const [item] = await resolveBatch(csv);
    expect(buildGigInsertPayload(item).genre).toBeNull();
  });

  it("a plain 5-column row (no Genre column at all) reaches the payload as null", async () => {
    const csv = "The Mafia, The Obelisk, Woolston, 2026-06-06, 20:00";
    const [item] = await resolveBatch(csv);
    expect(buildGigInsertPayload(item).genre).toBeNull();
  });

  it("multiple rows in one paste each keep their own genre independently", async () => {
    const csv = [
      "Test Unknown Band, The Wedgewood Rooms, Portsmouth, 05/12/2026, 19:30,",
      "Test Weird Genre, The Wedgewood Rooms, Portsmouth, 06/12/2026, 19:30, Martian Funk",
      "Test Blues Band, The Wedgewood Rooms, Portsmouth, 07/12/2026, 19:30, Blues",
    ].join("\n");
    const items = await resolveBatch(csv);
    expect(items.map((i) => buildGigInsertPayload(i).genre)).toEqual([null, null, "Blues"]);
  });
});
