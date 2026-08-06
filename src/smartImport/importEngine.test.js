import { describe, it, expect, vi } from "vitest";
import { validateRowForImport, buildGigInsertPayload, runImport, summariseImportResult } from "./importEngine.js";
import { ROW_STATES } from "./reviewBatch.js";

function item(overrides = {}) {
  return {
    id: "r1",
    raw: "The Mafia - The Brook, Southampton",
    fields: {
      artistName: "The Mafia",
      venueName: "The Brook",
      city: "Southampton",
      date: "2026-09-01",
      time: "20:00",
      genre: "Indie Rock",
      notes: null,
      ticketUrl: null,
    },
    status: "ok",
    venueMatch: { tier: "exact", query: "The Brook", city: "Southampton", match: { id: "v1", name: "The Brook", city: "Southampton" }, candidates: [] },
    artistMatch: { tier: "exact", query: "The Mafia", match: { id: "a1", name: "The Mafia", city: "Southampton", profileType: "band" }, candidates: [] },
    duplicate: { tier: "none", withRowIds: [], existingGigId: null },
    rowState: ROW_STATES.READY,
    ...overrides,
  };
}

describe("validateRowForImport", () => {
  it("returns null for a clean ready row", () => {
    expect(validateRowForImport(item())).toBeNull();
  });

  it("blocks locked states (exact_duplicate, invalid_date)", () => {
    expect(validateRowForImport(item({ rowState: ROW_STATES.EXACT_DUPLICATE }))).toMatch(/Exact Duplicate/);
    expect(validateRowForImport(item({ rowState: ROW_STATES.INVALID_DATE }))).toMatch(/Invalid Date/);
  });

  it("blocks a New Venue row with no known city", () => {
    const result = validateRowForImport(
      item({ rowState: ROW_STATES.MISSING_VENUE, venueMatch: { tier: "none", query: "Some Club", city: null, match: null, candidates: [] } })
    );
    expect(result).toMatch(/no known city/);
  });

  it("allows a New Venue row when a city is known", () => {
    const result = validateRowForImport(
      item({ rowState: ROW_STATES.MISSING_VENUE, venueMatch: { tier: "none", query: "Some Club", city: "Portsmouth", match: null, candidates: [] } })
    );
    expect(result).toBeNull();
  });

  it("allows a Missing Artist row (not locked)", () => {
    const result = validateRowForImport(
      item({ rowState: ROW_STATES.MISSING_ARTIST, artistMatch: { tier: "none", query: "Unknown Act", match: null, candidates: [] } })
    );
    expect(result).toBeNull();
  });

  it("allows Cancelled/Postponed/Rescheduled rows (default-excluded but not locked)", () => {
    expect(validateRowForImport(item({ rowState: ROW_STATES.CANCELLED }))).toBeNull();
    expect(validateRowForImport(item({ rowState: ROW_STATES.POSSIBLE_DUPLICATE }))).toBeNull();
  });
});

