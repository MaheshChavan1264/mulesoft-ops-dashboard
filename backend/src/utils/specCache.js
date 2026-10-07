const db = require('./db');
const logger = require('./logger');

/**
 * Durable SQLite cache for GET /exchange/ping-spec results.
 *
 * Resolving + downloading + parsing an Exchange asset spec (Portal Model
 * API call, possible raw OAS/RAML file download + ZIP extraction, AMF
 * enrichment, and — when the app wasn't given exact asset coordinates — a
 * whole round of Exchange search/variant-probing calls) costs several
 * Anypoint API round-trips per request. Specs change rarely (a new asset
 * version gets published, not on every deploy), so persisting the parsed
 * result here lets repeat lookups for the same app/asset skip Anypoint
 * entirely while the row is fresh — unlike the frontend's in-memory SWR
 * cache (apiCache.js), this survives page reloads and is shared across
 * all users/sessions hitting the same backend.
 */

// Successful lookups (spec resolved, endpoints found) rarely go stale —
// cache them for a day. Empty/unresolved results get a much shorter TTL so
// a newly-published or newly-linked spec is picked up again reasonably
// soon, instead of being "stuck empty" for a full day.
const SPEC_CACHE_TTL_MS = parseInt(process.env.EXCHANGE_SPEC_CACHE_TTL_MS, 10) || 24 * 60 * 60 * 1000;
const EMPTY_SPEC_CACHE_TTL_MS = parseInt(process.env.EXCHANGE_SPEC_EMPTY_CACHE_TTL_MS, 10) || 30 * 60 * 1000;

function hasEndpoints(data) {
  return (Array.isArray(data?.pingEndpoints) && data.pingEndpoints.length > 0) ||
    (Array.isArray(data?.allEndpoints) && data.allEndpoints.length > 0);
}

/**
 * @param {string} cacheKey
 * @returns {Promise<{ data: object, fetchedAt: number, ageMs: number } | null>}
 */
function getCachedSpec(cacheKey) {
  return new Promise((resolve) => {
    db.get(`SELECT data, fetched_at FROM exchange_spec_cache WHERE cache_key = ?`, [cacheKey], (err, row) => {
      if (err) {
        logger.warn({ err }, '[specCache] read failed');
        return resolve(null);
      }
      if (!row) return resolve(null);

      let parsed;
      try { parsed = JSON.parse(row.data); } catch { return resolve(null); }

      const ttl = hasEndpoints(parsed) ? SPEC_CACHE_TTL_MS : EMPTY_SPEC_CACHE_TTL_MS;
      const ageMs = Date.now() - row.fetched_at;
      if (ageMs > ttl) return resolve(null); // stale — caller will re-fetch and overwrite

      resolve({ data: parsed, fetchedAt: row.fetched_at, ageMs });
    });
  });
}

/**
 * @param {string} cacheKey
 * @param {object} data            Response body to cache (as returned to the client)
 * @param {{ orgId?: string, appName?: string, groupId?: string, assetId?: string, version?: string }} [meta]
 */
function setCachedSpec(cacheKey, data, meta = {}) {
  const { orgId, appName, groupId, assetId, version } = meta;
  let payload;
  try { payload = JSON.stringify(data); } catch (err) {
    logger.warn({ err }, '[specCache] failed to serialize spec for caching');
    return;
  }
  const now = Date.now();
  db.run(
    `INSERT INTO exchange_spec_cache (cache_key, org_id, app_name, group_id, asset_id, version, data, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       org_id = excluded.org_id,
       app_name = excluded.app_name,
       group_id = excluded.group_id,
       asset_id = excluded.asset_id,
       version = excluded.version,
       data = excluded.data,
       fetched_at = excluded.fetched_at`,
    [cacheKey, orgId || null, appName || null, groupId || null, assetId || null, version || null, payload, now],
    (err) => { if (err) logger.warn({ err }, '[specCache] write failed'); }
  );
}

function invalidateCachedSpec(cacheKey) {
  db.run(`DELETE FROM exchange_spec_cache WHERE cache_key = ?`, [cacheKey], (err) => {
    if (err) logger.warn({ err }, '[specCache] invalidate failed');
  });
}

module.exports = {
  getCachedSpec,
  setCachedSpec,
  invalidateCachedSpec,
  SPEC_CACHE_TTL_MS,
  EMPTY_SPEC_CACHE_TTL_MS,
};
