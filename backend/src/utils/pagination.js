/**
 * Clamp caller-supplied pagination params before forwarding them to an
 * upstream API. Several routes (apis.js, applications.js, organizations.js)
 * took `limit`/`offset` straight from `req.query` with no bounds — a client
 * could request `limit=999999999` and this backend would dutifully forward
 * that to Anypoint.
 *
 * @param {object} query          req.query
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit=50]
 * @param {number} [opts.maxLimit=200]
 * @returns {{ limit: number, offset: number }}
 */
function clampPagination(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), maxLimit)
    : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0
    ? Math.floor(rawOffset)
    : 0;
  return { limit, offset };
}

module.exports = { clampPagination };