describe("buildGigInsertPayload", () => {
  it("writes the matched venue's canonical name/city for an exact match, not the raw query", () => {
    const result = buildGigInsertPayload(
      item({ venueMatch: { tier: "exact", query: "the brook southampton", city: "Southampton", match: { id: "v1", name: "The Brook", city: "Southampton" }, candidates: [] } })
    );
    expect(result.venue).toBe("The Brook");
    expect(result.city).toBe("Southampton");
  });

  it("writes the matched venue's canonical name/city for a confirmed (admin-accepted fuzzy) match too", () => {
    const result = buildGigInsertPayload(
      item({ venueMatch: { tier: "confirmed", query: "The Brooky", city: null, match: { id: "v9", name: "The Brooke Inn", city: "Winchester" }, candidates: [] } })
    );
    expect(result.venue).toBe("The Brooke Inn");
    expect(result.city).toBe("Winchester");
  });

  it("writes the raw parsed name/city for a New Venue (tier none) row", () => {
    const result = buildGigInsertPayload(
      item({ venueMatch: { tier: "none", query: "Totally New Place", city: "Fareham", match: null, candidates: [] } })
    );
    expect(result.venue).toBe("Totally New Place");
    expect(result.city).toBe("Fareham");
  });

  it("sets band_profile_id for exact/confirmed artist matches", () => {
    expect(buildGigInsertPayload(item()).band_profile_id).toBe("a1");
    const confirmed = buildGigInsertPayload(
      item({ artistMatch: { tier: "confirmed", query: "The Mafias", match: { id: "a9", name: "The Mafia" }, candidates: [] } })
    );
    expect(confirmed.band_profile_id).toBe("a9");
  });

  it("never sets band_profile_id for a Missing Artist (tier none) or not_applicable row", () => {
    const missing = buildGigInsertPayload(item({ artistMatch: { tier: "none", query: "Unknown Act", match: null, candidates: [] } }));
    expect(missing.band_profile_id).toBeNull();
    const notApplicable = buildGigInsertPayload(item({ artistMatch: { tier: "not_applicable", query: null, match: null, candidates: [] } }));
    expect(notApplicable.band_profile_id).toBeNull();
  });

  it("passes through band_name/date/time/genre/notes/tickets/raw_text from the row", () => {
    const result = buildGigInsertPayload(
      item({
        raw: "raw line text",
        fields: { artistName: "Some Band", venueName: "X", city: "Y", date: "2026-10-10", time: "19:30", genre: "Punk", notes: "support: nobody", ticketUrl: "https://tix.example/1" },
      })
    );
    expect(result).toMatchObject({
      band_name: "Some Band",
      date: "2026-10-10",
      time: "19:30",
      genre: "Punk",
      notes: "support: nobody",
      tickets: "https://tix.example/1",
      raw_text: "raw line text",
    });
  });

  it("passes through null time/genre unchanged -- the RPC owns coalescing to DB defaults", () => {
    const result = buildGigInsertPayload(item({ fields: { ...item().fields, time: null, genre: null } }));
    expect(result.time).toBeNull();
    expect(result.genre).toBeNull();
  });
});

