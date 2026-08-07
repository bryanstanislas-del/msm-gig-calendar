// Sprint 5D: small shared helpers used by every *ResolutionGroups.js module
// (venue/artist/duplicate) -- purely mechanical (sorting, id building, a
// row-id -> group-id index), unlike venueMatching.js/artistMatching.js's
// per-entity matching nuance, so it lives in one shared file rather than
// being duplicated three times.

// How many member rows a group shows as "sample affected gigs" in the UI --
// enough to give an admin real confidence without dumping the whole list.
export const GROUP_SAMPLE_SIZE = 5;

// Every group id is `${kindPrefix}:${normalisedKey}` -- a pure function of
// group membership content, never a counter or Date.now(). This matters
// structurally, not just cosmetically: groupDecisions state is keyed by
// groupId, and groups are recomputed via useMemo on every render. If ids
// weren't stable across re-renders for the same underlying batch, a
// decision would silently detach from its group the next time groups were
// recomputed.
export function buildGroupId(kindPrefix, normalisedKey) {
  return `${kindPrefix}:${normalisedKey}`;
}

// Groups sort by affected-row-count descending (the whole point of grouping
// is to put the highest-leverage decisions first), then by id ascending as
// a stable, deterministic tiebreak -- same "count desc" convention
// batchSelection.js's groupSkippedReasons already uses.
export function sortGroups(groups) {
  return [...groups].sort((a, b) => b.rowIds.length - a.rowIds.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Row id -> group id, for every group in the list. A single row can only
// ever belong to one group per *kind* (a row has exactly one venueMatch, one
// artistMatch, one duplicate classification), so groups of the same kind
// never contend for a row -- but the caller typically holds three separate
// indexes (venue/artist/duplicate), one per call to this function.
export function indexRowsByGroup(groups) {
  const index = new Map();
  for (const group of groups) {
    for (const rowId of group.rowIds) index.set(rowId, group.id);
  }
  return index;
}
