import { describe, it, expect } from "vitest";
import { pickerReducer, createInitialPickerState, PICKER_STATUS } from "./pickerState.js";
import { venueFieldsFromPickerState, cityConflictsWithSelection, buildVenueUpdatePayload } from "./gigVenueFields.js";

const platformTavern = { id: "v-platform", name: "Platform Tavern", city: "Southampton", address: "Town Quay", postcode: "SO14 2NY" };

function typed(text) {
  return pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text });
}
function selectedPlatformTavern() {
  return pickerReducer(typed("Plat"), { type: "VENUE_SELECTED", venue: platformTavern });
}
function newVenueChosen(name) {
  return pickerReducer(typed(name), { type: "NEW_VENUE_CHOSEN", name });
}

describe("venueFieldsFromPickerState", () => {
  it("an existing selection returns the canonical venue_id/name/city (typed text plays no part)", () => {
    const fields = venueFieldsFromPickerState(selectedPlatformTavern(), { fallbackCity: "Some Stale City" });
    expect(fields).toEqual({ venue_id: "v-platform", venue: "Platform Tavern", city: "Southampton" });
  });

  it("an explicit new-venue choice returns venue_id: null and the form's current city (not any city from the picker)", () => {
    const fields = venueFieldsFromPickerState(newVenueChosen("Brand New Place"), { fallbackCity: "Southampton" });
    expect(fields).toEqual({ venue_id: null, venue: "Brand New Place", city: "Southampton" });
  });

  it("plain typing with no decision yet returns venue_id: null and the typed text", () => {
    const fields = venueFieldsFromPickerState(typed("Plat"), { fallbackCity: "Southampton" });
    expect(fields).toEqual({ venue_id: null, venue: "Plat", city: "Southampton" });
  });

  it("defaults fallbackCity to '' when not supplied", () => {
    expect(venueFieldsFromPickerState(typed("Plat"))).toEqual({ venue_id: null, venue: "Plat", city: "" });
  });
});

describe("cityConflictsWithSelection", () => {
  it("false when nothing is selected -- a plain free-text edit is never a 'conflict'", () => {
    expect(cityConflictsWithSelection(typed("Plat"), "Portsmouth")).toBe(false);
  });

  it("false when the new city matches the selected venue's canonical city (even with whitespace/case differences)", () => {
    const state = selectedPlatformTavern();
    expect(cityConflictsWithSelection(state, "Southampton")).toBe(false);
    expect(cityConflictsWithSelection(state, "  southampton ")).toBe(false);
    expect(cityConflictsWithSelection(state, "SOUTHAMPTON")).toBe(false);
  });

  it("true when the new city materially differs from the selected venue's canonical city", () => {
    const state = selectedPlatformTavern();
    expect(cityConflictsWithSelection(state, "Portsmouth")).toBe(true);
  });
});

describe("Admin Edit -- unrelated edits must not disturb an already-linked gig's venue_id", () => {
  it("a freshly-seeded (Admin Edit mount, nothing touched) picker state round-trips to the exact same venue_id/venue/city -- the onChange fired on mount is a no-op, not a silent clear", () => {
    const seeded = createInitialPickerState({ venue_id: "v-platform", name: "Platform Tavern", city: "Southampton" });
    expect(seeded.status).toBe(PICKER_STATUS.SELECTED);
    const fields = venueFieldsFromPickerState(seeded, { fallbackCity: "Southampton" });
    expect(fields).toEqual({ venue_id: "v-platform", venue: "Platform Tavern", city: "Southampton" });
  });

  it("the exact payload-merge saveEdit() performs never lets a stale editForm.venue/city survive alongside the freshly computed venue fields", () => {
    // Simulates saveEdit()'s own `{ ...editFormRest, ...venuePayload }`
    // merge for an UNRELATED edit (only `time` changed) on a gig that was
    // already linked to Platform Tavern and whose VenuePicker was never
    // touched -- editFormRest still carries the gig's own original
    // venue/city text (from openEdit's seed), and venuePayload (recomputed
    // from the picker's actual current state) must be what wins.
    const editFormRest = { band_name: "The Glorias", time: "20:00", status: "approved" }; // venue_id/venue/city already destructured out, as saveEdit() does
    const seededPickerState = createInitialPickerState({ venue_id: "v-platform", name: "Platform Tavern", city: "Southampton" });
    const venuePayload = buildVenueUpdatePayload(venueFieldsFromPickerState(seededPickerState, { fallbackCity: "Southampton" }));
    const finalPayload = { ...editFormRest, ...venuePayload };
    expect(finalPayload).toEqual({
      band_name: "The Glorias", time: "20:00", status: "approved",
      venue_id: "v-platform", venue: "Platform Tavern", city: "Southampton",
    });
  });
});

