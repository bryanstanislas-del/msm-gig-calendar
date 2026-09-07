import { describe, it, expect } from "vitest";
import { applyDuplicateResults } from "./postResolutionDuplicates.js";
import { DUPLICATE_TIERS } from "./duplicateDetection.js";
import { ROW_STATES, isLocked } from "./reviewBatch.js";
import { runMatching } from "./runMatching.js";
import { composeResolvedRow } from "./groupResolution.js";
import { VENUE_FUZZY_ACTIONS } from "./venueResolutionGroups.js";
import { ARTIST_FUZZY_ACTIONS } from "./artistResolutionGroups.js";

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

// Phase 2F independent review, "CRITICAL FALLBACK REGRESSION REVIEW":
// venueIdentity()/artistIdentity() use the matched entity's CANONICAL name
// as the text fallback for an identity-bearing (exact/confirmed) tier, not
// the row's raw incoming text (see duplicateDetection.js's own header
// comment). Called on an already-confirmed row in isolation, that means a
// historical, unlinked existing gig whose OWN text matches the raw
// incoming text -- but not the canonical name -- would NOT be found by
// detectDuplicates() alone (see this file's Cases B/F above, which
// deliberately test the case where canonical and gig text already agree,
// not this one).
//
// These tests prove the FULL pipeline is not exposed to that gap: the
// one-time detectDuplicates() pass inside runMatching() runs BEFORE any
// confirmation, when the row's tier is still "fuzzy"/"none" -- a
// non-identity-bearing tier, so venueIdentity()/artistIdentity() still use
// raw text for that call, completely unaffected by Phase 2F -- and
// correctly flags the row against the historical gig's raw text right
// then. applyDuplicateResults()'s moreSevere() (see this module's own
// header comment) then never lets the POST-confirmation fresh result
// (which would compute "none" via canonical text) downgrade that
// already-established finding. Exercises the real runMatching() +
// composeResolvedRow() + applyDuplicateResults() pipeline end to end, not
// just detectDuplicates() in isolation -- so a future change that broke
// this protection (e.g. the prior duplicate no longer carrying through
// resolvedRows, or moreSevere()'s comparison direction flipping) would
// fail these tests even though the Cases above would keep passing.
describe("Phase 2F regression: full-pipeline canonical-text-fallback safety (independent review Cases F1/F2/F3)", () => {
  it("F1 (venue): raw text matches a historical unlinked gig; confirming the row to a differently-worded canonical venue name must not un-flag it", async () => {
    const parseResult = {
      rows: [
        {
          id: "r1",
          status: "ok",
          raw: "Biohazard - The Platform Tavern - 05/08/2026 19:30",
          fields: {
            artistName: "Biohazard",
            venueName: "The Platform Tavern",
            city: null,
            date: "2026-08-05",
            time: "19:30",
            genre: null,
            notes: null,
            ticketUrl: null,
          },
        },
      ],
    };
    // Historical gig: never linked to a real venue row (venue_id: null),
    // and its own text matches the row's RAW incoming venue text, not the
    // canonical name it will later be confirmed to.
    const existingGigs = [
      { id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: null, venue: "The Platform Tavern" },
    ];
    const searchFn = async (entityType) =>
      entityType === "venue" ? [{ id: "v1", name: "Platform Tavern", city: "Southampton", similarity_score: 0.6 }] : [];

    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs, searchFn });
    // Sanity: the ONE-TIME initial pass (raw text, pre-confirmation) must
    // already have caught this -- if it hasn't, the rest of this test
    // proves nothing about the protection it's meant to verify.
    expect(batch[0].venueMatch.tier).toBe("fuzzy");
    expect(batch[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);

    const resolved = composeResolvedRow(batch[0], {
      venueGroupDecision: {
        kind: "venue_fuzzy",
        action: VENUE_FUZZY_ACTIONS.ACCEPT_SUGGESTED,
        resolvedVenue: { id: "v1", name: "Platform Tavern", city: "Southampton" },
      },
    });
    expect(resolved.venueMatch.tier).toBe("confirmed");

    const final = applyDuplicateResults([resolved], { existingGigs });
    expect(final[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(final[0].duplicate.existingGigId).toBe("gig-1");
    expect(final[0].rowState).toBe(ROW_STATES.EXACT_DUPLICATE);
    expect(isLocked(final[0].rowState)).toBe(true);
  });

  it("F2 (artist): raw text matches a historical unlinked gig; confirming the row to a differently-worded canonical artist name must not un-flag it", async () => {
    const parseResult = {
      rows: [
        {
          id: "r1",
          status: "ok",
          raw: "Chicago9 - Southampton 1865 - 05/08/2026 19:30",
          fields: {
            artistName: "Chicago9",
            venueName: "Southampton 1865",
            city: null,
            date: "2026-08-05",
            time: "19:30",
            genre: null,
            notes: null,
            ticketUrl: null,
          },
        },
      ],
    };
    // Historical gig: never linked to a real artist profile
    // (band_profile_id: null), its own text matches the row's RAW
    // incoming artist text, not the canonical name it will be confirmed to.
    const existingGigs = [
      {
        id: "gig-1",
        band_name: "Chicago9",
        band_profile_id: null,
        date: "2026-08-05",
        time: "19:30",
        venue_id: "v-1865",
        venue: "Southampton 1865",
      },
    ];
    const searchFn = async (entityType) => {
      if (entityType === "venue") return [{ id: "v-1865", name: "Southampton 1865", city: null, similarity_score: 0.9 }];
      return [{ id: "a1", name: "Chicago 9 Rhythm & Blues Band", city: null, similarity_score: 0.6, profileType: "band" }];
    };

    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs, searchFn });
    expect(batch[0].artistMatch.tier).toBe("fuzzy");
    // The initial pass's own venue side also starts fuzzy here -- exact
    // identity requires BOTH sides to agree, so confirm the pre-existing
    // raw-text venue match already lines up with the historical gig too,
    // otherwise this fixture wouldn't isolate the artist-side question.
    expect(batch[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);

    let resolved = composeResolvedRow(batch[0], {
      venueGroupDecision: {
        kind: "venue_fuzzy",
        action: VENUE_FUZZY_ACTIONS.ACCEPT_SUGGESTED,
        resolvedVenue: { id: "v-1865", name: "Southampton 1865", city: null },
      },
    });
    resolved = composeResolvedRow(resolved, {
      artistGroupDecision: {
        kind: "artist_fuzzy",
        action: ARTIST_FUZZY_ACTIONS.ACCEPT_SUGGESTED,
        resolvedArtist: { id: "a1", name: "Chicago 9 Rhythm & Blues Band", city: null, profileType: "band" },
      },
    });
    expect(resolved.artistMatch.tier).toBe("confirmed");

    const final = applyDuplicateResults([resolved], { existingGigs });
    expect(final[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(final[0].duplicate.existingGigId).toBe("gig-1");
    expect(final[0].rowState).toBe(ROW_STATES.EXACT_DUPLICATE);
    expect(isLocked(final[0].rowState)).toBe(true);
  });

  it("F3 (inverse benefit): raw text does NOT match a historical unlinked gig, but the confirmed canonical name does -- the post-resolution pass catches what the initial raw-text pass missed", async () => {
    const parseResult = {
      rows: [
        {
          id: "r1",
          status: "ok",
          raw: "Biohazard - The Platform - 05/08/2026 19:30",
          fields: {
            artistName: "Biohazard",
            venueName: "The Platform",
            city: null,
            date: "2026-08-05",
            time: "19:30",
            genre: null,
            notes: null,
            ticketUrl: null,
          },
        },
      ],
    };
    // Historical gig's own text is the CANONICAL venue name, not the raw
    // "The Platform" the row was parsed with -- the initial raw-text pass
    // cannot see this relationship at all.
    const existingGigs = [
      { id: "gig-1", band_name: "Biohazard", date: "2026-08-05", time: "19:30", venue_id: null, venue: "Platform Tavern" },
    ];
    const searchFn = async (entityType) =>
      entityType === "venue" ? [{ id: "v1", name: "Platform Tavern", city: "Southampton", similarity_score: 0.6 }] : [];

    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs, searchFn });
    // Sanity: the initial pass genuinely misses this -- proving the second
    // pass is what catches it, not a coincidence of the fixture.
    expect(batch[0].duplicate.tier).toBe(DUPLICATE_TIERS.NONE);

    const resolved = composeResolvedRow(batch[0], {
      venueGroupDecision: {
        kind: "venue_fuzzy",
        action: VENUE_FUZZY_ACTIONS.ACCEPT_SUGGESTED,
        resolvedVenue: { id: "v1", name: "Platform Tavern", city: "Southampton" },
      },
    });

    const final = applyDuplicateResults([resolved], { existingGigs });
    expect(final[0].duplicate.tier).toBe(DUPLICATE_TIERS.EXACT_EXISTING);
    expect(final[0].duplicate.existingGigId).toBe("gig-1");
    expect(isLocked(final[0].rowState)).toBe(true);
  });
});
