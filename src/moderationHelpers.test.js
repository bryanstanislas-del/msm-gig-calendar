import { describe, it, expect, vi } from "vitest";
import {
  selectVisiblePendingGigs, bulkApproveGigs, BULK_APPROVE_CONCURRENCY, finaliseBulkApproveOutcome,
  filterModerationGigs, gigMatchesModerationSearch, normalizeModerationSearchTerm,
} from "./moderationHelpers.js";

function gig(id, status, overrides = {}) {
  return { id, status, band_name: `Band ${id}`, venue: `Venue ${id}`, ...overrides };
}

describe("selectVisiblePendingGigs", () => {
  it("J: a PENDING-tab-style visible list (all pending) returns every gig", () => {
    const visible = [gig("g1", "pending"), gig("g2", "pending")];
    expect(selectVisiblePendingGigs(visible)).toEqual(visible);
  });

  it("K: a mixed ALL-tab-style visible list returns only the pending gigs", () => {
    const visible = [gig("g1", "pending"), gig("g2", "approved"), gig("g3", "rejected"), gig("g4", "pending")];
    const result = selectVisiblePendingGigs(visible);
    expect(result.map((g) => g.id)).toEqual(["g1", "g4"]);
  });

  it("L: an APPROVED-tab-style or REJECTED-tab-style visible list returns zero eligible gigs", () => {
    expect(selectVisiblePendingGigs([gig("g1", "approved"), gig("g2", "approved")])).toEqual([]);
    expect(selectVisiblePendingGigs([gig("g1", "rejected")])).toEqual([]);
  });

  it("returns [] for an empty visible list", () => {
    expect(selectVisiblePendingGigs([])).toEqual([]);
  });
});

