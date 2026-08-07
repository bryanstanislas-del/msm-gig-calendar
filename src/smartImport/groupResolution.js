// Sprint 5D: the composition engine -- turns a group decision (applying to
// every row in a venue/artist/duplicate group at once) and an individual
// row's own override into a resolved row, in a fixed precedence order:
//
//   parsed match (never mutated)
//     -> venue group decision (if the row belongs to a venue group with one)
//     -> artist group decision (if any)
//     -> duplicate group decision (if any)
//     -> row-level override (always applied last, always wins for THAT row
//        only -- never touches any other row's data)
//
// This module deliberately does NOT call deriveRowState() itself -- the
// caller (ImportReviewDashboard's resolvedBatch, same as today) calls it
// afterward on the composed result, exactly like it already does with
// withOverridesApplied()'s output. reviewBatch.js needs zero changes for
// Sprint 5D: deriveRowState() only special-cases venueMatch.tier==="fuzzy"/
// "none" and artistMatch.tier==="fuzzy"/"none" -- the two new tiers this
// module introduces (venue "approved_new", artist "confirmed_free_text")
// fall through as already-resolved, exactly like the existing "confirmed"
// tier batchSelection.js's applyMatchOverride already produces.
//
// Safety (structural, not just documented): a group or row-level duplicate
// decision can NEVER move a row off an exact-tier duplicate lock --
// applyDuplicateGroupDecision/applyDuplicateRowOverride both hard-check
// LOCKED_DUPLICATE_TIERS before doing anything, regardless of what the
// decision/override says. Confirmed with the user: there is no escape
// hatch for this at all, at either the group or row level -- if an exact
// key match is a false positive, the fix is editing the source text and
// re-parsing, not overriding the lock here.
import { withOverridesApplied } from "./batchSelection.js";
import { VENUE_MISSING_ACTIONS, VENUE_FUZZY_ACTIONS } from "./venueResolutionGroups.js";
import { ARTIST_MISSING_ACTIONS, ARTIST_FUZZY_ACTIONS } from "./artistResolutionGroups.js";
import { DUPLICATE_CLUSTER_ACTIONS, LOCKED_DUPLICATE_TIERS } from "./duplicateResolutionGroups.js";

function applyVenueGroupDecision(venueMatch, decision) {
  if (!decision) return venueMatch;
  switch (decision.action) {
    case VENUE_MISSING_ACTIONS.LINK_EXISTING:
    case VENUE_FUZZY_ACTIONS.ACCEPT_SUGGESTED:
    case VENUE_FUZZY_ACTIONS.CHOOSE_DIFFERENT:
      // Defensive: an incomplete decision (no resolvedVenue) is a no-op
      // rather than silently corrupting the row with a null match.
      if (!decision.resolvedVenue) return venueMatch;
      return { ...venueMatch, tier: "confirmed", match: decision.resolvedVenue, candidates: [] };
    case VENUE_MISSING_ACTIONS.APPROVE_NEW:
      // Hard gate: importEngine.js's validateRowForImport already blocks a
      // "New Venue" row with no known city -- never approve one without a
      // city here either, or the dashboard would show a row as resolved
      // that the RPC layer would then silently reject.
      if (!decision.approvedNewVenueCity) return venueMatch;
      return { ...venueMatch, tier: "approved_new", city: decision.approvedNewVenueCity, match: null, candidates: [] };
    case VENUE_FUZZY_ACTIONS.REJECT_MATCH:
      return { ...venueMatch, tier: "none", match: null, candidates: [] };
    default:
      // LEAVE_UNRESOLVED, EXCLUDE_AFFECTED -- neither affects match data.
      // EXCLUDE_AFFECTED's actual effect (adding every group member's row
      // id to explicitlyExcluded) is applied directly by the UI layer using
      // the group's own rowIds, which it already has in hand -- it isn't a
      // match-resolution concern this module owns.
      return venueMatch;
  }
}

function applyVenueRowOverride(venueMatch, override) {
  if (!override) return venueMatch;
  if (override.overrideVenue) return { ...venueMatch, tier: "confirmed", match: override.overrideVenue, candidates: [] };
  if (override.approveNewVenueCity) {
    return { ...venueMatch, tier: "approved_new", city: override.approveNewVenueCity, match: null, candidates: [] };
  }
  if (override.rejectVenueMatch) return { ...venueMatch, tier: "none", match: null, candidates: [] };
  return venueMatch;
}

