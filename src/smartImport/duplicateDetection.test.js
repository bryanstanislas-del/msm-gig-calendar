import { describe, it, expect } from "vitest";
import { detectDuplicates, DUPLICATE_TIERS, TIME_TOLERANCE_MINUTES } from "./duplicateDetection.js";

const exactVenueMatch = (id, name, city) => ({ tier: "exact", match: { id, name, city } });
const noVenueMatch = { tier: "none", match: null };
const confirmedVenueMatch = (id, name, city) => ({ tier: "confirmed", query: "irrelevant raw text", city, match: { id, name, city }, candidates: [] });
const fuzzyVenueMatch = (candidateId, candidateName) => ({ tier: "fuzzy", query: "The Platform", match: null, candidates: [{ id: candidateId, name: candidateName, city: null, similarity_score: 0.9 }] });
const approvedNewVenueMatch = (name, city) => ({ tier: "approved_new", query: name, city, match: null, candidates: [] });
const confirmedArtistMatch = (id, name) => ({ tier: "confirmed", query: "irrelevant raw text", match: { id, name, city: null, profileType: "band" }, candidates: [] });
const fuzzyArtistMatch = (candidateId, candidateName) => ({ tier: "fuzzy", query: "some raw text", match: null, candidates: [{ id: candidateId, name: candidateName, city: null, similarity_score: 0.9 }] });

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

// Phase 2F: post-resolution entity-identity duplicate detection. UUID vs
// UUID only when BOTH sides carry an authoritative one (exact/confirmed
// tier, or a real existing-gig column); text vs text (the pre-existing,
// unchanged fallback) whenever either side lacks one. Never id: vs name:.
describe("detectDuplicates -- Phase 2F identity primitives (venue)", () => {
  it("A: confirmed venue UUID vs existing gig's same venue_id, same artist/date/time -> exact_existing", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v1", "Platform Tavern", "Southampton") },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Platform Tavern" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("B: confirmed venue UUID, existing gig has NO venue_id but normalised venue text matches -> exact_existing via text fallback", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v1", "Platform Tavern", "Southampton") },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: null, venue: "Platform   Tavern" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("B (never id: vs name:): confirmed venue UUID does NOT match an unlinked existing gig whose text genuinely differs", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v1", "Platform Tavern", "Southampton") },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: null, venue: "The Joiners" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("C: two batch rows with different raw venue text, both confirmed to the same venue UUID, same artist/date/time -> exact_in_batch", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v1", "Platform Tavern", "Southampton") },
      { id: "r2", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v1", "Platform Tavern", "Southampton") },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r1").withRowIds).toEqual(["r2"]);
  });

  it("D: same raw venue name but DIFFERENT confirmed venue UUIDs -> not a duplicate solely from venue text", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v1", "The Crown", "Southampton") },
      { id: "r2", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v2", "The Crown", "Portsmouth") },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("I: same venue name in different cities remains distinct against an existing gig too (uuid vs uuid, not text)", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: confirmedVenueMatch("v1", "The Crown", "Southampton") },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v2", venue: "The Crown" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
  });
});

