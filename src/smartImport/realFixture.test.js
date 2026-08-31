// Sprint 5B.5: re-validates the full pipeline (parse -> match -> row state
// -> default selection) against the real, hand-verified 226-row Gig Guide
// fixture, with no live network (no searchFn -- mirrors runMatching.test.js's
// own no-searchFn pattern). This is a permanent regression test, not a
// throwaway probe: it pins down that the 12-state model still classifies
// every row from a real-world paste, and that the specific duplicate
// clusters Sprint 5A/5B's own fixtures already document still resolve
// correctly under the 3-tier duplicate split this sprint introduced.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseImportText } from "./parser.js";
import { runMatching } from "./runMatching.js";
import { computeDefaultSelection, summariseBatch } from "./batchSelection.js";
import { ROW_STATES } from "./reviewBatch.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "msm-gig-guide-sample.txt"), "utf8");

describe("real Gig Guide fixture, end-to-end through the 5B.5 row-state model", () => {
  it("classifies every one of the 226 rows into a defined ROW_STATES value", async () => {
    const parseResult = parseImportText(fixture);
    expect(parseResult.rows).toHaveLength(226);

    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });
    const validStates = new Set(Object.values(ROW_STATES));
    for (const item of batch) {
      expect(validStates.has(item.rowState)).toBe(true);
    }
  });

  // The msm-gig-guide free-text profile never captures a performance time at
  // all (its 5-line Title/Date/Venue/Address/View-Details record has no time
  // line -- see sourceProfiles.js's extractMsmGigGuideRow, fields.time is
  // always null here). Exact duplicate identity now requires a meaningful,
  // matching time on BOTH sides (see duplicateDetection.js), specifically so
  // that two genuinely separate performances of the same act at the same
  // venue/date (the real Music in the City "Freya Golding" case) are never
  // locked together just because a time happened to be unavailable. So these
  // same-artist/venue/date clusters -- with no time on either side -- now
  // correctly resolve as a non-locked Possible Duplicate warning, not a
  // locked Exact Duplicate: an admin can still see and decide on them, but
  // Smart Import no longer assumes with certainty that they're the same
  // listing typed twice.
  it("resolves the known identical-name clusters (Jamie Webster, Transvision Vamp, Overpass/overpass, Avatar) as non-locked Possible Duplicates, since this source never captures a performance time", async () => {
    const parseResult = parseImportText(fixture);
    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });

    const clusters = [
      [34, 35], // Jamie Webster, identical
      [140, 141], // Transvision Vamp, identical
      [186, 187], // Overpass / overpass, case-only
      [216, 218], // Avatar, non-adjacent (Del Amitri between them)
    ];
    for (const [a, b] of clusters) {
      expect(batch[a].fields.time).toBeNull();
      expect(batch[b].fields.time).toBeNull();
      expect(batch[a].rowState).toBe(ROW_STATES.POSSIBLE_DUPLICATE);
      expect(batch[b].rowState).toBe(ROW_STATES.POSSIBLE_DUPLICATE);
    }
  });

  it("resolves the known near-duplicate ('possible_duplicate') clusters (Day Fever x2)", async () => {
    const parseResult = parseImportText(fixture);
    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });

    const clusters = [
      [74, 75], // Day Fever / Day Fever - Bournemouth
      [111, 112], // Day Fever / Day Fever - Southampton
    ];
    for (const [a, b] of clusters) {
      expect(batch[a].rowState).toBe(ROW_STATES.POSSIBLE_DUPLICATE);
      expect(batch[b].rowState).toBe(ROW_STATES.POSSIBLE_DUPLICATE);
    }
  });

  it("the default selection includes exactly the 'ready' rows, before any admin action", async () => {
    const parseResult = parseImportText(fixture);
    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });
    const selected = computeDefaultSelection(batch);
    const counts = summariseBatch(batch, selected);
    expect(selected.size).toBe(counts.ready);
    for (const id of selected) {
      const item = batch.find((r) => r.id === id);
      expect(item.rowState).toBe(ROW_STATES.READY);
    }
  });
});
