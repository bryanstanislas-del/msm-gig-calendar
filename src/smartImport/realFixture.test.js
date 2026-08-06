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

  it("resolves the known exact-duplicate clusters (Jamie Webster, Transvision Vamp, Overpass/overpass, Avatar)", async () => {
    const parseResult = parseImportText(fixture);
    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });

    const clusters = [
      [34, 35], // Jamie Webster, identical
      [140, 141], // Transvision Vamp, identical
      [186, 187], // Overpass / overpass, case-only
      [216, 218], // Avatar, non-adjacent (Del Amitri between them)
    ];
    for (const [a, b] of clusters) {
      expect(batch[a].rowState).toBe(ROW_STATES.EXACT_DUPLICATE);
      expect(batch[b].rowState).toBe(ROW_STATES.EXACT_DUPLICATE);
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
