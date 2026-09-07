import { describe, it, expect } from "vitest";
import { applyDuplicateResults } from "./postResolutionDuplicates.js";
import { DUPLICATE_TIERS } from "./duplicateDetection.js";
import { ROW_STATES, isLocked } from "./reviewBatch.js";

const NONE_DUPLICATE = { tier: DUPLICATE_TIERS.NONE, withRowIds: [], existingGigId: null };

function row(overrides = {}) {
  return {
    id: "r1",
    status: "ok",
    raw: "raw text",
    fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" },
    venueMatch: { tier: "none", query: "Some Venue", city: null, match: null, candidates: [] },
    artistMatch: { tier: "none", query: "Biohazard", match: null, candidates: [] },
    duplicate: NONE_DUPLICATE,
    ...overrides,
  };
}

describe("applyDuplicateResults", () => {
  it("T: a row that started fuzzy on venue, then confirmed to a real UUID, is detected as an exact duplicate of an existing gig", () => {
    const resolvedRows = [
      row({
        id: "r1",
        venueMatch: { tier: "confirmed", query: "The Platform", city: "Southampton", match: { id: "v1", name: "Platform Tavern", city: "Southampton" }, candidates: [] },
        duplicate: NONE_DUPLICATE, // the ORIGINAL pre-resolution pass never flagged this row -- it was still fuzzy
      }),
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Platform Tavern" }];
    const result = applyDuplicateResults(resolvedRows, { existingGigs });
    expect(result[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result[0].duplicate.existingGigId).toBe("gig-1");
    expect(result[0].rowState).toBe(ROW_STATES.EXACT_DUPLICATE);
  });

  it("U: two rows with different raw venue text, both later confirmed to the same venue UUID, become exact_in_batch after resolution", () => {
    const resolvedRows = [
      row({ id: "r1", venueMatch: { tier: "confirmed", query: "Platform Tavern", city: "Southampton", match: { id: "v1", name: "Platform Tavern", city: "Southampton" }, candidates: [] } }),
      row({ id: "r2", venueMatch: { tier: "confirmed", query: "The Platform Tavern", city: "Southampton", match: { id: "v1", name: "Platform Tavern", city: "Southampton" }, candidates: [] } }),
    ];
    const result = applyDuplicateResults(resolvedRows, { existingGigs: [] });
    expect(result[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result[1].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("V: same for artist identity -- two rows with different raw artist text, both confirmed to the same artist profile, become exact_in_batch", () => {
    const resolvedRows = [
      row({
        id: "r1",
        venueMatch: { tier: "exact", query: "Southampton 1865", city: null, match: { id: "v1", name: "Southampton 1865", city: null }, candidates: [] },
        artistMatch: { tier: "confirmed", query: "Chicago9", match: { id: "a1", name: "Chicago 9", city: null, profileType: "band" }, candidates: [] },
      }),
      row({
        id: "r2",
        venueMatch: { tier: "exact", query: "Southampton 1865", city: null, match: { id: "v1", name: "Southampton 1865", city: null }, candidates: [] },
        artistMatch: { tier: "confirmed", query: "Chicago 9 (Live)", match: { id: "a1", name: "Chicago 9", city: null, profileType: "band" }, candidates: [] },
      }),
    ];
    const result = applyDuplicateResults(resolvedRows, { existingGigs: [] });
    expect(result[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result[1].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("W: a post-resolution exact duplicate becomes locked from selection/import (isLocked -> true, matching a pre-resolution exact duplicate exactly)", () => {
    const resolvedRows = [
      row({
        id: "r1",
        venueMatch: { tier: "confirmed", query: "The Platform", city: "Southampton", match: { id: "v1", name: "Platform Tavern", city: "Southampton" }, candidates: [] },
      }),
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Platform Tavern" }];
    const result = applyDuplicateResults(resolvedRows, { existingGigs });
    expect(isLocked(result[0].rowState)).toBe(true);
  });

  it("X: a post-resolution warning (near tier, newly discovered only because resolved identity now passes the same-venue gate) retains the existing IMPORT_ANYWAY-eligible, non-locked behaviour", () => {
    const resolvedRows = [
      row({
        id: "r1",
        // fields.venueName is required here (not just venueMatch) because
        // the "near" tier's own same-venue gate is unchanged by Phase 2F
        // -- it still derives its own text key from `fields`, independent
        // of venueMatch's tier.
        fields: { artistName: "Day Fever - Bournemouth", date: "2026-09-26", venueName: "O2 Academy Bournemouth", time: null },
        venueMatch: { tier: "confirmed", query: "O2 Academy", city: "Bournemouth", match: { id: "v1", name: "O2 Academy Bournemouth", city: "Bournemouth" }, candidates: [] },
      }),
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Day Fever", date: "2026-09-26", time: null, venue_id: "v1", venue: "O2 Academy Bournemouth" }];
    const result = applyDuplicateResults(resolvedRows, { existingGigs });
    expect(result[0].duplicate.tier).toBe(DUPLICATE_TIERS.NEAR_EXISTING);
    expect(isLocked(result[0].rowState)).toBe(false);
  });

  it("Y: an old warning override (resolvedBatch's own duplicate already downgraded to 'none' via IMPORT_ANYWAY) cannot suppress a newly-discovered exact duplicate", () => {
    const resolvedRows = [
      row({
        id: "r1",
        venueMatch: { tier: "confirmed", query: "The Platform", city: "Southampton", match: { id: "v1", name: "Platform Tavern", city: "Southampton" }, candidates: [] },
        // Simulates composeResolvedRow's own output after an admin
        // clicked "Import Anyway" on some EARLIER near-tier warning for
        // this row -- duplicate.tier is "none" going into this function,
        // exactly as applyDuplicateRowOverride/applyDuplicateGroupDecision
        // would leave it.
        duplicate: NONE_DUPLICATE,
      }),
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Platform Tavern" }];
    const result = applyDuplicateResults(resolvedRows, { existingGigs });
    expect(result[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(isLocked(result[0].rowState)).toBe(true);
  });

  it("Z: Freya-style legitimate multi-performance rows (same confirmed venue/artist, same date, times hours apart) remain importable after the post-resolution recheck", () => {
    const freyaRow = (id, time) =>
      row({
        id,
        fields: { artistName: "Freya Golding", date: "2026-09-12", time },
        venueMatch: { tier: "confirmed", query: "Marlands", city: "Southampton", match: { id: "v-marlands", name: "Marlands Shopping Centre", city: "Southampton" }, candidates: [] },
        artistMatch: { tier: "confirmed", query: "Freya Golding", match: { id: "a-freya", name: "Freya Golding", city: null, profileType: "solo_artist" }, candidates: [] },
      });
    const resolvedRows = [freyaRow("r1", "12:35"), freyaRow("r2", "15:35")];
    const result = applyDuplicateResults(resolvedRows, { existingGigs: [] });
    expect(result[0].duplicate.tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result[1].duplicate.tier).toBe(DUPLICATE_TIERS.NONE);
    expect(isLocked(result[0].rowState)).toBe(false);
    expect(isLocked(result[1].rowState)).toBe(false);
  });

  it("preserves every other field on the row untouched (venueMatch, artistMatch, fields, raw, status)", () => {
    const resolvedRows = [row({ id: "r1" })];
    const result = applyDuplicateResults(resolvedRows, { existingGigs: [] });
    expect(result[0].venueMatch).toEqual(resolvedRows[0].venueMatch);
    expect(result[0].artistMatch).toEqual(resolvedRows[0].artistMatch);
    expect(result[0].fields).toEqual(resolvedRows[0].fields);
    expect(result[0].raw).toBe(resolvedRows[0].raw);
    expect(result[0].status).toBe(resolvedRows[0].status);
  });

  it("defaults existingGigs to an empty array when omitted", () => {
    const resolvedRows = [row({ id: "r1" })];
    expect(() => applyDuplicateResults(resolvedRows)).not.toThrow();
  });
});
