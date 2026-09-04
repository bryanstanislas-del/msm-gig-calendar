// Venue Identity & Matching, Phase 2B: the Venue Picker's state machine,
// deliberately factored out of the React component (VenuePicker.jsx) into
// a plain, synchronous reducer -- exactly the dependency-injection/pure-
// core pattern the rest of this codebase's Smart Import modules already
// use (runMatching.js, importEngine.js, etc), and the only way to get real
// test coverage on this logic without adding a DOM-testing dependency this
// repo doesn't currently have (no jsdom, no @testing-library/react -- see
// this PR's own report on why component-level rendering isn't tested).
//
// STALE-SELECTION SAFETY (the actual reason this file exists as a reducer
// rather than a handful of useState calls): once a user has clicked an
// existing venue, the component must never let a later, unrelated edit to
// the text field submit that venue's id against different text. TEXT_CHANGED
// is the only action that can clear a selection, and it only does so when
// the new text stops matching the selected venue's own canonical name --
// see clearsSelection() below for the exact (deliberately narrow) rule.

import { normaliseName } from "../smartImport/textNormalize.js";

export const PICKER_STATUS = {
  IDLE: "idle", // no text typed yet
  TYPING: "typing", // text present, search pending/in flight, nothing selected
  RESULTS: "results", // search completed, results (possibly empty) shown, nothing selected
  SELECTED: "selected", // an existing venue has been chosen
  NEW: "new", // the explicit "use as new venue" action was chosen
};

export function createInitialPickerState() {
  return {
    text: "",
    status: PICKER_STATUS.IDLE,
    results: [],
    selection: null, // { mode: "existing", venue_id, name, city, address, postcode } | { mode: "new", name } | null
    queryToken: 0, // bumped on every TEXT_CHANGED; lets the component discard a stale async search response
  };
}

// A later edit is only tolerated as "merely a controlled display
// operation" (per this PR's spec) when it doesn't change the venue's
// identity as far as the database is concerned -- i.e. the same strict
// (whitespace/case) normalisation the DB itself uses, NOT the looser alias
// normalisation. Anything beyond that (adding a word, picking a
// completely different venue's worth of text, clearing the field) clears
// the selection. This is intentionally stricter than ALIAS-tier matching:
// a selection is a specific, already-confirmed identity, not a fresh
// search query. Applies identically to an "existing" selection (where
// staleness would otherwise submit a real venue_id against different
// text -- the actual safety requirement) and to a "new" choice (where the
// risk is smaller -- no id to misattribute -- but the displayed/submitted
// name must still never silently drift from what's on screen).
function clearsSelection(selection, newText) {
  if (!selection) return false;
  return normaliseName(newText) !== normaliseName(selection.name);
}

export function pickerReducer(state, action) {
  switch (action.type) {
    case "TEXT_CHANGED": {
      const text = action.text ?? "";
      const stillValid = state.selection && !clearsSelection(state.selection, text);
      return {
        ...state,
        text,
        queryToken: state.queryToken + 1,
        selection: stillValid ? state.selection : null,
        status: stillValid ? state.status : text.trim() ? PICKER_STATUS.TYPING : PICKER_STATUS.IDLE,
        results: stillValid ? state.results : [],
      };
    }

    // Fired when the debounced search is actually issued, carrying the
    // queryToken captured at that moment -- lets RESULTS_RECEIVED tell a
    // response for an old keystroke apart from the latest one.
    case "SEARCH_STARTED": {
      if (action.token !== state.queryToken) return state; // superseded before it even started
      return { ...state, status: PICKER_STATUS.TYPING };
    }

    case "RESULTS_RECEIVED": {
      if (action.token !== state.queryToken) return state; // stale response for an old keystroke, ignore
      if (state.selection) return state; // a selection was made while this search was in flight
      return { ...state, results: action.results || [], status: PICKER_STATUS.RESULTS };
    }

    case "VENUE_SELECTED": {
      const { id, name, city, address, postcode } = action.venue;
      return {
        ...state,
        text: name,
        results: [],
        status: PICKER_STATUS.SELECTED,
        selection: { mode: "existing", venue_id: id, name, city, address: address ?? null, postcode: postcode ?? null },
      };
    }

    case "NEW_VENUE_CHOSEN": {
      const name = (action.name ?? state.text).trim();
      return {
        ...state,
        text: name,
        results: [],
        status: PICKER_STATUS.NEW,
        selection: { mode: "new", name },
      };
    }

    case "RESET":
      return createInitialPickerState();

    default:
      return state;
  }
}

// Convenience read-side helpers so callers/tests don't need to know the
// state shape's internal details.
export function getSelectedVenue(state) {
  return state.selection && state.selection.mode === "existing" ? state.selection : null;
}

export function getNewVenueChoice(state) {
  return state.selection && state.selection.mode === "new" ? state.selection : null;
}
