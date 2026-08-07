// Sprint 5D: re-validates grouping/ordering against the real, hand-verified
// 226-row Gig Guide fixture -- the same fixture and no-searchFn convention
// realFixture.test.js already uses (see that file's header comment). This
// is the permanent regression anchor for the sprint's core claim: 226 rows
// collapse to a small number of venue decisions, and "Southampton 1865" is
// the real, load-bearing example the sprint spec itself cites (83 rows, not
// a round/invented number).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseImportText } from "./parser.js";
import { runMatching } from "./runMatching.js";
import { groupMissingVenues, groupFuzzyVenues } from "./venueResolutionGroups.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "msm-gig-guide-sample.txt"), "utf8");

async function matchedFixtureBatch() {
  const parseResult = parseImportText(fixture);
  return runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });
}

describe("real Gig Guide fixture -- venue grouping", () => {
  it("collapses 226 rows into 26 distinct venue groups", async () => {
    const batch = await matchedFixtureBatch();
    const groups = [...groupMissingVenues(batch), ...groupFuzzyVenues(batch)];
    expect(groups).toHaveLength(26);
    const totalRows = groups.reduce((sum, g) => sum + g.rowIds.length, 0);
    expect(totalRows).toBe(226);
  });

  it("groups exactly 83 rows under Southampton 1865, the real recurring example the spec cites", async () => {
    const batch = await matchedFixtureBatch();
    const groups = groupMissingVenues(batch);
    const southampton1865 = groups.find((g) => g.sourceText.toLowerCase() === "southampton 1865");
    expect(southampton1865).toBeDefined();
    expect(southampton1865.rowIds).toHaveLength(83);
  });

  it("the top 4 venue groups together cover 160 of the 226 rows", async () => {
    const batch = await matchedFixtureBatch();
    const groups = groupMissingVenues(batch); // no searchFn -> every unmatched row is tier "none", never fuzzy
    const top4Total = groups.slice(0, 4).reduce((sum, g) => sum + g.rowIds.length, 0);
    expect(top4Total).toBe(160);
  });

  it("captures the real address block for the Southampton 1865 group", async () => {
    const batch = await matchedFixtureBatch();
    const group = groupMissingVenues(batch).find((g) => g.sourceText.toLowerCase() === "southampton 1865");
    expect(group.sourceAddressBlock).toBe("Southampton 1865, Brunswick Square");
  });

  it("grouping the same fixture twice produces identical group ids and order (deterministic)", async () => {
    const batchA = await matchedFixtureBatch();
    const batchB = await matchedFixtureBatch();
    const idsA = groupMissingVenues(batchA).map((g) => g.id);
    const idsB = groupMissingVenues(batchB).map((g) => g.id);
    expect(idsA).toEqual(idsB);
  });

  it("a synthetic 150+-row single venue group is handled correctly (the real fixture's max is 83, not 150+)", () => {
    // The sprint spec's test-matrix item asks for "one venue affecting
    // 150+ rows" -- the real fixture's actual max is 83 (asserted above),
    // so this constructs a synthetic in-memory batch to exercise the
    // literal 150+ scale without inventing a fake number for the real data.
    const rows = Array.from({ length: 173 }, (_, i) => ({
      id: `synthetic-${i}`,
      fields: { venueBlock: "Big Arena, 1 Stadium Way" },
      venueMatch: { tier: "none", query: "Big Arena", city: null, match: null, candidates: [] },
    }));
    const groups = groupMissingVenues(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toHaveLength(173);
    expect(groups[0].sampleRowIds).toHaveLength(5);
  });
});
