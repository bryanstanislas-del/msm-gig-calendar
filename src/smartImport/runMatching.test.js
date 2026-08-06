import { describe, it, expect, vi } from "vitest";
import { runMatching } from "./runMatching.js";
import { parseImportText } from "./parser.js";

// Builds a minimal Sprint-5A-shaped row without going through the real
// parser, for tests that only care about the matching stage.
function row(id, overrides = {}) {
  return {
    id,
    raw: overrides.raw || id,
    fields: {
      artistName: null,
      venueName: null,
      venueBlock: null,
      city: null,
      date: null,
      dateRaw: "",
      time: null,
      genre: null,
      ticketUrl: null,
      notes: null,
      isFestivalOrTribute: false,
      isCancelled: false,
      isPostponed: false,
      isRescheduled: false,
      isSoldOut: false,
      ...overrides.fields,
    },
    confidence: { overall: 1, field: {} },
    issues: overrides.issues || [],
    status: overrides.status || "ok",
  };
}

const venues = [{ id: "v1", name: "The Brook", name_normalised: "the brook", city: "Southampton" }];
const artistProfiles = [{ id: "p1", band_name: "The Mafia", city: "Southampton", profile_type: "band" }];

describe("runMatching", () => {
  it("resolves 'ready' for a row with an exact venue and artist match, no duplicate, parser status ok", async () => {
    const parseResult = { rows: [row("r1", { fields: { artistName: "The Mafia", venueName: "The Brook", city: "Southampton", date: "2026-09-01" } })] };
    const result = await runMatching(parseResult, { venues, artistProfiles });
    expect(result[0].rowState).toBe("ready");
    expect(result[0].venueMatch.tier).toBe("exact");
    expect(result[0].artistMatch.tier).toBe("exact");
  });

  it("resolves 'missing_venue' when there's no exact match and no searchFn is supplied", async () => {
    const parseResult = { rows: [row("r1", { fields: { artistName: "The Mafia", venueName: "Totally New Place", city: "Nowhere", date: "2026-09-01" } })] };
    const result = await runMatching(parseResult, { venues, artistProfiles });
    expect(result[0].rowState).toBe("missing_venue");
  });

  it("calls searchFn only when there's no local exact match, and resolves 'needs_review' for a fuzzy venue hit", async () => {
    const searchFn = vi.fn(async (entityType, query) => {
      if (entityType === "venue") return [{ id: "v9", name: "The Brooke", city: "Southampton", similarity_score: 0.6 }];
      return [];
    });
    const parseResult = {
      rows: [row("r1", { fields: { artistName: "The Mafia", venueName: "The Brooky", city: "Southampton", date: "2026-09-01" } })],
    };
    const result = await runMatching(parseResult, { venues, artistProfiles, searchFn });
    expect(result[0].venueMatch.tier).toBe("fuzzy");
    expect(result[0].rowState).toBe("needs_review");
    expect(searchFn).toHaveBeenCalledWith("venue", "The Brooky");
    // artist was an exact match, so no artist search calls were made
    expect(searchFn).not.toHaveBeenCalledWith("band", expect.anything());
  });

  it("merges band and solo_artist search results for artist matching", async () => {
    const searchFn = vi.fn(async (entityType) => {
      if (entityType === "band") return [{ id: "b1", name: "The Mafiosos", city: "Southampton", similarity_score: 0.4 }];
      if (entityType === "solo_artist") return [{ id: "s1", name: "DJ Mafia", city: "Southampton", similarity_score: 0.5 }];
      return [];
    });
    const parseResult = {
      rows: [row("r1", { fields: { artistName: "Mafia", venueName: "The Brook", city: "Southampton", date: "2026-09-01" } })],
    };
    const result = await runMatching(parseResult, { venues, artistProfiles, searchFn });
    expect(result[0].artistMatch.tier).toBe("fuzzy");
    expect(result[0].artistMatch.candidates.map((c) => c.id).sort()).toEqual(["b1", "s1"]);
  });

  it("does not call searchFn for a generic-dash-list row's artist (not_applicable)", async () => {
    const searchFn = vi.fn(async () => []);
    const parseResult = {
      rows: [row("r1", { fields: { artistName: null, venueName: "The Brook", city: "Southampton", date: "2026-09-01" } })],
    };
    const result = await runMatching(parseResult, { venues, artistProfiles, searchFn });
    expect(result[0].artistMatch.tier).toBe("not_applicable");
    expect(searchFn).not.toHaveBeenCalledWith("band", expect.anything());
    expect(searchFn).not.toHaveBeenCalledWith("solo_artist", expect.anything());
  });

  it("resolves 'exact_duplicate' for two rows in the batch that share artist + date + venue, taking precedence over 'ready'", async () => {
    const fields = { artistName: "The Mafia", venueName: "The Brook", city: "Southampton", date: "2026-09-01" };
    const parseResult = { rows: [row("r1", { fields }), row("r2", { fields })] };
    const result = await runMatching(parseResult, { venues, artistProfiles });
    expect(result[0].rowState).toBe("exact_duplicate");
    expect(result[1].rowState).toBe("exact_duplicate");
  });

  it("resolves 'exact_duplicate' against an existing gig snapshot", async () => {
    const parseResult = {
      rows: [row("r1", { fields: { artistName: "The Mafia", venueName: "The Brook", city: "Southampton", date: "2026-09-01" } })],
    };
    const existingGigs = [{ id: "gig-1", band_name: "The Mafia", date: "2026-09-01", venue_id: "v1", venue: "The Brook" }];
    const result = await runMatching(parseResult, { venues, artistProfiles, existingGigs });
    expect(result[0].rowState).toBe("exact_duplicate");
    expect(result[0].duplicate.existingGigId).toBe("gig-1");
  });

  it("resolves 'needs_review' (not a match tier) for a row whose Sprint 5A parser status is not 'ok'", async () => {
    const parseResult = {
      rows: [row("r1", { status: "needs_review", fields: { artistName: "The Mafia", venueName: "The Brook", city: "Southampton", date: "2026-09-01" } })],
    };
    const result = await runMatching(parseResult, { venues, artistProfiles });
    expect(result[0].rowState).toBe("needs_review");
  });

  it("preserves row order in the output even though rows are matched concurrently with staggered searchFn latency", async () => {
    // Rows matched earlier in the array resolve their searchFn call *later*
    // than rows behind them -- if matching leaked completion order into the
    // output (e.g. building the result via a Map iterated in resolution
    // order) this would catch it.
    const searchFn = vi.fn(async (entityType, query) => {
      const delayMs = query.length % 3 === 0 ? 0 : 5;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return [];
    });
    const ids = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
    const parseResult = {
      rows: ids.map((id) =>
        row(id, { fields: { artistName: `Act ${id}`, venueName: `Venue ${id}`, city: "Southampton", date: "2026-09-01" } })
      ),
    };
    const result = await runMatching(parseResult, { venues: [], artistProfiles: [], searchFn });
    expect(result.map((r) => r.id)).toEqual(ids);
  });

  it("runs end-to-end against a real parseImportText result with no matching data available", async () => {
    const parseResult = parseImportText("5 July - The Brook, Southampton", { contextYear: 2030 });
    const result = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });
    expect(result).toHaveLength(1);
    expect(result[0].rowState).toBe("missing_venue");
    expect(result[0].artistMatch.tier).toBe("not_applicable");
  });
});
