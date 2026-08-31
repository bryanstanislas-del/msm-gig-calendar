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
