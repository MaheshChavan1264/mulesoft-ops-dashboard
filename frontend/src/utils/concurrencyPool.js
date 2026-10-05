/**
 * Run `worker(item)` over `items` with at most `limit` in flight at once —
 * a real concurrency pool, not a "wait for the whole batch of N before
 * starting the next N" lock-step loop.
 *
 * Mirrors backend/src/utils/concurrencyPool.js — the frontend had no
 * equivalent, so every multi-request fan-out (SchedulersPage's per-BG
 * requests in "All Organizations" mode, etc.) either used an unbounded
 * `Promise.all`/`Promise.allSettled` over the full array, or a manual
 * `slice()`-based batching loop (see utils/exportCps.js) with the same
 * "one slow item blocks the whole next batch" problem this avoids.
 *
 * Never rejects: each worker call is wrapped so one failing item doesn't
 * abort the whole pool. Results mirror `Promise.allSettled`'s shape
 * (`{ status: 'fulfilled', value }` / `{ status: 'rejected', reason }`),
 * so existing `.forEach((r, i) => r.status === 'fulfilled' ? ... : ...)`
 * handling code works unchanged when switching to this.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit  max concurrent in-flight worker calls
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {(item: T, index: number, result: {status:'fulfilled',value:R}|{status:'rejected',reason:any}) => void} [onItemDone]
 *   optional streaming hook — called synchronously the instant EACH item
 *   settles (not waiting for the whole batch), so callers can render partial
 *   progress incrementally instead of blocking on the slowest item.
 * @returns {Promise<Array<{status:'fulfilled',value:R}|{status:'rejected',reason:any}>>}
 */
export async function mapWithConcurrency(items, limit, worker, onItemDone) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
      onItemDone?.(items[i], i, results[i]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}
