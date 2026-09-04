import { describe, it, expect } from "vitest";
import { fetchAllPages } from "../App.jsx";
import { detectDuplicates, DUPLICATE_TIERS } from "./duplicateDetection.js";

// Section 4 (CRITICAL) regression: Smart Import's duplicate detection must
// see the FULL existing-gigs set, not just the first 1,000-row API page.
// runReview() builds `existingGigs` from DB.getAllGigs(), which is now
// backed by fetchAllPages -- this test proves that composition end-to-end
// using the real, unmodified detectDuplicates()/DUPLICATE_TIERS (PR #23
// matching rules untouched) against a fixture explicitly larger than one
// page, with the matching existing gig placed at index 1050 (page 2 under
// the default 1000-row page size).

describe("Smart Import duplicate detection against a paginated existingGigs set", () => {
  it("detects a duplicate against an existing approved gig located beyond the first API page", async () => {
    const filler = Array.from({ length: 1050 }, (_, i) => ({
      id: `filler-${i}`,
      band_name: `Filler Band ${i}`,
      date: "2026-01-01",
      time: "19:00",
      venue_id: "v-filler",
      venue: "Filler Venue",
    }));
    const targetGig = {
      id: "gig-page2-target",
      band_name: "Biohazard",
      date: "2026-08-05",
      time: "19:30",
      venue_id: "v1",
      venue: "Southampton 1865",
    };
    const table = [...filler, targetGig];

    // Simulates the real DB.getAllGigs() -> fetchAllPages(...) composition:
    // a paginated fetcher standing in for the mocked supabase .range() calls.
    const fetchPage = (from, to) =>
      Promise.resolve({ data: table.slice(from, to + 1), error: null });

    const existingGigs = await fetchAllPages(fetchPage, { pageSize: 1000 });

    // Sanity: the target really did land on page 2, not page 1.
    expect(existingGigs.length).toBe(1051);
    expect(existingGigs[1050]).toBe(targetGig);

    const rows = [
      {
        id: "r1",
        fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" },
        venueMatch: { tier: "exact", match: { id: "v1", name: "Southampton 1865", city: null } },
      },
    ];

    const result = detectDuplicates(rows, { existingGigs });

    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(result.get("r1").existingGigId).toBe("gig-page2-target");
  });

  it("would have MISSED the same duplicate under the old unbounded/truncated fetch behaviour (control case)", async () => {
    // Demonstrates the bug this fix removes: taking only the first 1,000
    // rows (the old effective behaviour once a table exceeds Supabase's
    // Max Rows ceiling) drops the target gig entirely, so the very same
    // incoming row is missed and imported as a fresh duplicate gig.
    const filler = Array.from({ length: 1050 }, (_, i) => ({
      id: `filler-${i}`,
      band_name: `Filler Band ${i}`,
      date: "2026-01-01",
      time: "19:00",
      venue_id: "v-filler",
      venue: "Filler Venue",
    }));
    const targetGig = {
      id: "gig-page2-target",
      band_name: "Biohazard",
      date: "2026-08-05",
      time: "19:30",
      venue_id: "v1",
      venue: "Southampton 1865",
    };
    const table = [...filler, targetGig];
    const truncatedExistingGigs = table.slice(0, 1000);

    const rows = [
      {
        id: "r1",
        fields: { artistName: "Biohazard", date: "2026-08-05", time: "19:30" },
        venueMatch: { tier: "exact", match: { id: "v1", name: "Southampton 1865", city: null } },
      },
    ];

    const result = detectDuplicates(rows, { existingGigs: truncatedExistingGigs });

    expect(result.get("r1").tier).toBe(DUPLICATE_TIERS.NONE);
  });
});
