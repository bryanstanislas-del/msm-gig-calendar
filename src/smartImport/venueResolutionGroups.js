// Sprint 5D: groups rows sharing the same source venue text into one
// decision instead of many. Two group kinds, built from the SAME rows
// runMatching() already produced -- this module never re-derives a venue
// query itself, it reuses venueMatch.query (already resolved from
// fields.venueName || fields.venueBlock, with status wording stripped, by
// deriveVenueQuery() in venueMatching.js) so grouping can never disagree
// with how a row's own tier was decided.
//
// Grouping runs once, off the raw runMatching() batch (never off a
// post-decision resolvedBatch) -- a row can't "fall out of" its group
// because a decision changed its tier, which would be circular, and the
// groups useMemo in the UI only needs to depend on `batch`, not on any
// decision/override state.
import { normaliseName } from "./textNormalize.js";
import { buildGroupId, sortGroups, GROUP_SAMPLE_SIZE } from "./resolutionGroupUtils.js";

export const VENUE_MISSING_ACTIONS = {
  LINK_EXISTING: "link_existing",
  APPROVE_NEW: "approve_new",
  LEAVE_UNRESOLVED: "leave_unresolved",
  EXCLUDE_AFFECTED: "exclude_affected",
};

export const VENUE_FUZZY_ACTIONS = {
  ACCEPT_SUGGESTED: "accept_suggested",
  CHOOSE_DIFFERENT: "choose_different",
  REJECT_MATCH: "reject_match",
  LEAVE_UNRESOLVED: "leave_unresolved",
};

function buildVenueGroups(rows, { kindPrefix, kind, includeCandidates }) {
  const byKey = new Map();
  for (const row of rows) {
    const { query, city } = row.venueMatch;
    const key = normaliseName(query);
    if (!key) continue; // nothing to group an empty query on
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        id: buildGroupId(kindPrefix, key),
        kind,
        sourceText: query,
        sourceCity: city,
        // The full raw "<venue name>, <address>" text where the source
        // profile captured one (msm-gig-guide always does; deriveVenueQuery
        // discards everything after the first comma when building `query`,
        // so this is the only place the street address survives for display).
        sourceAddressBlock: row.fields.venueBlock || null,
        rowIds: [],
        suggestedCandidates: includeCandidates ? row.venueMatch.candidates : [],
        hasCandidateDisagreement: false,
      };
      entry._topCandidateId = includeCandidates ? row.venueMatch.candidates[0]?.id ?? null : null;
      byKey.set(key, entry);
    }
    entry.rowIds.push(row.id);
    if (includeCandidates) {
      const topId = row.venueMatch.candidates[0]?.id ?? null;
      if (topId !== entry._topCandidateId) entry.hasCandidateDisagreement = true;
    }
  }
  const groups = [...byKey.values()].map(({ _topCandidateId, ...group }) => ({
    ...group,
    sampleRowIds: group.rowIds.slice(0, GROUP_SAMPLE_SIZE),
  }));
  return sortGroups(groups);
}

export function groupMissingVenues(rows) {
  return buildVenueGroups(
    rows.filter((r) => r.venueMatch.tier === "none"),
    { kindPrefix: "venue_missing", kind: "venue_missing", includeCandidates: false }
  );
}

export function groupFuzzyVenues(rows) {
  return buildVenueGroups(
    rows.filter((r) => r.venueMatch.tier === "fuzzy"),
    { kindPrefix: "venue_fuzzy", kind: "venue_fuzzy", includeCandidates: true }
  );
}
