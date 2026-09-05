import { describe, it, expect } from "vitest";
import {
  createInitialPickerState,
  pickerReducer,
  getSelectedVenue,
  getNewVenueChoice,
  PICKER_STATUS,
} from "./pickerState.js";

const platformTavern = {
  id: "v-platform",
  name: "Platform Tavern",
  city: "Southampton",
  address: "Town Quay",
  postcode: "SO14 2NY",
};

describe("createInitialPickerState -- seeding (Phase 2C, Admin Edit)", () => {
  it("with no argument, behaves exactly as before (empty/idle)", () => {
    expect(createInitialPickerState()).toEqual({
      text: "",
      status: PICKER_STATUS.IDLE,
      results: [],
      selection: null,
      queryToken: 0,
    });
  });

  it("seeds a full existing-venue selection when venue_id is supplied -- no search required", () => {
    const state = createInitialPickerState({ venue_id: "v-platform", name: "Platform Tavern", city: "Southampton" });
    expect(state.status).toBe(PICKER_STATUS.SELECTED);
    expect(getSelectedVenue(state)).toEqual({
      mode: "existing",
      venue_id: "v-platform",
      name: "Platform Tavern",
      city: "Southampton",
      address: null,
      postcode: null,
    });
    expect(state.text).toBe("Platform Tavern");
  });

  it("seeds plain text (no selection) when a name is supplied without a venue_id -- free-text gig with no real link", () => {
    const state = createInitialPickerState({ venue_id: null, name: "Some Old Free-Text Venue", city: "Southampton" });
    expect(state.text).toBe("Some Old Free-Text Venue");
    expect(getSelectedVenue(state)).toBeNull();
    expect(state.status).toBe(PICKER_STATUS.IDLE);
  });

  it("seeds truly empty state when neither venue_id nor name is supplied", () => {
    expect(createInitialPickerState({})).toEqual(createInitialPickerState());
    expect(createInitialPickerState(null)).toEqual(createInitialPickerState());
  });
});

describe("pickerReducer -- typing and search lifecycle", () => {
  it("starts idle", () => {
    const state = createInitialPickerState();
    expect(state.status).toBe(PICKER_STATUS.IDLE);
    expect(state.selection).toBeNull();
  });

  it("moves to TYPING as soon as non-empty text is entered", () => {
    const state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    expect(state.status).toBe(PICKER_STATUS.TYPING);
    expect(state.text).toBe("Plat");
  });

  it("returns to IDLE when the text is cleared back to empty", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "" });
    expect(state.status).toBe(PICKER_STATUS.IDLE);
  });

  it("RESULTS_RECEIVED for the current query token updates results", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    const token = state.queryToken;
    state = pickerReducer(state, { type: "RESULTS_RECEIVED", token, results: [{ id: "v-platform" }] });
    expect(state.status).toBe(PICKER_STATUS.RESULTS);
    expect(state.results).toEqual([{ id: "v-platform" }]);
  });

  it("ignores a RESULTS_RECEIVED whose token is stale (superseded by a later keystroke)", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Pla" });
    const staleToken = state.queryToken;
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "Plat" }); // token bumps again
    state = pickerReducer(state, { type: "RESULTS_RECEIVED", token: staleToken, results: [{ id: "wrong-result" }] });
    expect(state.results).toEqual([]); // the stale response was discarded
  });

  it("ignores a RESULTS_RECEIVED that arrives after a selection was already made", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    const token = state.queryToken;
    state = pickerReducer(state, { type: "VENUE_SELECTED", venue: platformTavern });
    state = pickerReducer(state, { type: "RESULTS_RECEIVED", token, results: [{ id: "late-result" }] });
    expect(state.status).toBe(PICKER_STATUS.SELECTED); // unchanged
    expect(state.results).toEqual([]);
  });
});

