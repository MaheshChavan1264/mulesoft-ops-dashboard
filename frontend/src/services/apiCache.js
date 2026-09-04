/**
 * Frontend in-memory API response cache.
 *
 * Lives in module scope — survives React component unmount/remount but
 * is cleared on browser refresh (intentional — ensures data freshness
 * after a full page reload).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  FRESH_MS  (3 min)  — entry is fresh; no network call needed        │
 * │  STALE_MS  (20 min) — entry is stale-but-usable; trigger bg refetch │
 * │  > STALE_MS         — entry is evicted on next read                 │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Per-key TTL: setCached(key, data, staleMs) lets callers store
 *   slow-changing data (BGs: 30 min) vs fast-changing data (apps: 3 min)
 *   with different eviction windows.
 */

const STALE_MS   = 20 * 60 * 1000;   // default eviction window  (20 min)
const FRESH_MS   =  3 * 60 * 1000;   // SWR freshness threshold   (3 min)
const MAX_ENTRIES = 300;              // LRU-style hard cap

const cache    = new Map();   // key → { data, ts, staleMs }
const inflight = new Map();   // key → Promise<data>  (request deduplication)

// ── Internal helpers ─────────────────────────────────────────────────────────

function _isExpired(entry) {
  return Date.now() - entry.ts > (entry.staleMs ?? STALE_MS);
}

function _isStale(entry) {
  return Date.now() - entry.ts > FRESH_MS;
}

/** Evict one expired entry or, if all fresh, the oldest entry (LRU). */
function _evictOne() {
  for (const [k, v] of cache.entries()) {
    if (_isExpired(v)) { cache.delete(k); return; }
  }
  // All entries are fresh — evict the oldest (Map preserves insertion order)
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) cache.delete(firstKey);
}

// ── Core read / write ────────────────────────────────────────────────────────

/**
 * Return cached value if within eviction window, otherwise null.
 * Backward-compatible drop-in for the original getCached.
 */
export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (_isExpired(entry)) { cache.delete(key); return null; }
  return entry.data;
}

/**
 * Stale-While-Revalidate read.
 * Returns { data, stale } if the entry exists within the eviction window.
 * Returns null on miss or eviction.
 *
 *  stale=false → data is fresh  (< FRESH_MS old)  — no network call needed
 *  stale=true  → data is usable (< STALE_MS old) — caller should trigger
 *                a silent background refetch without blocking the UI
 */
export function getCachedSWR(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (_isExpired(entry)) { cache.delete(key); return null; }
  return { data: entry.data, stale: _isStale(entry) };
}

/**
 * Store a value in the cache.
 * @param {string} key
 * @param {*}      data
 * @param {number} [staleMs]  Custom eviction window (ms). Defaults to STALE_MS (20 min).
 */
export function setCached(key, data, staleMs = STALE_MS) {
  if (cache.size >= MAX_ENTRIES) _evictOne();
  cache.set(key, { data, ts: Date.now(), staleMs });
}

// ── Inflight deduplication + SWR combo ───────────────────────────────────────

/**
 * Get-or-fetch with inflight deduplication and stale-while-revalidate.
 *
 * - Fresh hit  → returns data instantly, no network
 * - Stale hit  → returns stale data instantly AND kicks off fetchFn in background
 * - Cache miss → deduplicates concurrent requests; all waiters share one HTTP call
 *
 * @param {string}   key
 * @param {Function} fetchFn   () => Promise<data>
 * @param {number}   [staleMs] Custom eviction window passed to setCached
 * @returns {Promise<data>}
 */
export async function getOrFetch(key, fetchFn, staleMs = STALE_MS) {
  const swr = getCachedSWR(key);

  // Fresh — no network at all
  if (swr && !swr.stale) return swr.data;

  // Start a fetch if one isn't already in-flight
  if (!inflight.has(key)) {
    const promise = fetchFn()
      .then(data  => { setCached(key, data, staleMs); inflight.delete(key); return data; })
      .catch(err  => { inflight.delete(key); throw err; });
    inflight.set(key, promise);
  }

  // Stale hit → return stale data immediately; background promise updates cache
  if (swr?.stale) return swr.data;

  // True miss → await the single in-flight promise
  return inflight.get(key);
}

// ── Cache invalidation ───────────────────────────────────────────────────────

/** Remove all cache entries whose key starts with a given prefix. */
export function bustCache(keyPrefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(keyPrefix)) cache.delete(k);
  }
}

/** Clear the entire cache and any in-flight requests (e.g., on logout). */
export function clearCache() {
  cache.clear();
  inflight.clear();
}

// ── Background TTL sweep (requestIdleCallback) ───────────────────────────────
// Proactively evicts expired entries during browser idle time so they never
// accumulate in long-running sessions. Never competes with rendering or input.

function _scheduleSweep() {
  const sweep = () => {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.ts > (v.staleMs ?? STALE_MS)) cache.delete(k);
    }
    _scheduleSweep();
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(sweep, { timeout: 5 * 60 * 1000 });
  } else {
    setTimeout(sweep, 5 * 60 * 1000);   // fallback for Safari < 16
  }
}

_scheduleSweep();

// ── Dev diagnostics ──────────────────────────────────────────────────────────
// Open browser console → window.__cacheStats() to inspect hit/miss ratios.
if (import.meta.env.DEV) {
  window.__cacheStats = () => {
    const entries = [...cache.entries()].map(([k, v]) => ({
      key: k,
      ageMs: Date.now() - v.ts,
      staleMs: v.staleMs ?? STALE_MS,
      stale: _isStale(v),
      expired: _isExpired(v),
    }));
    return { size: cache.size, inflight: inflight.size, entries };
  };
}