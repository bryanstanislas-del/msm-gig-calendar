// Shared by runMatching.js (Sprint 5B) and importEngine.js (Sprint 5C):
// runs `fn` over `items` with at most `limit` calls in flight at once,
// preserving the original order in the returned array regardless of which
// call finishes first (each result is written to its own pre-sized index).
// Originally built for runMatching.js's search_entities round trips;
// reused as-is for importEngine.js's import_gig_row RPC calls rather than
// re-implementing the same worker-pool logic a second time.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
