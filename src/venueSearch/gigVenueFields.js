// Venue Identity & Matching, Phase 2C: pure helpers translating a
// VenuePicker's state into the venue-related fields (venue_id, venue,
// city) a gig submission/update payload needs. Kept here, not inline in
// App.jsx, specifically so SubmitGigForm's and Admin Edit's wiring can be
// tested without rendering either component -- this repo has no jsdom/
// @testing-library/react (see Phase 2A/2B's own report on that), so this
// is the same pure-core/thin-wiring split used throughout this codebase.
import { getSelectedVenue, getNewVenueChoice } from "./pickerState.js";
import { normaliseCity } from "../smartImport/textNormalize.js";

// Called on every VenuePicker onChange (and once more, defensively, right
// before submission -- see this Phase's report, section on stale-selection
// safety). `fallbackCity` is whatever the surrounding form's OWN city
// field currently holds -- used only for the "new venue" and "still
// typing, no decision yet" cases; an existing selection's canonical city
// always wins over it, never the reverse (Phase 2C spec, section 3).
export function venueFieldsFromPickerState(pickerState, { fallbackCity = "" } = {}) {
  const selected = getSelectedVenue(pickerState);
  if (selected) {
    return { venue_id: selected.venue_id, venue: selected.name, city: selected.city };
  }
  const newChoice = getNewVenueChoice(pickerState);
  if (newChoice) {
    return { venue_id: null, venue: newChoice.name, city: fallbackCity };
  }
  // Typing, or results shown but nothing clicked yet: venue_id is never
  // carried forward without an explicit decision (mirrors the picker's
  // own stale-selection guard in pickerState.js, applied here too as an
  // independent, submit-time-checkable safety net rather than trusting
  // incremental sync alone).
  return { venue_id: null, venue: pickerState.text, city: fallbackCity };
}

// True when the form's city field has been hand-edited to something that
// no longer matches an already-selected existing venue's own canonical
// city. Phase 2C section 16's "smallest safe behaviour": rather than
// locking the city field while a venue is selected (a bigger UX change to
// an always-editable field), a material city change invalidates the
// selection instead -- the same principle pickerState.js's own
// clearsSelection() already applies to the venue TEXT field, extended
// here to the CITY field. "Material" uses the same strict city comparison
// the rest of the venue-matching stack uses, so a trivial whitespace/case
// edit never spuriously invalidates a real selection.
export function cityConflictsWithSelection(pickerState, newCityText) {
  const selected = getSelectedVenue(pickerState);
  if (!selected) return false;
  return normaliseCity(newCityText) !== normaliseCity(selected.city);
}

// Builds the venue-related subset of an UPDATE payload for DB.updateGig.
// Deliberately NEVER includes an explicit `venue_id: null` -- verified
// empirically against the live gig_auto_venue trigger (PR #29, re-checked
// against production in a rolled-back transaction for this PR): its
// second guard --
//   if TG_OP = 'UPDATE' and new.venue_id is distinct from old.venue_id
//   then return new; end if;
// -- trusts ANY distinct venue_id change, INCLUDING an old real id
// changing to null, and returns immediately WITHOUT ever reaching the
// auto-match/create logic below it. Sending an explicit `venue_id: null`
// on an UPDATE therefore does not "let the trigger resolve/create it" --
// it permanently orphans the gig (no venue link, no new venue created),
// confirmed empirically: a gig switched from a linked venue to new
// free-text via an explicit `venue_id = null` UPDATE ended up with
// venue_id null and zero new venue rows created. Omitting the key
// entirely instead leaves NEW.venue_id equal to OLD.venue_id for that
// statement (ordinary Postgres UPDATE semantics for an unmentioned
// column), which is NOT distinct from itself -- guard 2 does not fire --
// so the statement falls through to guard 3 (preserves venue_id when the
// venue TEXT is also unchanged) or, when the text has genuinely changed,
// all the way through to the trigger's normal matching/creation logic,
// which then correctly overwrites venue_id with whatever it resolves or
// creates. Confirmed empirically too: omitting the key in the same
// scenario correctly relinked the gig to a freshly created venue.
// This is why buildGigInsertPayload's venue_id key must only ever be
// present when non-null -- see this PR's report for the two rolled-back
// SQL scenarios this was verified against.
export function buildVenueUpdatePayload(fields) {
  const { venue_id, venue, city } = fields;
  return venue_id ? { venue_id, venue, city } : { venue, city };
}
