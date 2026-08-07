/**
 * Frontend in-memory API response cache.
 *
 * Lives in module scope — survives React component unmount/remount but
 * is cleared on browser refresh (intentional — ensures data freshness
 * after a full page reload).
 *
 * Default TTL: 20 minutes.
 */

const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const cache = new Map();

/** Return cached value if still fresh, otherwise null. */
export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/** Store a value in cache. */
export function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

/** Remove all cache entries whose key starts with a given prefix. */
export function bustCache(keyPrefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(keyPrefix)) cache.delete(k);
  }
}

/** Clear the entire cache (e.g., on logout). */
export function clearCache() {
  cache.clear();
}