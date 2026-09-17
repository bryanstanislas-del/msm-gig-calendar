// Moderation Panel (AdminPanel in App.jsx): pure, side-effect-free helpers
// for the APPROVE ALL VISIBLE bulk action. Kept out of App.jsx and free of
// any Supabase/React import so this can be unit tested in isolation --
// App.jsx has no test coverage today and pulls in a live Supabase client at
// module scope, the same reason notificationHelpers.js and every
// src/smartImport/*.js module already live outside it.
import { mapWithConcurrency } from "./smartImport/concurrency.js";

// Whole-batch bulk actions in this app deliberately operate on the
// caller's own "currently visible" collection, never on the full
// unfiltered dataset -- so an active filter/tab is never silently bypassed.
// This is the same choice Smart Import's own SELECT ALL VISIBLE /
// DESELECT ALL VISIBLE already made (see src/smartImport/batchSelection.js):
// "visible" always means whatever the caller's own filtered list already
// shows, computed once, not re-derived here. Narrowing to status==="pending"
// is what makes APPROVE ALL VISIBLE correct on every AdminPanel tab with no
// special-casing: on PENDING, `visibleGigs` is already all-pending, so this
// is a no-op filter; on ALL, it drops the approved/rejected rows also
// showing; on APPROVED/REJECTED, it's always empty.
export function selectVisiblePendingGigs(visibleGigs) {
  return visibleGigs.filter((g) => g.status === "pending");
}

// Mirrors importEngine.js's IMPORT_CONCURRENCY choice and its reasoning:
// real throughput without opening hundreds of simultaneous connections.
export const BULK_APPROVE_CONCURRENCY = 5;

// Runs `approveFn` over every eligible gig with bounded concurrency,
// mirroring runImport()'s shape (src/smartImport/importEngine.js) almost
// exactly: mapWithConcurrency (reused, not reimplemented) plus a per-item
// try/catch INSIDE the mapped function -- that's what actually stops one
// rejected approval from aborting Promise.all for the rest of the batch; a
// raw, unguarded Promise.all would reject the whole thing on the first
// failure instead of running every row independently.
//
// Defence in depth: AdminPanel is expected to only ever pass rows that are
// already status==="pending" (via selectVisiblePendingGigs above), but this
// re-checks independently rather than trusting the caller -- so a future
// caller accidentally passing an approved/rejected gig can never be
// silently (re-)approved by this helper. It's routed to `skipped` and
// reported instead, never sent to approveFn at all.
export async function bulkApproveGigs(gigs, { approveFn, concurrency = BULK_APPROVE_CONCURRENCY } = {}) {
  const eligible = [];
  const skipped = [];
  for (const gig of gigs) {
    if (gig.status === "pending") eligible.push(gig);
    else skipped.push({ gig, reason: `Not pending (status: ${gig.status})` });
  }

  const results = await mapWithConcurrency(eligible, concurrency, async (gig) => {
    try {
      await approveFn(gig);
      return { gig, ok: true, error: null };
    } catch (e) {
      return { gig, ok: false, error: e?.message || String(e) };
    }
  });

  const succeeded = results.filter((r) => r.ok).map((r) => r.gig);
  const failed = results.filter((r) => !r.ok).map((r) => ({ gig: r.gig, error: r.error }));

  return { succeeded, failed, skipped };
}

// Combines an already-completed bulkApproveGigs() result with the outcome
// of the separate, subsequent "refresh the admin's view" step (App.jsx's
// onRefresh) -- two unrelated operations that must never be confused with
// each other. The approvals themselves either happened or didn't (that's
// entirely `result`'s own succeeded/failed/skipped, untouched here); a
// refresh failure only means the admin's on-screen list may now be stale,
// it does not mean, and must never be reported as, an approval failure.
// Takes no approve callback of its own and performs no I/O, so by
// construction it can never trigger a second approval attempt -- it only
// ever combines two values the caller already computed.
export function finaliseBulkApproveOutcome(result, refreshError = null) {
  return { ...result, refreshError: refreshError ? refreshError.message || String(refreshError) : null };
}

// Moderation search/find: the ALL and APPROVED tabs alone can hold 1,000+
// already-loaded gigs (DB.getAllGigs() pages past the Supabase/PostgREST
// row ceiling -- see dbPagination.test.js), so finding one specific gig to
// edit/delete by scrolling isn't practical. Everything below is a pure,
// side-effect-free filter over that already-loaded array -- no additional
// Supabase request per keystroke, same principle as selectVisiblePendingGigs
// above. Search matches band/venue/city the same way the public Calendar/
// List View search already does (App.jsx's own inline
// `.toLowerCase().includes(q)`), extended to also match a gig's date in
// whichever of its displayed representations (ISO "2026-09-18", UK
// "18/09/2026", or the "18 September 2026" display form fmtDate() produces
// elsewhere in App.jsx) an admin happens to type.
const MODERATION_SEARCH_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// Every lowercase string form of `dateStr` (an ISO "YYYY-MM-DD" gig.date)
// an admin might type or paste. Returns [] for a missing/malformed date --
// a gig with no date yet is simply never date-matched, never a crash.
function gigDateSearchVariants(dateStr) {
  const parts = typeof dateStr === "string" ? dateStr.split("-") : null;
  if (!parts || parts.length !== 3) return [];
  const [y, m, d] = parts;
  const monthName = MODERATION_SEARCH_MONTHS[Number(m) - 1];
  if (!monthName) return [dateStr.toLowerCase()];
  return [
    dateStr.toLowerCase(),             // 2026-09-18
    `${d}/${m}/${y}`,                  // 18/09/2026
    `${Number(d)} ${monthName} ${y}`,  // 18 september 2026
  ];
}

export function normalizeModerationSearchTerm(term) {
  return (term || "").trim().toLowerCase();
}

// True if `gig` matches `term` against band_name, venue, city, or any date
// representation above. An empty/whitespace-only term always matches.
export function gigMatchesModerationSearch(gig, term) {
  const q = normalizeModerationSearchTerm(term);
  if (!q) return true;
  if ((gig.band_name || "").toLowerCase().includes(q)) return true;
  if ((gig.venue      || "").toLowerCase().includes(q)) return true;
  if ((gig.city       || "").toLowerCase().includes(q)) return true;
  return gigDateSearchVariants(gig.date).some((v) => v.includes(q));
}

// Applies Moderation's search box and optional exact-date filter together,
// over an already status-filtered `gigs` array, preserving its order.
// `date`, when set, is an exact ISO "YYYY-MM-DD" match (an <input
// type="date"> value) -- deliberately independent of the free-text search
// above, which matches by substring across several date formats.
export function filterModerationGigs(gigs, { search, date } = {}) {
  let result = gigs;
  if (date) result = result.filter((g) => g.date === date);
  const q = normalizeModerationSearchTerm(search);
  if (q) result = result.filter((g) => gigMatchesModerationSearch(g, q));
  return result;
}
