import { describe, it, expect } from "vitest";
import { detectDuplicates, DUPLICATE_TIERS, TIME_TOLERANCE_MINUTES } from "./duplicateDetection.js";

const exactVenueMatch = (id, name, city) => ({ tier: "exact", match: { id, name, city } });
const noVenueMatch = { tier: "none", match: null };

describe("detectDuplicates", () => {
  it("flags an exact within-batch duplicate cluster when times match exactly (both rows, not just the second)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Jamie Webster", date: "2026-09-05", time: "20:00" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
      { id: "r2", fields: { artistName: "Jamie Webster", date: "2026-09-05", time: "20:00" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r1").withRowIds).toEqual(["r2"]);
  });

  it("flags a capitalisation-only duplicate cluster as exact when times match (normalisation is case-insensitive)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Overpass", date: "2026-11-10", time: "19:00" }, venueMatch: exactVenueMatch("v1", "The Brook", null) },
      { id: "r2", fields: { artistName: "overpass", date: "2026-11-10", time: "19:00" }, venueMatch: exactVenueMatch("v1", "The Brook", null) },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("flags a near-duplicate cluster where one artist name has a trailing location suffix", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Day Fever", date: "2026-09-26" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
      { id: "r2", fields: { artistName: "Day Fever - Bournemouth", date: "2026-09-26" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("does not flag two different near-duplicate clusters against each other (different venues)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Day Fever", date: "2026-09-26" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
      { id: "r2", fields: { artistName: "Day Fever - Southampton", date: "2026-09-26" }, venueMatch: exactVenueMatch("v2", "O2 Guildhall Southampton", null) },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("does not flag unrelated rows (different artist, date, and venue)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
      { id: "r2", fields: { artistName: "Avatar", date: "2026-11-21" }, venueMatch: exactVenueMatch("v2", "O2 Guildhall Southampton", null) },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("flags a row that matches an existing gig in the database when times match, taking precedence over an in-batch cluster", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Southampton 1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("falls back to normalised venue text when no exact venueMatch is available for the existing-gig check, when times match", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", venueName: "Southampton 1865", time: "19:30" }, venueMatch: noVenueMatch },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: null, venue: "Southampton   1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("never flags rows that lack the fields needed to build a usable key", () => {
    const rows = [
      { id: "r1", fields: { artistName: null, date: null }, venueMatch: noVenueMatch },
      { id: "r2", fields: { artistName: null, date: null }, venueMatch: noVenueMatch },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("flags 'near_existing' for a near-match (trailing-words artist variant) against a live gig, same date + venue", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Day Fever - Bournemouth", date: "2026-09-26" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Day Fever", date: "2026-09-26", venue_id: "v1", venue: "O2 Academy Bournemouth" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("upgrades a 'near_in_batch' row to 'near_existing' when it also near-matches a live gig", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Day Fever", date: "2026-09-26" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
      { id: "r2", fields: { artistName: "Day Fever - Bournemouth", date: "2026-09-26" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
    ];
    // gig band_name near-matches r1 ("day fever") but not r2 ("day fever -
    // bournemouth") -- only r1 should upgrade; r2 stays near_in_batch since
    // it doesn't near-match this particular live gig.
    const existingGigs = [{ id: "gig-1", band_name: "Day Fever Live", date: "2026-09-26", venue_id: "v1", venue: "O2 Academy Bournemouth" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("never downgrades an 'exact_in_batch' row to 'near_existing' even if it would also near-match a live gig", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Jamie Webster", date: "2026-09-05", time: "20:00" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
      { id: "r2", fields: { artistName: "Jamie Webster", date: "2026-09-05", time: "20:00" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Jamie Webster Trio", date: "2026-09-05", venue_id: "v1", venue: "Southampton 1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("prefers 'exact_existing' over 'near_existing' when a row matches a live gig both exactly and near-matches another", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
    ];
    const existingGigs = [
      { id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Southampton 1865" },
      { id: "gig-2", band_name: "Biohazard Support", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Southampton 1865" },
    ];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("does not flag 'near_existing' for a different date or venue", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Day Fever - Bournemouth", date: "2026-09-27" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Day Fever", date: "2026-09-26", venue_id: "v1", venue: "O2 Academy Bournemouth" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
  });
});

// The real Music in the City 2026 regression: two legitimate separate
// performances by the same act at the same venue on the same day, wrongly
// locked as Exact Duplicate before this fix because time was absent from
// duplicate identity entirely. See duplicateDetection.js's own header
// comment for the full design reasoning.
describe("detectDuplicates -- time-aware duplicate identity (Freya Golding / Marlands Shopping Centre regression)", () => {
  const freyaRow = (id, time) => ({
    id,
    fields: { artistName: "Freya Golding", date: "2026-09-12", time },
    venueMatch: exactVenueMatch("v-marlands", "Marlands Shopping Centre", "Southampton"),
  });

  it("A: same artist + venue + date + identical time -> Exact Duplicate", () => {
    const rows = [freyaRow("r1", "12:35"), freyaRow("r2", "12:35")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("B: Freya Golding 12:35 vs 15:35 -- neither row classified as a duplicate solely because of the other", () => {
    const rows = [freyaRow("r1", "12:35"), freyaRow("r2", "15:35")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("C: 12:35 vs 12:40 (5 min apart) -> non-locked duplicate warning, not Exact", () => {
    const rows = [freyaRow("r1", "12:35"), freyaRow("r2", "12:40")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("D: 12:35 vs 12:45 (exactly the 10-minute tolerance boundary, inclusive) -> non-locked duplicate warning", () => {
    const rows = [freyaRow("r1", "12:35"), freyaRow("r2", "12:45")];
    const result = detectDuplicates(rows);
    expect(TIME_TOLERANCE_MINUTES).toBe(10);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("E: 12:35 vs 12:46 (just past the tolerance boundary) -> not a duplicate solely on same artist/venue/date", () => {
    const rows = [freyaRow("r1", "12:35"), freyaRow("r2", "12:46")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("F: one row has a meaningful time, the other has no time at all -> non-locked duplicate warning", () => {
    const rows = [freyaRow("r1", "12:35"), freyaRow("r2", null)];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("G: both rows have no meaningful time -> non-locked duplicate warning, NOT Exact", () => {
    const rows = [freyaRow("r1", null), freyaRow("r2", null)];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("H: existing DB gig at 12:35, incoming row at 15:35 -- must NOT become Exact or Probable, remains importable as a separate performance", () => {
    const rows = [freyaRow("r1", "15:35")];
    const existingGigs = [{ id: "gig-1", band_name: "Freya Golding", date: "2026-09-12", time: "12:35", venue_id: "v-marlands", venue: "Marlands Shopping Centre" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("I: existing DB gig with the same artist/venue/date/time -> Exact Existing", () => {
    const rows = [freyaRow("r1", "12:35")];
    const existingGigs = [{ id: "gig-1", band_name: "Freya Golding", date: "2026-09-12", time: "12:35", venue_id: "v-marlands", venue: "Marlands Shopping Centre" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("H variant: existing DB near-tolerance time (5 min apart) still surfaces as a non-locked Probable Duplicate, not blocked", () => {
    const rows = [freyaRow("r1", "12:40")];
    const existingGigs = [{ id: "gig-1", band_name: "Freya Golding", date: "2026-09-12", time: "12:35", venue_id: "v-marlands", venue: "Marlands Shopping Centre" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("J: time formatting variants representing the same actual time are still Exact (12:35 vs 12:35 written differently is trivially covered by A; this covers a 24h/12h variant)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Freya Golding", date: "2026-09-12", time: "20:00" }, venueMatch: exactVenueMatch("v-marlands", "Marlands Shopping Centre", "Southampton") },
      { id: "r2", fields: { artistName: "Freya Golding", date: "2026-09-12", time: "8:00pm" }, venueMatch: exactVenueMatch("v-marlands", "Marlands Shopping Centre", "Southampton") },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("K: an unparseable time never throws, and is treated the same as a missing time (safe non-locked behaviour)", () => {
    const rows = [freyaRow("r1", "TBC"), freyaRow("r2", "12:35")];
    expect(() => detectDuplicates(rows)).not.toThrow();
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("large time gaps (several hours) at the same artist/venue/date are never flagged as any kind of duplicate", () => {
    const rows = [freyaRow("r1", "12:35"), freyaRow("r2", "19:00")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("time ambiguity never applies across different artists -- a name-variant pair still uses the existing near-duplicate-artist path only", () => {
    // "Day Fever" vs "Day Fever - Bournemouth" at a wildly different time --
    // still near_in_batch via the pre-existing artist-name-variant path,
    // completely independent of the new time logic.
    const rows = [
      { id: "r1", fields: { artistName: "Day Fever", date: "2026-09-26", time: "12:00" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
      { id: "r2", fields: { artistName: "Day Fever - Bournemouth", date: "2026-09-26", time: "22:00" }, venueMatch: exactVenueMatch("v1", "O2 Academy Bournemouth", null) },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });
});
