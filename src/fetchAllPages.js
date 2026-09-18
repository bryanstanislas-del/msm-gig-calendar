// ── Paginated fetch helper ──────────────────────────────────────────
// Supabase/PostgREST enforces a project-level max-rows ceiling (Supabase's
// own default is 1000) on every request, silently truncating any
// unbounded `.select()` beyond that many rows -- no error, no warning,
// just a short result. fetchAllPages() is the single, reusable mechanism
// for any query that may return more rows than that ceiling: it drives an
// explicit `.range()` loop, requesting `pageSize` rows at a time, and
// concatenates full pages until a page comes back with fewer than
// `pageSize` rows (including zero) -- the only reliable "that was the
// last page" signal `.range()` gives, since PostgREST never reports how
// many pages there are up front.
//
// `fetchPage(from, to)` is caller-supplied (not built in here) so this
// stays framework-free and trivially testable with a fake page-fetcher --
// no real Supabase client needed. It must return `{ data, error }`
// (matching supabase-js's own response shape). On any page's error this
// throws immediately rather than returning whatever pages already
// accumulated, so a mid-fetch failure can never look like a complete,
// merely-smaller-than-expected dataset to the caller -- see the 1,000-row
// scaling investigation this fixes.
//
// Deterministic ordering is the caller's responsibility (via the query
// `fetchPage` builds): without a stable sort -- a unique tiebreaker
// alongside any non-unique column like `date` or `created_at` -- paging
// through rows that share a sort value can silently duplicate or skip
// rows if two page requests don't see the table in the exact same order.
// See App.jsx's own DB.getApprovedGigs()/getAllGigs() for the orderings
// actually used.
//
// ARCHITECTURE NOTE: this module deliberately has zero dependencies of
// its own (no React, no Supabase client, no App.jsx) -- extracted out of
// App.jsx (independent review, PR #41) specifically so any module that
// needs to page through more than one API page's worth of rows can reuse
// this exact, already-reviewed mechanism without creating a reverse
// import back into App.jsx. App.jsx itself re-exports both names below
// unchanged, so its own DB.* methods and the existing pagination tests
// that import from "./App.jsx" keep working without modification.
export const FETCH_ALL_PAGE_SIZE = 1000;

export async function fetchAllPages(fetchPage, { pageSize = FETCH_ALL_PAGE_SIZE } = {}) {
  const rows = [];
  let from = 0;
  // Guards against a pathological fetchPage that never signals completion
  // (e.g. always returns exactly pageSize rows) turning this into an
  // infinite loop -- 1000 pages at the default page size is 1 million
  // rows, comfortably beyond any realistic near-term MSM scale, so
  // hitting this cap is itself a bug worth surfacing rather than hanging.
  const MAX_PAGES = 1000;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
    from += pageSize;
  }
  throw new Error(`fetchAllPages: exceeded ${MAX_PAGES} pages without reaching a final page -- aborting rather than looping forever`);
}
