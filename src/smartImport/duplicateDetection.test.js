import { describe, it, expect } from "vitest";
import { detectDuplicates, DUPLICATE_TIERS } from "./duplicateDetection.js";

const exactVenueMatch = (id, name, city) => ({ tier: "exact", match: { id, name, city } });
const noVenueMatch = { tier: "none", match: null };

describe("detectDuplicates", () => {
  it("flags an exact within-batch duplicate cluster (both rows, not just the second)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Jamie Webster", date: "2026-09-05" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
      { id: "r2", fields: { artistName: "Jamie Webster", date: "2026-09-05" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r1").withRowIds).toEqual(["r2"]);
  });

  it("flags a capitalisation-only duplicate cluster as exact (normalisation is case-insensitive)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Overpass", date: "2026-11-10" }, venueMatch: exactVenueMatch("v1", "The Brook", null) },
      { id: "r2", fields: { artistName: "overpass", date: "2026-11-10" }, venueMatch: exactVenueMatch("v1", "The Brook", null) },
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

  it("flags a row that matches an existing gig in the database, taking precedence over an in-batch cluster", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null) },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "biohazard", date: "2026-08-05", venue_id: "v1", venue: "Southampton 1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("falls back to normalised venue text when no exact venueMatch is available for the existing-gig check", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", venueName: "Southampton 1865" }, venueMatch: noVenueMatch },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", venue_id: null, venue: "Southampton   1865" }];
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
});
