// Venue Identity & Matching: a reusable Venue Picker.
//
// Phase 2B built and tested this in isolation, unwired. Phase 2C wires it
// into SubmitGigForm and Admin Edit Gig (App.jsx) and adds the small set
// of additions actually needed to go live: `initialSelection` (Admin Edit
// needs to represent an already-linked venue with no search -- see
// pickerState.js's createInitialPickerState), a handful of optional
// styling props so the host can match its own existing input styling
// without this file importing anything from App.jsx (kept fully decoupled
// -- see below), and minimal Escape/click-outside dismissal now that real
// users will actually see this dropdown.
//
// All the logic that actually needs correctness guarantees --
// debounce/stale-response handling, ranking, and stale-selection
// protection -- lives in pickerState.js/ranking.js/gigVenueFields.js as
// plain, synchronous, fully unit-tested functions. This file is
// deliberately thin: it owns only the DOM/timer/effect wiring React
// itself requires, which is why it has no test file of its own beyond its
// one pure export (formatResultMeta) -- see this repo's Phase 2A/2B
// report for why: no jsdom/@testing-library/react dependency exists here,
// and adding one solely for this component remains out of scope.
//
// `searchFn` is REQUIRED, not defaulted to a real Supabase call -- mirrors
// every Smart Import module's own dependency-injection convention
// (venueMatching.js, runMatching.js: "never calls Supabase itself"). This
// keeps venueSearch/ fully decoupled from App.jsx's huge module graph --
// deliberately, not just by convention: App.jsx imports VenuePicker, so
// the reverse (VenuePicker importing anything from App.jsx, even a plain
// style-object constant like the exported `C`/`F`/`inputCss`) would be a
// circular import. Style props are how App.jsx hands its own look down
// instead, one-directionally, in the same spirit as `searchFn`.
import { useEffect, useReducer, useRef, useState } from "react";
import { pickerReducer, createInitialPickerState, PICKER_STATUS, getSelectedVenue, getNewVenueChoice } from "./pickerState.js";
import { rankVenueCandidates } from "./ranking.js";

const MIN_QUERY_LENGTH = 2; // matches search_entities' own floor -- see venueSearch/ranking.js
const DEBOUNCE_MS = 250;

// onChange(pickerState) fires on every state transition, so a host form can
// read getSelectedVenue()/getNewVenueChoice() itself rather than this
// component inventing a second, parallel callback shape. `context` (city,
// postcode) is optional and purely improves ranking -- see ranking.js's
// rankVenueCandidates; it never filters out a different-city candidate.
//
// `initialSelection` ({ venue_id?, name?, city?, address?, postcode? } or
// null) seeds the picker once, at mount -- see createInitialPickerState's
// own doc comment for its three cases. Only read on the FIRST render
// (React's useReducer lazy-init contract); the host must change this
// component's `key` prop to re-seed it later (e.g. Admin Edit opening a
// different gig, or a city conflict invalidating the current selection --
// see App.jsx's own handling of both).
//
// label/required/error/inputStyle/labelStyle are all optional and purely
// cosmetic -- omitting all of them renders a plain, unstyled input exactly
// as Phase 2B did.
export default function VenuePicker({
  searchFn,
  context,
  onChange,
  placeholder = "Venue name",
  initialSelection = null,
  label,
  required,
  error,
  inputStyle,
  labelStyle,
}) {
  const [state, dispatch] = useReducer(pickerReducer, initialSelection, createInitialPickerState);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);
  // Purely a visual affordance -- whether the results dropdown is
  // currently dismissed (Escape, or a click outside the component).
  // Deliberately NOT part of pickerState: dismissing the dropdown must
  // never touch the underlying text/selection/search state, only hide the
  // list. Reset whenever a new search cycle starts so a fresh set of
  // results is never born already-dismissed.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    onChange?.(state);
  }, [state, onChange]);

  useEffect(() => {
    setDismissed(false);
  }, [state.queryToken]);

  useEffect(() => {
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setDismissed(true);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = state.text.trim();
    if (state.status !== PICKER_STATUS.TYPING || query.length < MIN_QUERY_LENGTH) return undefined;

    const token = state.queryToken;
    debounceRef.current = setTimeout(async () => {
      dispatch({ type: "SEARCH_STARTED", token });
      try {
        const candidates = await searchFn(query, context);
        const ranked = rankVenueCandidates(query, candidates, context);
        dispatch({ type: "RESULTS_RECEIVED", token, results: ranked });
      } catch {
        // A failed search leaves the picker in TYPING with no results --
        // never a stale/previous result set silently re-shown as current.
        dispatch({ type: "RESULTS_RECEIVED", token, results: [] });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context/searchFn identity changes intentionally do not re-trigger a fresh debounce cycle by themselves; only a new keystroke (queryToken) does.
  }, [state.queryToken]);

  const selected = getSelectedVenue(state);
  const newChoice = getNewVenueChoice(state);
  const resultsOpen = state.status === PICKER_STATUS.RESULTS && !dismissed;
  const showNewVenueAction = resultsOpen && state.text.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="venue-picker" ref={containerRef}>
      {label && (
        <label style={labelStyle}>
          {label}
          {required && " *"}
        </label>
      )}
      <input
        type="text"
        value={state.text}
        placeholder={placeholder}
        onChange={(e) => dispatch({ type: "TEXT_CHANGED", text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") setDismissed(true);
        }}
        style={inputStyle}
        aria-label={label || "Venue"}
        aria-invalid={!!error}
      />

      {selected && (
        <div className="venue-picker-selected" role="status">
          ✓ Existing venue selected: <strong>{selected.name}</strong>
          {selected.city ? `, ${selected.city}` : ""}
        </div>
      )}

      {newChoice && (
        <div className="venue-picker-new" role="status">
          New venue: <strong>{newChoice.name}</strong> (not yet created)
        </div>
      )}

      {resultsOpen && (
        <ul className="venue-picker-results">
          {state.results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => dispatch({ type: "VENUE_SELECTED", venue: r })}>
                <div className="venue-picker-result-name">{r.name}</div>
                <div className="venue-picker-result-meta">{formatResultMeta(r)}</div>
              </button>
            </li>
          ))}
          {state.results.length === 0 && <li className="venue-picker-no-results">No matching venues found.</li>}
          {showNewVenueAction && (
            <li>
              <button type="button" onClick={() => dispatch({ type: "NEW_VENUE_CHOSEN", name: state.text })}>
                Can't find your venue? Use "{state.text.trim()}" as a new venue
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Builds the "Town Quay, Southampton · SO14 2NY" secondary line -- section
// 7's required presentation. Gracefully degrades when address/postcode are
// absent (search_entities does not return them today -- see this PR's
// report on that limitation): renders whatever subset is available, never
// a blank/placeholder line, and never repeats city if address already
// ends with it.
export function formatResultMeta(result) {
  const parts = [];
  if (result.address) {
    const addressAlreadyHasCity =
      result.city && result.address.toLowerCase().includes(result.city.toLowerCase());
    parts.push(addressAlreadyHasCity ? result.address : [result.address, result.city].filter(Boolean).join(", "));
  } else if (result.city) {
    parts.push(result.city);
  }
  const line = parts.join(", ");
  return result.postcode ? [line, result.postcode].filter(Boolean).join(" · ") : line;
}