describe("bulkApproveGigs", () => {
  it("A: all 5 eligible pending gigs succeed -> 5 succeeded, 0 failed", async () => {
    const gigs = Array.from({ length: 5 }, (_, i) => gig(`g${i}`, "pending"));
    const approveFn = vi.fn(async () => {});
    const result = await bulkApproveGigs(gigs, { approveFn });
    expect(result.succeeded).toHaveLength(5);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(approveFn).toHaveBeenCalledTimes(5);
  });

  it("B: one of 5 fails -> 4 succeeded, 1 failed, and the other approvals still complete", async () => {
    const gigs = Array.from({ length: 5 }, (_, i) => gig(`g${i}`, "pending"));
    const approveFn = vi.fn(async (g) => {
      if (g.id === "g2") throw new Error("network blip");
    });
    const result = await bulkApproveGigs(gigs, { approveFn });
    expect(result.succeeded).toHaveLength(4);
    expect(result.failed).toHaveLength(1);
    expect(approveFn).toHaveBeenCalledTimes(5); // every gig was still attempted
  });

  it("C: a failure identifies the correct gig and preserves its error message", async () => {
    const gigs = [gig("g1", "pending"), gig("g2", "pending", { band_name: "The Culprits", venue: "The Brook" })];
    const approveFn = vi.fn(async (g) => {
      if (g.id === "g2") throw new Error("constraint violation on gigs");
    });
    const result = await bulkApproveGigs(gigs, { approveFn });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].gig.id).toBe("g2");
    expect(result.failed[0].gig.band_name).toBe("The Culprits");
    expect(result.failed[0].gig.venue).toBe("The Brook");
    expect(result.failed[0].error).toBe("constraint violation on gigs");
  });

  it("D: empty input -> no approval calls, 0 succeeded / 0 failed", async () => {
    const approveFn = vi.fn(async () => {});
    const result = await bulkApproveGigs([], { approveFn });
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(approveFn).not.toHaveBeenCalled();
  });

  it("E: an approved gig accidentally passed to the helper is never sent to approveFn", async () => {
    const gigs = [gig("g1", "approved")];
    const approveFn = vi.fn(async () => {});
    const result = await bulkApproveGigs(gigs, { approveFn });
    expect(approveFn).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].gig.id).toBe("g1");
    expect(result.skipped[0].reason).toMatch(/not pending/i);
  });

  it("F: a rejected gig accidentally passed to the helper is never sent to approveFn", async () => {
    const gigs = [gig("g1", "rejected")];
    const approveFn = vi.fn(async () => {});
    const result = await bulkApproveGigs(gigs, { approveFn });
    expect(approveFn).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].gig.id).toBe("g1");
  });

  it("G: a mixed batch (pending/approved/rejected) only processes the pending gigs", async () => {
    const gigs = [gig("g1", "pending"), gig("g2", "approved"), gig("g3", "rejected"), gig("g4", "pending")];
    const approveFn = vi.fn(async () => {});
    const result = await bulkApproveGigs(gigs, { approveFn });
    expect(approveFn).toHaveBeenCalledTimes(2);
    expect(approveFn).toHaveBeenCalledWith(gigs[0]);
    expect(approveFn).toHaveBeenCalledWith(gigs[3]);
    expect(result.succeeded.map((g) => g.id).sort()).toEqual(["g1", "g4"]);
    expect(result.skipped.map((s) => s.gig.id).sort()).toEqual(["g2", "g3"]);
  });

  it("H: controlled concurrency is respected (default limit)", async () => {
    const gigs = Array.from({ length: 12 }, (_, i) => gig(`g${i}`, "pending"));
    let inFlight = 0;
    let maxInFlight = 0;
    const approveFn = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    await bulkApproveGigs(gigs, { approveFn });
    expect(maxInFlight).toBeLessThanOrEqual(BULK_APPROVE_CONCURRENCY);
    expect(BULK_APPROVE_CONCURRENCY).toBe(5); // matches the Smart Import (importEngine.js) precedent
  });

  it("H: an explicit concurrency override is honoured", async () => {
    const gigs = Array.from({ length: 8 }, (_, i) => gig(`g${i}`, "pending"));
    let inFlight = 0;
    let maxInFlight = 0;
    const approveFn = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    await bulkApproveGigs(gigs, { approveFn, concurrency: 2 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("I: result association stays correct even when promises resolve out of order", async () => {
    const gigs = Array.from({ length: 6 }, (_, i) => gig(`g${i}`, "pending"));
    const approveFn = vi.fn(async (g) => {
      // reverse-order resolution: later items resolve first
      const delayMs = (5 - Number(g.id.slice(1))) * 3;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    });
    const result = await bulkApproveGigs(gigs, { approveFn, concurrency: 3 });
    expect(result.succeeded.map((g) => g.id)).toEqual(["g0", "g1", "g2", "g3", "g4", "g5"]);
  });

  it("M: a failure partway through the batch does not abort remaining items", async () => {
    const gigs = Array.from({ length: 9 }, (_, i) => gig(`g${i}`, "pending"));
    const approveFn = vi.fn(async (g) => {
      if (["g1", "g4", "g7"].includes(g.id)) throw new Error(`boom for ${g.id}`);
    });
    const result = await bulkApproveGigs(gigs, { approveFn, concurrency: 3 });
    expect(approveFn).toHaveBeenCalledTimes(9); // every gig still attempted
    expect(result.succeeded).toHaveLength(6);
    expect(result.failed).toHaveLength(3);
    expect(result.failed.map((f) => f.gig.id).sort()).toEqual(["g1", "g4", "g7"]);
  });
});

// Regression coverage for the "post-batch onRefresh() failure" blocker: the
// approval batch and the subsequent refresh-the-admin's-view step are two
// independent operations, and a failure in the second must never be
// reported as, or allowed to overwrite/discard, the first's already-correct
// result.
describe("finaliseBulkApproveOutcome", () => {
  it("A: successful batch + successful refresh -> unchanged result, no refresh error", () => {
    const result = { succeeded: [gig("g1", "pending"), gig("g2", "pending")], failed: [], skipped: [] };
    const outcome = finaliseBulkApproveOutcome(result, null);
    expect(outcome.succeeded).toEqual(result.succeeded);
    expect(outcome.failed).toEqual([]);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.refreshError).toBeNull();
  });

  it("B: successful batch + failed refresh -> approval result stays successful, refresh failure kept separate", () => {
    const result = { succeeded: [gig("g1", "pending"), gig("g2", "pending")], failed: [], skipped: [] };
    const outcome = finaliseBulkApproveOutcome(result, new Error("network timeout"));
    expect(outcome.succeeded).toHaveLength(2); // still both approved -- unaffected by the refresh failing
    expect(outcome.failed).toHaveLength(0); // must NOT be reported as an approval failure
    expect(outcome.refreshError).toBe("network timeout");
  });

  it("C: partial approval failure + failed refresh -> original succeeded/failed counts preserved, refresh failure additional", () => {
    const result = {
      succeeded: [gig("g1", "pending")],
      failed: [{ gig: gig("g2", "pending"), error: "constraint violation" }],
      skipped: [],
    };
    const outcome = finaliseBulkApproveOutcome(result, new Error("fetch failed"));
    expect(outcome.succeeded).toHaveLength(1);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].error).toBe("constraint violation"); // untouched by the refresh failure
    expect(outcome.refreshError).toBe("fetch failed");
  });

  it("D: takes no approve callback and performs no I/O, so it cannot itself trigger a second approval attempt", () => {
    expect(finaliseBulkApproveOutcome.length).toBeLessThanOrEqual(2); // (result, refreshError) only -- no approveFn parameter
    const result = { succeeded: [], failed: [], skipped: [] };
    const outcome = finaliseBulkApproveOutcome(result, new Error("x"));
    expect(Object.keys(outcome).sort()).toEqual(["failed", "refreshError", "skipped", "succeeded"]);
  });

  it("accepts a non-Error refresh failure value safely", () => {
    const result = { succeeded: [], failed: [], skipped: [] };
    expect(finaliseBulkApproveOutcome(result, "plain string failure").refreshError).toBe("plain string failure");
  });

  it("defaults refreshError to null when omitted", () => {
    const result = { succeeded: [], failed: [], skipped: [] };
    expect(finaliseBulkApproveOutcome(result).refreshError).toBeNull();
  });
});

