// EntitySearchPicker's routing decision -- which search_entities entity
// type(s) to query for a given picker `entityType` prop. Pure and
// framework-free (no React, no supabase import) so this one small,
// easy-to-get-wrong decision is unit-testable without pulling a React
// testing harness into a repo that doesn't otherwise have one.
//
// A parsed billing line never says solo artist vs. full band in advance,
// so "artist" is the one case that searches and merges two underlying
// entity types (see App.jsx's EntitySearchPicker for the merge/sort).
// Every other entityType ("venue", "festival", ...) maps to itself 1:1,
// unmodified, against the same search_entities RPC -- there is no special
// casing here beyond the one genuine ambiguity artist search already had.
export function entitySearchTargets(entityType) {
  if (entityType === "artist") return ["band", "solo_artist"];
  return [entityType];
}
