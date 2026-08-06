// Sprint 5B: builds the "Import Batch" -- an in-memory (not database)
// structure produced by running venue matching, artist matching and
// duplicate detection over every row of a Sprint 5A ParseResult, in that
// priority order. No Supabase writes happen anywhere in this file or any
// module it calls; `searchFn` is the only network access, and it's
// injected so this stays testable with a fake implementation the same way
// the rest of Smart Import is (see runMatching.test.js). The batch itself
// is just the array this function returns, held in React state by the
// caller -- there is no new database table backing it.
import { classifyVenueMatch, deriveVenueQuery } from "./venueMatching.js";
import { classifyArtistMatch, deriveArtistQuery } from "./artistMatching.js";
import { detectDuplicates } from "./duplicateDetection.js";
import { deriveReviewStatus } from "./reviewBatch.js";

// searchFn(entityType, query) -> Promise<Array<{ id, name, city, similarity_score }>>,
// matching DB.searchEntities's own signature (App.jsx), which wraps the
// search_entities RPC. Optional: omitting it (e.g. in a test) simply means
// every row that isn't an exact match falls through to "none" instead of
// "fuzzy", since there are no candidates to offer.
export async function runMatching(parseResult, { venues = [], artistProfiles = [], existingGigs = [], searchFn } = {}) {
  const rows = parseResult.rows;
  const venueMatches = new Map();
  const artistMatches = new Map();

  for (const row of rows) {
    // A cheap local-only pass first: only worth a network round trip once
    // there's no exact match to be found in the venues/profiles snapshot
    // already in hand.
    const venueProvisional = classifyVenueMatch(row.fields, venues, []);
    let venueFuzzy = [];
    if (venueProvisional.tier === "none" && venueProvisional.query && searchFn) {
      venueFuzzy = await searchFn("venue", venueProvisional.query);
    }
    venueMatches.set(row.id, classifyVenueMatch(row.fields, venues, venueFuzzy));

    const { query: artistQuery, applicable } = deriveArtistQuery(row.fields);
    let artistFuzzy = [];
    if (applicable && artistQuery && searchFn) {
      const artistProvisional = classifyArtistMatch(row.fields, artistProfiles, []);
      if (artistProvisional.tier === "none") {
        // artistName never distinguishes solo acts from full bands, so both
        // profile_types are searched and their candidates merged -- see
        // artistMatching.js's header comment.
        const [bandResults, soloResults] = await Promise.all([
          searchFn("band", artistQuery),
          searchFn("solo_artist", artistQuery),
        ]);
        artistFuzzy = [...bandResults, ...soloResults];
      }
    }
    artistMatches.set(row.id, classifyArtistMatch(row.fields, artistProfiles, artistFuzzy));
  }

  const rowsWithVenue = rows.map((row) => ({ ...row, venueMatch: venueMatches.get(row.id) }));
  const duplicates = detectDuplicates(rowsWithVenue, { existingGigs });

  return rowsWithVenue.map((row) => {
    const artistMatch = artistMatches.get(row.id);
    const duplicate = duplicates.get(row.id);
    const reviewStatus = deriveReviewStatus({
      parserStatus: row.status,
      duplicate,
      venueMatch: row.venueMatch,
      artistMatch,
    });
    return { ...row, artistMatch, duplicate, reviewStatus };
  });
}