describe("runImport", () => {
  it("starts a run, imports each row via the concurrency pool, and completes the run with correct counts", async () => {
    const rows = [item({ id: "r1" }), item({ id: "r2" }), item({ id: "r3" })];
    const startRunFn = vi.fn(async () => "run-1");
    const importRowFn = vi.fn(async ({ band_name }) => ({ outcome: "created", gig_id: `gig-${band_name}` }));
    const completeRunFn = vi.fn(async () => {});

    const result = await runImport(rows, { startRunFn, importRowFn, completeRunFn });

    expect(startRunFn).toHaveBeenCalledWith({ sourceProfileId: null, totalRows: 3 });
    expect(importRowFn).toHaveBeenCalledTimes(3);
    expect(importRowFn.mock.calls[0][0]).toMatchObject({ importRunId: "run-1", band_name: "The Mafia" });
    expect(completeRunFn).toHaveBeenCalledWith({ importRunId: "run-1", succeeded: 3, failed: 0 });
    expect(result.importRunId).toBe("run-1");
    expect(result.results).toHaveLength(3);
    expect(result.blocked).toEqual([]);
  });

  it("never calls importRowFn for blocked rows, and reports them separately", async () => {
    const rows = [item({ id: "r1", rowState: ROW_STATES.EXACT_DUPLICATE }), item({ id: "r2" })];
    const startRunFn = vi.fn(async () => "run-1");
    const importRowFn = vi.fn(async () => ({ outcome: "created", gig_id: "gig-1" }));
    const completeRunFn = vi.fn(async () => {});

    const result = await runImport(rows, { startRunFn, importRowFn, completeRunFn });

    expect(startRunFn).toHaveBeenCalledWith({ sourceProfileId: null, totalRows: 1 });
    expect(importRowFn).toHaveBeenCalledTimes(1);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].item.id).toBe("r1");
  });

  it("one row throwing inside importRowFn never stops the others, and is recorded as failed", async () => {
    // Fails based on a marker in raw_text (not call count), so the outcome
    // doesn't depend on which order the concurrency pool happens to run rows in.
    const failingImportRowFn = vi.fn(async ({ raw_text }) => {
      if (raw_text.includes("r2-marker")) throw new Error("network drop");
      return { outcome: "created", gig_id: "gig-ok" };
    });
    const rowsWithMarker = [item({ id: "r1" }), item({ id: "r2", raw: "r2-marker" }), item({ id: "r3" })];
    const startRunFn = vi.fn(async () => "run-1");
    const completeRunFn = vi.fn(async () => {});

    const result = await runImport(rowsWithMarker, { startRunFn, importRowFn: failingImportRowFn, completeRunFn });

    expect(result.results).toHaveLength(3);
    const failedResult = result.results.find((r) => r.item.id === "r2");
    expect(failedResult.outcome).toBe("failed");
    expect(failedResult.error).toBe("network drop");
    const okResults = result.results.filter((r) => r.item.id !== "r2");
    expect(okResults.every((r) => r.outcome === "created")).toBe(true);
    expect(completeRunFn).toHaveBeenCalledWith({ importRunId: "run-1", succeeded: 2, failed: 1 });
  });

  it("treats an RPC-returned {outcome:'failed'} the same as a thrown error for the completion counts", async () => {
    const rows = [item({ id: "r1" }), item({ id: "r2" })];
    const importRowFn = vi.fn(async ({ raw_text }) => (raw_text.includes("fail-me") ? { outcome: "failed", gig_id: null } : { outcome: "created", gig_id: "gig-1" }));
    const startRunFn = vi.fn(async () => "run-1");
    const completeRunFn = vi.fn(async () => {});

    await runImport([item({ id: "r1", raw: "fail-me" }), item({ id: "r2" })], { startRunFn, importRowFn, completeRunFn });

    expect(completeRunFn).toHaveBeenCalledWith({ importRunId: "run-1", succeeded: 1, failed: 1 });
  });

  it("preserves row order in the results array regardless of completion order under concurrency", async () => {
    const ids = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const rows = ids.map((id) => item({ id, raw: id }));
    const importRowFn = vi.fn(async ({ raw_text }) => {
      const delayMs = raw_text.charCodeAt(1) % 2 === 0 ? 0 : 5;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { outcome: "created", gig_id: `gig-${raw_text}` };
    });
    const startRunFn = vi.fn(async () => "run-1");
    const completeRunFn = vi.fn(async () => {});

    const result = await runImport(rows, { startRunFn, importRowFn, completeRunFn, concurrency: 3 });
    expect(result.results.map((r) => r.item.id)).toEqual(ids);
  });
});

describe("summariseImportResult", () => {
  it("produces correct counts and grouped reasons", () => {
    const results = [
      { item: item({ id: "r1" }), outcome: "created", gigId: "g1", error: null },
      { item: item({ id: "r2" }), outcome: "created", gigId: "g2", error: null },
      { item: item({ id: "r3" }), outcome: "failed", gigId: null, error: "duplicate key value" },
      { item: item({ id: "r4" }), outcome: "failed", gigId: null, error: "duplicate key value" },
      { item: item({ id: "r5" }), outcome: "failed", gigId: null, error: "some other error" },
    ];
    const blocked = [
      { item: item({ id: "r6", rowState: ROW_STATES.EXACT_DUPLICATE }), reason: "Exact Duplicate rows cannot be imported." },
      { item: item({ id: "r7", rowState: ROW_STATES.EXACT_DUPLICATE }), reason: "Exact Duplicate rows cannot be imported." },
    ];

    const summary = summariseImportResult({ results, blocked });
    expect(summary).toEqual({
      totalAttempted: 7,
      created: 2,
      failed: 3,
      blocked: 2,
      failureReasons: [
        { reason: "duplicate key value", count: 2 },
        { reason: "some other error", count: 1 },
      ],
      blockedReasons: [{ reason: "Exact Duplicate rows cannot be imported.", count: 2 }],
    });
  });

  it("handles an all-success result with empty reason lists", () => {
    const results = [{ item: item(), outcome: "created", gigId: "g1", error: null }];
    const summary = summariseImportResult({ results, blocked: [] });
    expect(summary.failureReasons).toEqual([]);
    expect(summary.blockedReasons).toEqual([]);
  });
});