describe("pickerReducer -- selecting an existing venue", () => {
  it("selecting a venue sets status SELECTED and returns it via getSelectedVenue", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    state = pickerReducer(state, { type: "VENUE_SELECTED", venue: platformTavern });
    expect(state.status).toBe(PICKER_STATUS.SELECTED);
    const selected = getSelectedVenue(state);
    expect(selected).toEqual({
      mode: "existing",
      venue_id: "v-platform",
      name: "Platform Tavern",
      city: "Southampton",
      address: "Town Quay",
      postcode: "SO14 2NY",
    });
  });

  it("selecting a venue sets the displayed text to its canonical name", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    state = pickerReducer(state, { type: "VENUE_SELECTED", venue: platformTavern });
    expect(state.text).toBe("Platform Tavern");
  });

  it("selecting a venue without address/postcode still produces a valid selection with null fields", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Talk" });
    state = pickerReducer(state, { type: "VENUE_SELECTED", venue: { id: "v-x", name: "Talking Heads", city: "Southampton" } });
    expect(getSelectedVenue(state)).toEqual({
      mode: "existing",
      venue_id: "v-x",
      name: "Talking Heads",
      city: "Southampton",
      address: null,
      postcode: null,
    });
  });
});

describe("pickerReducer -- stale-selection protection (section 9)", () => {
  function selectPlatformTavern() {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    return pickerReducer(state, { type: "VENUE_SELECTED", venue: platformTavern });
  }

  it("editing the text after selection to something else clears the selection", () => {
    let state = selectPlatformTavern();
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "Platform Tavern Extra Words" });
    expect(getSelectedVenue(state)).toBeNull();
    expect(state.selection).toBeNull();
  });

  it("clearing the text entirely after selection clears the selection", () => {
    let state = selectPlatformTavern();
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "" });
    expect(getSelectedVenue(state)).toBeNull();
    expect(state.status).toBe(PICKER_STATUS.IDLE);
  });

  it("re-typing a completely different venue name after selection clears venue_id -- never submits a stale id against different text", () => {
    let state = selectPlatformTavern();
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "The Joiners" });
    const selected = getSelectedVenue(state);
    expect(selected).toBeNull();
    expect(state.text).toBe("The Joiners");
  });

  it("a purely cosmetic re-render of the same canonical text (whitespace/case only) does NOT clear the selection", () => {
    let state = selectPlatformTavern();
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "platform  tavern" }); // same strict-normalised identity
    expect(getSelectedVenue(state)).not.toBeNull();
    expect(getSelectedVenue(state).venue_id).toBe("v-platform");
  });

  it("re-selecting the same venue after a no-op text change keeps it selected", () => {
    let state = selectPlatformTavern();
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "Platform Tavern" });
    expect(getSelectedVenue(state).venue_id).toBe("v-platform");
    expect(state.status).toBe(PICKER_STATUS.SELECTED);
  });
});

describe("pickerReducer -- explicit new-venue path", () => {
  it("choosing 'use as new venue' returns mode:new with no venue_id, distinct from an existing selection", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Brand New Place" });
    state = pickerReducer(state, { type: "NEW_VENUE_CHOSEN", name: "Brand New Place" });
    expect(state.status).toBe(PICKER_STATUS.NEW);
    expect(getSelectedVenue(state)).toBeNull(); // not an existing-venue selection
    const choice = getNewVenueChoice(state);
    expect(choice).toEqual({ mode: "new", name: "Brand New Place" });
    expect(choice.venue_id).toBeUndefined();
    expect("venue_id" in choice).toBe(false);
  });

  it("editing the text after choosing new-venue clears that choice too", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Brand New Place" });
    state = pickerReducer(state, { type: "NEW_VENUE_CHOSEN", name: "Brand New Place" });
    state = pickerReducer(state, { type: "TEXT_CHANGED", text: "Brand New Place, Updated" });
    expect(getNewVenueChoice(state)).toBeNull();
  });
});

describe("pickerReducer -- RESET", () => {
  it("returns to the initial state from anywhere", () => {
    let state = pickerReducer(createInitialPickerState(), { type: "TEXT_CHANGED", text: "Plat" });
    state = pickerReducer(state, { type: "VENUE_SELECTED", venue: platformTavern });
    state = pickerReducer(state, { type: "RESET" });
    expect(state).toEqual(createInitialPickerState());
  });
});