// Regression coverage for Moderation's search/find feature: 1,600+
// already-loaded approved gigs are unusable to scroll through by hand, so
// this pure filter lets an admin narrow the currently selected status tab
// down to the one gig they're after.
describe("normalizeModerationSearchTerm", () => {
  it("trims leading/trailing whitespace and lowercases", () => {
    expect(normalizeModerationSearchTerm("  Steamer  ")).toBe("steamer");
  });

  it("returns '' for null/undefined/whitespace-only input", () => {
    expect(normalizeModerationSearchTerm(null)).toBe("");
    expect(normalizeModerationSearchTerm(undefined)).toBe("");
    expect(normalizeModerationSearchTerm("   ")).toBe("");
  });
});

describe("gigMatchesModerationSearch", () => {
  const g = gig("g1", "approved", { band_name: "The Steamers", venue: "Dirty Gertie's", city: "Christchurch", date: "2026-09-18" });

  it("matches on artist/band_name (substring, case-insensitive)", () => {
    expect(gigMatchesModerationSearch(g, "steamer")).toBe(true);
    expect(gigMatchesModerationSearch(g, "STEAMER")).toBe(true);
  });

  it("matches on venue (substring)", () => {
    expect(gigMatchesModerationSearch(g, "Dirty Gertie's")).toBe(true);
    expect(gigMatchesModerationSearch(g, "gertie")).toBe(true);
  });

  it("matches on city (substring)", () => {
    expect(gigMatchesModerationSearch(g, "Christchurch")).toBe(true);
    expect(gigMatchesModerationSearch(g, "christ")).toBe(true);
  });

  it("is case-insensitive across all text fields", () => {
    expect(gigMatchesModerationSearch(g, "CHRISTCHURCH")).toBe(true);
    expect(gigMatchesModerationSearch(g, "dirty GERTIE'S")).toBe(true);
  });

  it("trims whitespace around the term before matching", () => {
    expect(gigMatchesModerationSearch(g, "  steamer  ")).toBe(true);
  });

  it("matches an ISO-format date (2026-09-18)", () => {
    expect(gigMatchesModerationSearch(g, "2026-09-18")).toBe(true);
  });

  it("matches a UK slash-format date (18/09/2026)", () => {
    expect(gigMatchesModerationSearch(g, "18/09/2026")).toBe(true);
  });

  it("matches the display date format (18 September 2026), case-insensitive", () => {
    expect(gigMatchesModerationSearch(g, "18 September 2026")).toBe(true);
    expect(gigMatchesModerationSearch(g, "18 september 2026")).toBe(true);
  });

  it("matches a partial display-date fragment (September 2026)", () => {
    expect(gigMatchesModerationSearch(g, "september 2026")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(gigMatchesModerationSearch(g, "nonexistent venue")).toBe(false);
  });

  it("an empty/whitespace-only term always matches", () => {
    expect(gigMatchesModerationSearch(g, "")).toBe(true);
    expect(gigMatchesModerationSearch(g, "   ")).toBe(true);
    expect(gigMatchesModerationSearch(g, undefined)).toBe(true);
  });

  it("never throws on a gig with a missing/malformed date", () => {
    expect(gigMatchesModerationSearch(gig("g2", "approved", { date: null }), "18/09/2026")).toBe(false);
    expect(gigMatchesModerationSearch(gig("g3", "approved", { date: "not-a-date" }), "18/09/2026")).toBe(false);
  });
});

describe("filterModerationGigs", () => {
  const gigs = [
    gig("g1", "approved", { band_name: "The Steamers", venue: "Dirty Gertie's", city: "Christchurch", date: "2026-09-18" }),
    gig("g2", "approved", { band_name: "Jazz Collective", venue: "The Brook", city: "Southampton", date: "2026-09-19" }),
    gig("g3", "pending",  { band_name: "The Steamers", venue: "The Joiners", city: "Southampton", date: "2026-10-01" }),
  ];

  it("with no search/date, returns the input unchanged (and in the same order)", () => {
    expect(filterModerationGigs(gigs, {})).toEqual(gigs);
    expect(filterModerationGigs(gigs, { search: "", date: "" })).toEqual(gigs);
  });

  it("filters by search text alone", () => {
    const result = filterModerationGigs(gigs, { search: "Steamer" });
    expect(result.map((g) => g.id)).toEqual(["g1", "g3"]);
  });

  it("filters by exact date alone", () => {
    const result = filterModerationGigs(gigs, { date: "2026-09-19" });
    expect(result.map((g) => g.id)).toEqual(["g2"]);
  });

  it("combines status pre-filtering (caller's job) with search: APPROVED + 'Steamer' shows only g1", () => {
    const approvedOnly = gigs.filter((g) => g.status === "approved");
    const result = filterModerationGigs(approvedOnly, { search: "Steamer" });
    expect(result.map((g) => g.id)).toEqual(["g1"]);
  });

  it("combines search and date together", () => {
    expect(filterModerationGigs(gigs, { search: "Southampton", date: "2026-09-19" }).map((g) => g.id)).toEqual(["g2"]);
    expect(filterModerationGigs(gigs, { search: "Southampton", date: "2026-10-01" }).map((g) => g.id)).toEqual(["g3"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterModerationGigs(gigs, { search: "nonexistent" })).toEqual([]);
  });

  it("clearing search (back to '') restores the full input set", () => {
    const narrowed = filterModerationGigs(gigs, { search: "Steamers" });
    expect(narrowed.length).toBeLessThan(gigs.length);
    expect(filterModerationGigs(gigs, { search: "" })).toEqual(gigs);
  });

  it("preserves the caller's existing ordering", () => {
    const reordered = [gigs[2], gigs[0], gigs[1]];
    const result = filterModerationGigs(reordered, { search: "Steamer" });
    expect(result.map((g) => g.id)).toEqual(["g3", "g1"]);
  });
});