function applyArtistGroupDecision(artistMatch, decision) {
  if (!decision) return artistMatch;
  switch (decision.action) {
    case ARTIST_MISSING_ACTIONS.LEAVE_AS_FREE_TEXT:
      return { ...artistMatch, tier: "confirmed_free_text", match: null, candidates: [] };
    case ARTIST_MISSING_ACTIONS.LINK_EXISTING:
    case ARTIST_FUZZY_ACTIONS.ACCEPT_SUGGESTED:
    case ARTIST_FUZZY_ACTIONS.CHOOSE_DIFFERENT:
      if (!decision.resolvedArtist) return artistMatch;
      return { ...artistMatch, tier: "confirmed", match: decision.resolvedArtist, candidates: [] };
    case ARTIST_FUZZY_ACTIONS.REJECT_MATCH:
      return { ...artistMatch, tier: "none", match: null, candidates: [] };
    default:
      // LEAVE_UNRESOLVED, EXCLUDE_AFFECTED -- see the venue equivalent above.
      return artistMatch;
  }
}

function applyArtistRowOverride(artistMatch, override) {
  if (!override) return artistMatch;
  if (override.overrideArtist) return { ...artistMatch, tier: "confirmed", match: override.overrideArtist, candidates: [] };
  if (override.confirmArtistFreeText) return { ...artistMatch, tier: "confirmed_free_text", match: null, candidates: [] };
  if (override.rejectArtistMatch) return { ...artistMatch, tier: "none", match: null, candidates: [] };
  return artistMatch;
}

function applyDuplicateGroupDecision(duplicate, decision) {
  if (!decision) return duplicate;
  // Structural safety boundary, not a UI convenience: even if a decision
  // somehow carried IMPORT_ANYWAY for a locked tier (the UI never offers
  // the button, but this function doesn't trust that), nothing happens.
  if (LOCKED_DUPLICATE_TIERS.includes(duplicate.tier)) return duplicate;
  if (decision.action === DUPLICATE_CLUSTER_ACTIONS.IMPORT_ANYWAY) {
    return { ...duplicate, tier: "none" };
  }
  // SKIP_EXISTING / LEAVE_FOR_MANUAL_REVIEW -- no data change; the decision
  // still gets recorded by the caller for the UI's "Decided: X" display and
  // undo affordance, it just doesn't alter what gets imported.
  return duplicate;
}

function applyDuplicateRowOverride(duplicate, override) {
  if (!override?.duplicateDecision) return duplicate;
  if (LOCKED_DUPLICATE_TIERS.includes(duplicate.tier)) return duplicate;
  if (override.duplicateDecision === "import_anyway") return { ...duplicate, tier: "none" };
  return duplicate;
}

// Applies exactly one group decision to a row, dispatching on the
// decision's own `kind` -- returns a new row with only the corresponding
// field (venueMatch/artistMatch/duplicate) touched. A null/undefined
// decision is always a no-op, so callers can pass "no decision for this
// row's group" without a conditional at every call site.
export function applyGroupDecisionToRow(row, decision) {
  if (!decision) return row;
  switch (decision.kind) {
    case "venue_missing":
    case "venue_fuzzy":
      return { ...row, venueMatch: applyVenueGroupDecision(row.venueMatch, decision) };
    case "artist_missing":
    case "artist_fuzzy":
      return { ...row, artistMatch: applyArtistGroupDecision(row.artistMatch, decision) };
    case "duplicate_cluster":
      return { ...row, duplicate: applyDuplicateGroupDecision(row.duplicate, decision) };
    default:
      return row;
  }
}

// The full precedence pipeline for one row. `venueGroupDecision`/
// `artistGroupDecision`/`duplicateGroupDecision` are whichever
// GroupResolutionDecision (if any) applies to the group this row belongs to
// for that kind -- the caller looks these up via
// resolutionGroupUtils.indexRowsByGroup() + a groupId -> decision map.
// `override` is the row's own entry from the (extended) overrides object.
export function composeResolvedRow(row, { venueGroupDecision, artistGroupDecision, duplicateGroupDecision, override } = {}) {
  let resolved = applyGroupDecisionToRow(row, venueGroupDecision);
  resolved = applyGroupDecisionToRow(resolved, artistGroupDecision);
  resolved = applyGroupDecisionToRow(resolved, duplicateGroupDecision);

  // Row-level override always applied last: reuses the EXISTING
  // withOverridesApplied/applyMatchOverride from batchSelection.js
  // unchanged for venueCandidateId/artistCandidateId, then layers Sprint
  // 5D's new override fields on top of that result.
  resolved = withOverridesApplied(resolved, override);
  resolved = {
    ...resolved,
    venueMatch: applyVenueRowOverride(resolved.venueMatch, override),
    artistMatch: applyArtistRowOverride(resolved.artistMatch, override),
    duplicate: applyDuplicateRowOverride(resolved.duplicate, override),
  };

  return resolved;
}