describe("detectDuplicates -- Phase 2F identity primitives (artist)", () => {
  it("E: confirmed artist UUID vs existing gig's same band_profile_id, same venue/date/time -> exact_existing", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Chicago9", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: confirmedArtistMatch("a1", "Chicago 9") },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Chicago 9", band_profile_id: "a1", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Southampton 1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("F: confirmed artist UUID, existing gig has NO band_profile_id but normalised band_name matches -> exact_existing via text fallback", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Chicago9", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: confirmedArtistMatch("a1", "Biohazard") },
    ];
    // The gig's own text ("Biohazard") matches the CONFIRMED artist's own
    // canonical name, not the row's raw (irrelevant) query -- mirrors
    // resolveVenueFields()'s own precedent for a confirmed match's text.
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", band_profile_id: null, date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Southampton 1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-1");
  });

  it("G: two differently-written artist names, both confirmed to the same artist UUID, same venue/date/time -> exact_in_batch", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Chicago9", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: confirmedArtistMatch("a1", "Chicago 9") },
      { id: "r2", fields: { artistName: "Chicago 9 (Live)", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: confirmedArtistMatch("a1", "Chicago 9") },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("H: identical artist text but DIFFERENT confirmed artist UUIDs -> not a duplicate solely from artist text", () => {
    const rows = [
      { id: "r1", fields: { artistName: "The Crown", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: confirmedArtistMatch("a1", "The Crown") },
      { id: "r2", fields: { artistName: "The Crown", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: confirmedArtistMatch("a2", "The Crown") },
    ];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });
});

describe("detectDuplicates -- Phase 2F: fuzzy/unconfirmed suggestions never become identity", () => {
  it("I (fuzzy venue): a fuzzy venue candidate sharing an existing gig's venue_id is NOT authoritative -- text fallback used instead, and does not spuriously match", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: fuzzyVenueMatch("v1", "Platform Tavern") },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Platform Tavern" }];
    const result = detectDuplicates(rows, { existingGigs });
    // The row's own raw query ("The Platform") is the text fallback used
    // for a fuzzy (unconfirmed) tier -- it does not match the existing
    // gig's own text ("Platform Tavern") merely because a fuzzy candidate
    // happens to share the gig's real venue_id. No auto-resolution.
    expect(result.get("r1").tier).not.toBe(DUPLICATE_TIERS.EXACT_EXISTING);
  });

  it("J (fuzzy artist): a fuzzy artist candidate sharing an existing gig's band_profile_id is NOT authoritative", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Some Raw Text", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: fuzzyArtistMatch("a1", "Biohazard") },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", band_profile_id: "a1", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Southampton 1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).not.toBe(DUPLICATE_TIERS.EXACT_EXISTING);
  });

  it("K (approved_new venue): no stale candidate UUID identity -- text fallback is used (unchanged pre-Phase-2F behaviour for this tier), never the id of whatever candidate was rejected in favour of NEW", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", venueName: "Brand New Venue", time: "19:30" }, venueMatch: approvedNewVenueMatch("Brand New Venue", "Fareham") },
    ];
    // A rejected fuzzy candidate ("v1") must never leak into identity just
    // because the row's tier is now "approved_new" -- confirmed here by an
    // existing gig that legitimately shares that same "v1" id under a
    // completely different venue name: this row must not match it.
    const existingGigs = [{ id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Platform Tavern" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("L (no equivalent 'approved_new' artist state exists in current architecture): a 'none' tier artist never carries stale identity either", () => {
    const rows = [
      { id: "r1", fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" }, venueMatch: exactVenueMatch("v1", "Southampton 1865", null), artistMatch: { tier: "none", query: "Biohazard", match: null, candidates: [] } },
    ];
    const existingGigs = [{ id: "gig-1", band_name: "Someone Else", band_profile_id: "a9", date: "2026-08-05", time: "19:30", venue_id: "v1", venue: "Southampton 1865" }];
    const result = detectDuplicates(rows, { existingGigs });
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
  });
});

describe("detectDuplicates -- Phase 2F: Phase #23 time semantics preserved with resolved identity", () => {
  const confirmedRow = (id, time) => ({
    id,
    // fields.venueName is set (not just venueMatch) because the "near"
    // tier's own same-venue gate is deliberately untouched by Phase 2F --
    // it still derives its own text key from `fields` via venueKeyFor,
    // completely independent of venueMatch's tier -- so it needs a real
    // value here for these mixed exact/near time-boundary cases to reach
    // that gate at all, exactly as any real parsed row would.
    fields: { artistName: "Chicago9", date: "2026-09-12", venueName: "Marlands Shopping Centre", time },
    venueMatch: confirmedVenueMatch("v-marlands", "Marlands Shopping Centre", "Southampton"),
    artistMatch: confirmedArtistMatch("a1", "Chicago 9"),
  });

  it("M: equal meaningful time -> exact", () => {
    const rows = [confirmedRow("r1", "12:35"), confirmedRow("r2", "12:35")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.EXACT_IN_BATCH);
  });

  it("N: 5-minute difference -> warning, not exact", () => {
    const rows = [confirmedRow("r1", "12:35"), confirmedRow("r2", "12:40")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("O: 10-minute (tolerance boundary, inclusive) difference -> warning", () => {
    const rows = [confirmedRow("r1", "12:35"), confirmedRow("r2", "12:45")];
    expect(TIME_TOLERANCE_MINUTES).toBe(10);
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("P: 11-minute difference -> none", () => {
    const rows = [confirmedRow("r1", "12:35"), confirmedRow("r2", "12:46")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("Q: Freya-style 12:35 vs 15:35 -> none (both remain legitimate separate performances)", () => {
    const rows = [confirmedRow("r1", "12:35"), confirmedRow("r2", "15:35")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NONE);
  });

  it("R: one row missing/TBC time -> existing warning semantics preserved", () => {
    const rows = [confirmedRow("r1", "12:35"), confirmedRow("r2", "TBC")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });

  it("S: both rows missing/unparseable time -> existing warning semantics preserved, never Exact", () => {
    const rows = [confirmedRow("r1", null), confirmedRow("r2", "TBC")];
    const result = detectDuplicates(rows);
    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
    expect(result.get("r2").tier).toBe(DUPLICATE_TIERS.NEAR_IN_BATCH);
  });
});
