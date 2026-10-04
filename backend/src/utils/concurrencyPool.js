/**
 * Run `worker(item)` over `items` with at most `limit` in flight at once —
 * a real concurrency pool, not a "wait for the whole batch of N before
 * starting the next N" lock-step loop.
 *
 * Why this matters: `routes/cps.js` (`/search-user`) and
 * `routes/exchange.js` (`/ping-spec` asset search) both used to process
 * work in fixed-size batches via `for (i += BATCH) { await Promise.allSettled(batch) }`.
 * With that shape, a single slow item in a batch of 30 blocks the next 30
 * from starting even though 29 of the 30 already finished — this keeps a
 * constant number of in-flight requests instead, so throughput is bound by
 * the slowest *individual* item, not the slowest item per batch.
 *
 * Never rejects: each worker call is wrapped so one failing item doesn't
 * abort the whole pool. Failures are returned as
 * `{ status: 'rejected', reason }` to mirror `Promise.allSettled` shape,
 * `{ status: 'fulfilled', value }` on success — callers that used to feed
 * `Promise.allSettled` results through the same handling logic can switch
 * to this with no change to their result-handling code.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit  max concurrent in-flight worker calls
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<Array<{status:'fulfilled',value:R}|{status:'rejected',reason:any}>>}
 */
async function mapWithConcurrency(items, limit, worker) {
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
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}

module.exports = { mapWithConcurrency };
