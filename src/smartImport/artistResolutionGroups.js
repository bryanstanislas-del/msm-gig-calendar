// Sprint 5D: groups rows sharing the same source billing/artist text into
// one decision instead of many. Mirrors venueResolutionGroups.js's shape
// exactly -- see that file's header comment for why grouping reuses the
// row's own already-resolved match.query rather than re-deriving anything,
// and why grouping runs once, off the raw runMatching() batch.
//
// No auto-create action exists here at all (unlike venue's "Approve New" --
// there is no artist equivalent): Sprint 5C's confirmed product decision is
// that Missing Artist rows import as free text only, never a newly created
// profile. ARTIST_MISSING_ACTIONS reflects that -- LEAVE_AS_FREE_TEXT is the
// default action, and there is no "approve new artist" action to mirror
// venue's APPROVE_NEW.
import { normaliseName } from "./textNormalize.js";
import { buildGroupId, sortGroups, GROUP_SAMPLE_SIZE } from "./resolutionGroupUtils.js";

export const ARTIST_MISSING_ACTIONS = {
  LEAVE_AS_FREE_TEXT: "leave_as_free_text",
  LINK_EXISTING: "link_existing",
  LEAVE_UNRESOLVED: "leave_unresolved",
  EXCLUDE_AFFECTED: "exclude_affected",
};

export const ARTIST_FUZZY_ACTIONS = {
  ACCEPT_SUGGESTED: "accept_suggested",
  CHOOSE_DIFFERENT: "choose_different",
  REJECT_MATCH: "reject_match",
  LEAVE_AS_FREE_TEXT: "leave_as_free_text",
};

function buildArtistGroups(rows, { kindPrefix, kind, includeCandidates }) {
  const byKey = new Map();
  for (const row of rows) {
    const { query } = row.artistMatch;
    const key = normaliseName(query);
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        id: buildGroupId(kindPrefix, key),
        kind,
        sourceText: query,
        rowIds: [],
        suggestedCandidates: includeCandidates ? row.artistMatch.candidates : [],
        hasCandidateDisagreement: false,
      };
      entry._topCandidateId = includeCandidates ? row.artistMatch.candidates[0]?.id ?? null : null;
      byKey.set(key, entry);
    }
    entry.rowIds.push(row.id);
    if (includeCandidates) {
      const topId = row.artistMatch.candidates[0]?.id ?? null;
      if (topId !== entry._topCandidateId) entry.hasCandidateDisagreement = true;
    }
  }
  const groups = [...byKey.values()].map(({ _topCandidateId, ...group }) => ({
    ...group,
    sampleRowIds: group.rowIds.slice(0, GROUP_SAMPLE_SIZE),
  }));
  return sortGroups(groups);
}

// "not_applicable" tier rows (artist extraction skipped entirely for the
// row's source profile) are excluded by the tier filter itself -- there is
// nothing to group them by, and grouping them would misrepresent them as
// "missing" when they were never attempted.
export function groupMissingArtists(rows) {
  return buildArtistGroups(
    rows.filter((r) => r.artistMatch.tier === "none"),
    { kindPrefix: "artist_missing", kind: "artist_missing", includeCandidates: false }
  );
}

export function groupFuzzyArtists(rows) {
  return buildArtistGroups(
    rows.filter((r) => r.artistMatch.tier === "fuzzy"),
    { kindPrefix: "artist_fuzzy", kind: "artist_fuzzy", includeCandidates: true }
  );
}
