// Structured venue-address bulk import (Music in the City) -- traces a
// small synthetic CSV (Artist/Venue/Address/City/Date/Time/Genre) through
// the full pipeline: parse -> match -> group -> approve -> import payload.
// Pins down the end-to-end claims from the investigation: a supplied
// address survives every stage, a repeated new venue across many rows
// resolves through exactly one grouped decision, the approved address
// reaches every affected gig's import payload identically, address stays
// optional, and an existing matched venue's address is never touched.
import { describe, it, expect } from "vitest";
import { parseImportText } from "./parser.js";
import { runMatching } from "./runMatching.js";
import { groupMissingVenues, VENUE_MISSING_ACTIONS } from "./venueResolutionGroups.js";
import { composeResolvedRow } from "./groupResolution.js";
import { buildGigInsertPayload } from "./importEngine.js";

const csv = [
  "Artist,Venue,Address,City,Date,Time,Genre",
  "The Mafia,The New Room,12 High Street,Southampton,2026-09-04,20:00,Indie Rock",
  "Chicago9,The New Room,12 High Street,Southampton,2026-09-11,19:30,Rock",
  "Fleetingwood Mac,The New Room,12 High Street,Southampton,2026-09-18,20:00,Tribute",
].join("\n");

describe("structured venue-address bulk import -- full pipeline", () => {
  it("a repeated new venue across multiple rows resolves through exactly one grouped decision, and the approved address reaches every gig's import payload", async () => {
    const parseResult = parseImportText(csv);
    expect(parseResult.rows).toHaveLength(3);
    expect(parseResult.rows.every((r) => r.fields.venueAddress === "12 High Street")).toBe(true);

    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });
    expect(batch.every((r) => r.venueMatch.tier === "none")).toBe(true);

    const groups = groupMissingVenues(batch);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toHaveLength(3);
    expect(groups[0].suggestedAddress).toBe("12 High Street");

    // One admin decision, as if "Approve New Venue" was clicked once for
    // the whole group -- the prefilled address (App.jsx's
    // VenueMissingGroupRow seeds its input from group.suggestedAddress) is
    // approved as-is here.
    const decision = {
      kind: "venue_missing", action: VENUE_MISSING_ACTIONS.APPROVE_NEW,
      approvedNewVenueName: "The New Room", approvedNewVenueCity: "Southampton",
      approvedNewVenueAddress: groups[0].suggestedAddress,
    };

    const resolvedRows = batch.map((r) => composeResolvedRow(r, { venueGroupDecision: decision }));
    const payloads = resolvedRows.map((r) => buildGigInsertPayload(r));

    // Every gig imports against the SAME new venue name/city/address.
    expect(payloads).toHaveLength(3);
    for (const payload of payloads) {
      expect(payload.venue).toBe("The New Room");
      expect(payload.city).toBe("Southampton");
      expect(payload.venue_address).toBe("12 High Street");
    }
  });

  it("the same new venue without a supplied address still resolves and imports -- address remains optional, never required", async () => {
    const noAddressCsv = ["Artist,Venue,City,Date,Time", "The Mafia,The New Room,Southampton,2026-09-04,20:00"].join("\n");
    const parseResult = parseImportText(noAddressCsv);
    const batch = await runMatching(parseResult, { venues: [], artistProfiles: [], existingGigs: [] });
    const groups = groupMissingVenues(batch);
    expect(groups[0].suggestedAddress).toBeNull();

    const decision = {
      kind: "venue_missing", action: VENUE_MISSING_ACTIONS.APPROVE_NEW,
      approvedNewVenueName: "The New Room", approvedNewVenueCity: "Southampton",
    };
    const resolved = composeResolvedRow(batch[0], { venueGroupDecision: decision });
    const payload = buildGigInsertPayload(resolved);
    expect(payload.venue).toBe("The New Room");
    expect(payload.venue_address).toBeNull();
  });

  it("an existing matched venue's own address is never sent, even when the imported row carried its own address text", async () => {
    const existingVenues = [{ id: "v1", name: "The Brook", city: "Southampton", name_normalised: "the brook" }];
    const csvWithExistingVenue = [
      "Artist,Venue,Address,City,Date,Time",
      "The Mafia,The Brook,999 Should Never Be Used,Southampton,2026-09-04,20:00",
    ].join("\n");
    const parseResult = parseImportText(csvWithExistingVenue);
    const batch = await runMatching(parseResult, { venues: existingVenues, artistProfiles: [], existingGigs: [] });
    expect(batch[0].venueMatch.tier).toBe("exact");

    const payload = buildGigInsertPayload(batch[0]);
    expect(payload.venue).toBe("The Brook"); // canonical existing name, not raw text
    expect(payload.city).toBe("Southampton");
    expect(payload.venue_address).toBeNull(); // never carries the imported address text through
  });
});