describe("Phase 2C payload shapes align with gig_auto_venue's PR #29 guards", () => {
  it("INSERT existing (Submit Gig / Admin Add selecting an existing venue): venue_id is present and non-null -- guard 1 trusts it, skips auto-matching", () => {
    const fields = venueFieldsFromPickerState(
      pickerReducer(createInitialPickerState(), { type: "VENUE_SELECTED", venue: { id: "v-platform", name: "Platform Tavern", city: "Southampton" } }),
      { fallbackCity: "Southampton" }
    );
    expect(fields.venue_id).toBe("v-platform");
  });

  it("UPDATE relink (Admin Edit selecting a DIFFERENT existing venue): venue_id is present and explicitly the new id -- guard 2 trusts the explicit change", () => {
    const fields = venueFieldsFromPickerState(
      pickerReducer(createInitialPickerState({ venue_id: "v-platform", name: "Platform Tavern", city: "Southampton" }), {
        type: "VENUE_SELECTED",
        venue: { id: "v-joiners", name: "The Joiners", city: "Southampton" },
      }),
      { fallbackCity: "Southampton" }
    );
    const payload = buildVenueUpdatePayload(fields);
    expect(payload).toEqual({ venue_id: "v-joiners", venue: "The Joiners", city: "Southampton" });
  });

  it("UPDATE unrelated (only time/genre/etc changed, venue untouched): venue_id is unchanged from the seeded value -- guard 3 (venue text unchanged) preserves it regardless", () => {
    const seeded = createInitialPickerState({ venue_id: "v-platform", name: "Platform Tavern", city: "Southampton" });
    const fields = venueFieldsFromPickerState(seeded, { fallbackCity: "Southampton" });
    expect(fields.venue_id).toBe("v-platform"); // identical to the seed -- nothing about the venue changed
  });

  it("UPDATE to new/free-text (Admin Edit switching an already-linked gig to an explicit new venue): venue_id key is OMITTED, not sent as null -- lets the trigger's normal matching/creation logic run instead of guard 2's null-passthrough", () => {
    const fields = venueFieldsFromPickerState(
      pickerReducer(createInitialPickerState({ venue_id: "v-platform", name: "Platform Tavern", city: "Southampton" }), {
        type: "NEW_VENUE_CHOSEN",
        name: "Totally New Venue",
      }),
      { fallbackCity: "Southampton" }
    );
    const payload = buildVenueUpdatePayload(fields);
    expect("venue_id" in payload).toBe(false);
    expect(payload).toEqual({ venue: "Totally New Venue", city: "Southampton" });
  });
});

describe("buildVenueUpdatePayload -- the trigger-compatibility rule (PR #29)", () => {
  it("includes venue_id when it is a real id", () => {
    const payload = buildVenueUpdatePayload({ venue_id: "v-platform", venue: "Platform Tavern", city: "Southampton" });
    expect(payload).toEqual({ venue_id: "v-platform", venue: "Platform Tavern", city: "Southampton" });
  });

  it("OMITS the venue_id key entirely when it is null -- never sends an explicit venue_id: null", () => {
    const payload = buildVenueUpdatePayload({ venue_id: null, venue: "Brand New Place", city: "Southampton" });
    expect(payload).toEqual({ venue: "Brand New Place", city: "Southampton" });
    expect("venue_id" in payload).toBe(false);
  });

  it("regression: switching an already-linked gig to a new/free-text venue never leaves the stale UUID, and never sends an explicit null either", () => {
    // The exact scenario from the Phase 2C spec: admin had "Platform
    // Tavern" (v-platform) selected, then explicitly chooses to use
    // free-text "Totally Different Venue" as a new venue instead.
    const afterSwitch = venueFieldsFromPickerState(newVenueChosen("Totally Different Venue"), { fallbackCity: "Southampton" });
    const payload = buildVenueUpdatePayload(afterSwitch);
    expect(payload.venue_id).toBeUndefined();
    expect("venue_id" in payload).toBe(false); // not merely undefined-but-present -- genuinely absent, see the module's own header comment on why this matters for the trigger
    expect(payload.venue).toBe("Totally Different Venue");
  });
});
