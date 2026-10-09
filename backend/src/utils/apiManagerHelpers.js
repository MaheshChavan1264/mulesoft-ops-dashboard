/**
 * API Manager helper functions extracted from the `/api/health/auto-credentials`
 * route handler closure in routes/health.js. These previously lived as nested
 * function declarations inside the route (capturing `client`/`appName` from
 * the enclosing scope), which made them impossible to unit test and
 * duplicated conceptual overlap with the Exchange asset-matching logic in
 * routes/exchange.js. Now `client` is an explicit parameter and these are
 * plain exported functions.
 */
const logger = require('./logger');
const { stripDeploymentSuffix } = require('./appHelpers');

/**
 * Normalize a name for fuzzy matching:
 *   - strip deployment/version suffixes (via shared stripDeploymentSuffix)
 *   - replace hyphens / underscores / dots with space
 *   - collapse whitespace
 *
 * Uses stripDeploymentSuffix from appHelpers so the regex rules stay in sync
 * with the Exchange search normalization in exchange.js.
 */
function normalizeName(name) {
  return stripDeploymentSuffix(name)
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fuzzy-match an app name against an API Manager instance label. */
function isMatch(appName, apiLabel) {
  const a = normalizeName(appName);
  const b = normalizeName(apiLabel);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Flatten an API Manager list response (assets[] or apis[] shape) into a flat array. */
function flattenApiResponse(data) {
  const assets = data?.assets;
  if (Array.isArray(assets) && assets.length > 0) {
    return assets.flatMap(asset =>
      (asset.apis || []).map(api => ({
        ...api,
        assetId: api.assetId || asset.assetId,
        asset: {
          assetId: asset.assetId,
          exchangeAssetName: asset.exchangeAssetName || asset.assetId,
          ...(api.asset || {}),
        },
      }))
    );
  }
  const raw = data?.apis || data?.data || [];
  return Array.isArray(raw) ? raw : [];
}

/**
 * Fetch ALL API Manager instances for org+env using pagination (100/page).
 *
 * @param {import('axios').AxiosInstance} client
 * @param {string} oId
 * @param {string} eId
 * @param {string} [filterAssetId]
 */
async function fetchAllApisForEnv(client, oId, eId, filterAssetId) {
  const PAGE = 100;
  let offset = 0;
  let all = [];
  try {
    while (true) {
      const params = { limit: PAGE, offset };
      if (filterAssetId) params.assetId = filterAssetId;
      const r = await client.get(
        `/apimanager/api/v1/organizations/${oId}/environments/${eId}/apis`,
        { params }
      );
      const page = flattenApiResponse(r.data);
      all = all.concat(page);
      const total = r.data?.total ?? page.length;
      if (all.length >= total || page.length < PAGE) break;
      offset += PAGE;
    }
  } catch { /* return what we have so far */ }
  return all;
}

/**
 * Fetch ALL pages of API Manager instances for org+env, returning a response
 * shaped exactly like Anypoint's own single-page response (`{ assets: [...] }`
 * / `{ apis: [...] }` / `{ data: [...] }` / a bare array) so existing callers
 * (frontend's ApiManagerPage.jsx) need no changes to their parsing logic —
 * only now every page's items are concatenated under that same top-level key
 * instead of silently truncating at whatever the default/requested page size
 * happens to be.
 *
 * Previously `routes/apis.js`'s `GET /:orgId/:envId` made exactly ONE call
 * with `limit=50,offset=0` (see utils/pagination.js's clampPagination
 * defaults) and forwarded that single page verbatim — any org+env with more
 * than 50 registered API instances silently lost the 51st+ with no warning
 * anywhere in the UI. `fetchAllApisForEnv` above already solved this exact
 * problem for routes/health.js's auto-credentials matcher by flattening
 * every page's nested asset→instances structure as it goes — reused here
 * (not duplicated) purely for its page-continuation decision (comparing the
 * FLATTENED instance count against Anypoint's own `total`, exactly as that
 * route already does), while this function additionally preserves each
 * page's original raw (unflattened) shape for the response body, since the
 * frontend does its own asset→instances flattening (see
 * ApiManagerPage.jsx's loadApisInternal) and expects that structure intact.
 *
 * @param {import('axios').AxiosInstance} client
 * @param {string} oId
 * @param {string} eId
 * @returns {Promise<object|Array>}
 */
async function fetchAllApiInstancesRaw(client, oId, eId) {
  const PAGE = 100;
  let offset = 0;
  let combinedKey = null; // 'assets' | 'apis' | 'data' | 'array' — whichever shape the FIRST page used
  let combinedRaw = [];
  let flatCount = 0;

  for (;;) {
    const response = await client.get(
      `/apimanager/api/v1/organizations/${oId}/environments/${eId}/apis`,
      { params: { limit: PAGE, offset } }
    );
    const data = response.data;

    let pageRaw;
    if (Array.isArray(data?.assets)) { combinedKey = combinedKey || 'assets'; pageRaw = data.assets; }
    else if (Array.isArray(data?.apis)) { combinedKey = combinedKey || 'apis'; pageRaw = data.apis; }
    else if (Array.isArray(data?.data)) { combinedKey = combinedKey || 'data'; pageRaw = data.data; }
    else if (Array.isArray(data)) { combinedKey = combinedKey || 'array'; pageRaw = data; }
    else { pageRaw = []; }

    combinedRaw = combinedRaw.concat(pageRaw);

    // Same continuation check fetchAllApisForEnv already uses: compare the
    // FLATTENED instance count (handles the assets→nested-apis grouping)
    // against Anypoint's own `total`, falling back to "this page came back
    // short, so it must be the last one" when `total` is absent.
    const pageFlatCount = flattenApiResponse(data).length;
    flatCount += pageFlatCount;
    const total = data?.total ?? flatCount;
    if (flatCount >= total || pageFlatCount < PAGE || pageRaw.length === 0) break;
    offset += PAGE;
  }

  if (combinedKey === 'assets') return { assets: combinedRaw, total: flatCount };
  if (combinedKey === 'apis') return { apis: combinedRaw, total: flatCount };
  if (combinedKey === 'data') return { data: combinedRaw, total: flatCount };
  return combinedRaw;
}

/**
 * Fetch approved contracts for one API instance and return normalized rows.
 *
 * @param {import('axios').AxiosInstance} client
 * @param {string} oId
 * @param {string} eId
 * @param {object} api  API Manager instance object (from fetchAllApisForEnv / direct lookup)
 */
async function extractContractClientIds(client, oId, eId, api) {
  const apiLabel =
    api.instanceLabel ||
    api.asset?.exchangeAssetName ||
    api.asset?.assetId ||
    String(api.id);
  try {
    const r = await client.get(
      `/apimanager/api/v1/organizations/${oId}/environments/${eId}/apis/${api.id}/contracts`
    );
    const raw = r.data?.contracts || r.data || [];
    return (Array.isArray(raw) ? raw : [])
      .filter(c => (c.status || '').toUpperCase() === 'APPROVED')
      .map(c => ({
        clientId:
          c.application?.coreServicesId ||
          c.application?.clientId ||
          c.application?.credentials?.clientId ||
          c.clientApplication?.coreServicesId ||
          c.clientId ||
          c.credentials?.clientId ||
          null,
        apiInstanceName: apiLabel,
        apiInstanceId: api.id,
        contractApp: c.application?.name || 'Unknown',
      }))
      .filter(x => x.clientId);
  } catch (err) {
    logger.warn(`[auto-credentials] contracts fetch failed for API ${api.id}: ${err.message}`);
    return [];
  }
}

/**
 * Collect unique clientIds from up to 5 API instances in parallel.
 *
 * @param {import('axios').AxiosInstance} client
 * @param {string} oId
 * @param {string} eId
 * @param {Array} matchedApis
 */
async function collectCandidates(client, oId, eId, matchedApis) {
  const seen = new Set();
  const allCandidates = [];
  const matchInfo = [];
  await Promise.allSettled(
    matchedApis.slice(0, 5).map(async api => {
      const rows = await extractContractClientIds(client, oId, eId, api);
      for (const row of rows) {
        if (!seen.has(row.clientId)) {
          seen.add(row.clientId);
          allCandidates.push(row.clientId);
          matchInfo.push(row);
        }
      }
    })
  );
  return { allCandidates, matchInfo };
}

/** Fuzzy-filter a list of API Manager instances against an app name. */
function fuzzyMatchApis(apis, appName) {
  return apis.filter(api => {
    const labels = [
      api.instanceLabel,
      api.asset?.exchangeAssetName,
      api.asset?.assetId,
      api.asset?.name,
      api.assetId,
    ].filter(Boolean);
    return labels.some(l => isMatch(appName, l));
  });
}

/**
 * Get all environments for an org.
 *
 * @param {import('axios').AxiosInstance} client
 * @param {string} oId
 */
async function getOrgEnvs(client, oId) {
  try {
    const r = await client.get(`/accounts/api/organizations/${oId}/environments`);
    const list = r.data?.data || r.data?.environments || r.data || [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

module.exports = {
  normalizeName,
  isMatch,
  flattenApiResponse,
  fetchAllApisForEnv,
  fetchAllApiInstancesRaw,
  extractContractClientIds,
  collectCandidates,
  fuzzyMatchApis,
  getOrgEnvs,
};
