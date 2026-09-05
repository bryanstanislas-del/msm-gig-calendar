// Venue Identity & Matching, Phase 2B: a reusable Venue Picker.
//
// NOT WIRED INTO ANY LIVE FORM YET -- Public Submit Gig, Admin Add Gig
// (the same component) and Admin Edit Gig all still use their existing
// plain free-text <Input>. Phase 2C is the PR that replaces those inputs
// with this component; this PR only builds and tests it in isolation, per
// the explicit scope for this task.
//
// All the logic that actually needs correctness guarantees --
// debounce/stale-response handling, ranking, and stale-selection
// protection -- lives in pickerState.js/ranking.js as plain, synchronous,
// fully unit-tested functions. This file is deliberately thin: it owns
// only the DOM/timer/effect wiring React itself requires, which is why it
// has no test file of its own -- see this PR's report (section on
// component tests) for why: this repo has no jsdom/@testing-library/react
// dependency today, and adding one solely for this one component would be
// exactly the kind of scope creep this task explicitly warns against. The
// reducer this component drives is the thing worth testing, and it already
// is, thoroughly, in pickerState.test.js.
//
// `searchFn` is REQUIRED, not defaulted to a real Supabase call -- mirrors
// every Smart Import module's own dependency-injection convention
// (venueMatching.js, runMatching.js: "never calls Supabase itself"). This
// keeps venueSearch/ fully decoupled from App.jsx's huge module graph.
// The eventual Phase 2C wiring passes
// `searchFn={(query, ctx) => DB.searchEntities("venue", query)}` from
// App.jsx -- ctx (city/postcode) is accepted here for forward
// compatibility but not required by DB.searchEntities's current signature.
import { useEffect, useReducer, useRef } from "react";
import { pickerReducer, createInitialPickerState, PICKER_STATUS, getSelectedVenue, getNewVenueChoice } from "./pickerState.js";
import { rankVenueCandidates } from "./ranking.js";

const MIN_QUERY_LENGTH = 2; // matches search_entities' own floor -- see venueSearch/ranking.js
const DEBOUNCE_MS = 250;

// onChange(pickerState) fires on every state transition, so a host form can
// read getSelectedVenue()/getNewVenueChoice() itself rather than this
// component inventing a second, parallel callback shape. `context` (city,
// postcode) is optional and purely improves ranking -- see ranking.js's
// rankVenueCandidates; it never filters out a different-city candidate.
export default function VenuePicker({ searchFn, context, onChange, placeholder = "Venue name" }) {
  const [state, dispatch] = useReducer(pickerReducer, undefined, createInitialPickerState);
  const debounceRef = useRef(null);

  useEffect(() => {
    onChange?.(state);
  }, [state, onChange]);

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
  const showNewVenueAction = state.status === PICKER_STATUS.RESULTS && state.text.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="venue-picker">
      <input
        type="text"
        value={state.text}
        placeholder={placeholder}
        onChange={(e) => dispatch({ type: "TEXT_CHANGED", text: e.target.value })}
        aria-label="Venue"
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

      {state.status === PICKER_STATUS.RESULTS && (
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
