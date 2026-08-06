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
import { deriveRowState } from "./reviewBatch.js";
import { mapWithConcurrency } from "./concurrency.js";

// Rows are matched concurrently, capped at this many in flight at once.
// Verified against the real msm-gig-guide-sample.txt fixture (226 rows)
// against the real database: almost none of that fixture's venues/artists
// exist in the real (small, unrelated) table, so nearly every row needs a
// search_entities round trip -- fully sequential (one row, then the next)
// would mean 200+ round trips back-to-back before the admin sees a result.
// A small concurrency cap gets the wall-clock time down without opening
// hundreds of simultaneous connections against a shared database for what
// is still just an admin preview tool.
const MATCH_CONCURRENCY = 6;

async function matchRow(row, { venues, artistProfiles, searchFn }) {
  // A cheap local-only pass first: only worth a network round trip once
  // there's no exact match to be found in the venues/profiles snapshot
  // already in hand.
  const venueProvisional = classifyVenueMatch(row.fields, venues, []);
  let venueFuzzy = [];
  if (venueProvisional.tier === "none" && venueProvisional.query && searchFn) {
    venueFuzzy = await searchFn("venue", venueProvisional.query);
  }
  const venueMatch = classifyVenueMatch(row.fields, venues, venueFuzzy);

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
  const artistMatch = classifyArtistMatch(row.fields, artistProfiles, artistFuzzy);

  return { ...row, venueMatch, artistMatch };
}

// searchFn(entityType, query) -> Promise<Array<{ id, name, city, similarity_score }>>,
// matching DB.searchEntities's own signature (App.jsx), which wraps the
// search_entities RPC. Optional: omitting it (e.g. in a test) simply means
// every row that isn't an exact match falls through to "none" instead of
// "fuzzy", since there are no candidates to offer.
export async function runMatching(parseResult, { venues = [], artistProfiles = [], existingGigs = [], searchFn } = {}) {
  const matchedRows = await mapWithConcurrency(parseResult.rows, MATCH_CONCURRENCY, (row) =>
    matchRow(row, { venues, artistProfiles, searchFn })
  );

  const duplicates = detectDuplicates(matchedRows, { existingGigs });

  return matchedRows.map((row) => {
    const duplicate = duplicates.get(row.id);
    const rowState = deriveRowState({
      parserStatus: row.status,
      fields: row.fields,
      duplicate,
      venueMatch: row.venueMatch,
      artistMatch: row.artistMatch,
    });
    return { ...row, duplicate, rowState };
  });
}
