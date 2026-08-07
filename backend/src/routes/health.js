const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Agent that tolerates self-signed / internal-CA certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const PING_PATHS = ['/api/v1/ping', '/api/v2/ping', '/api/ping', '/ping'];
const PING_TIMEOUT_MS = 10000; // 10 s

function buildBaseUrl(targetType, appName, ch2IngressUrl) {
  const safe = (appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (targetType === 'CH2' && ch2IngressUrl) {
    const candidates = ch2IngressUrl
      .split(',')
      .map(u => u.trim().replace(/\/+$/, ''))
      .filter(u => /^https?:\/\/.+/.test(u));

    if (candidates.length > 0) {
      const external = candidates.find(u => !u.includes('internalapi'));
      return external || candidates[0];
    }
  }

  return `https://${safe}.api.sfdcbt.net`;
}

/**
 * POST /api/health/ping
 */
router.post('/ping', async (req, res) => {
  const {
    targetType = 'CH1',
    appName,
    ch2IngressUrl,
    clientId,
    clientSecret,
    transactionId = 'smokeTest',
    queryParams = '',   // optional: "key1=val1&key2=val2" appended to every ping URL
  } = req.body || {};

  if (!appName) {
    return res.status(400).json({ error: 'appName is required' });
  }

  const base = buildBaseUrl(targetType, appName, ch2IngressUrl);

  const outboundHeaders = {
    Accept: 'application/json, */*',
    'Content-Type': 'application/json',
    'x-transaction-id': transactionId,
  };
  if (clientId) outboundHeaders['client_id'] = clientId;
  if (clientSecret) outboundHeaders['client_secret'] = clientSecret;

  console.log('[Ping] Base URL:', base);
  console.log('[Ping] Headers being sent:', {
    'x-transaction-id': transactionId,
    client_id: clientId ? `${clientId.slice(0, 6)}…` : '(not set)',
    client_secret: clientSecret ? `${clientSecret.slice(0, 4)}… (len ${clientSecret.length})` : '(not set)',
  });

  const attempts = [];

  for (const path of PING_PATHS) {
    // Append optional query parameters (Feature 5: smart ping URL resolution)
    const url = queryParams ? `${base}${path}?${queryParams}` : `${base}${path}`;
    const t0 = Date.now();

    try {
      const response = await axios.get(url, {
        timeout: PING_TIMEOUT_MS,
        validateStatus: () => true,
        headers: outboundHeaders,
        maxRedirects: 5,
        httpsAgent,
      });

      console.log(`[Ping] ${url} → ${response.status}`);

      const responseTimeMs = Date.now() - t0;
      const httpStatus = response.status;

      let payload = null;
      try {
        payload = typeof response.data === 'object'
          ? response.data
          : JSON.parse(response.data);
      } catch {
        payload = response.data ? String(response.data).slice(0, 500) : null;
      }

      attempts.push({ url, httpStatus, responseTimeMs });

      const payloadStr = payload
        ? typeof payload === 'string' ? payload : JSON.stringify(payload)
        : '';

      // Detect responses that mean "this path doesn't exist on the app" —
      // in these cases skip to the next path rather than stopping early.
      //
      // Rules (any of the following → skip):
      //   1. HTTP 404 — path not found on the Mule app; try the next path
      //   2. Mule "No listener for endpoint" text
      //   3. "No flow" text (older Mule runtimes)
      //   4. "resource not found" text
      const isNoListener =
        httpStatus === 404 ||
        payloadStr.toLowerCase().includes('no listener for endpoint') ||
        payloadStr.toLowerCase().includes('no flow') ||
        payloadStr.toLowerCase().includes('resource not found');

      if (httpStatus < 500 && !isNoListener) {
        // This path returned a definitive response (2xx success, or 401/403
        // meaning the app IS reachable but credentials are wrong).
        const status =
          httpStatus >= 200 && httpStatus < 300 ? 'SUCCESS' :
          httpStatus >= 400 && httpStatus < 500 ? 'PARTIAL' : 'FAILED';

        return res.json({ status, activeEndpoint: url, responseTimeMs, httpStatus, payload, attempts });
      }
    } catch (err) {
      const responseTimeMs = Date.now() - t0;
      let errorDetail = err.message;

      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        errorDetail = `Timeout after ${PING_TIMEOUT_MS}ms`;
      } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        errorDetail = 'DNS resolution failed — host unreachable';
      } else if (err.code === 'ECONNREFUSED') {
        errorDetail = 'Connection refused';
      } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        errorDetail = 'SSL certificate error';
      }

      attempts.push({ url, error: errorDetail, responseTimeMs });
    }
  }

  return res.json({
    status: 'FAILED',
    activeEndpoint: null,
    responseTimeMs: null,
    httpStatus: null,
    payload: null,
    attempts,
    error: 'All ping paths unreachable or returned 5xx',
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a name for fuzzy matching:
 *   - lowercase
 *   - strip version suffixes (-v1, -v2, -v1.0, v1 …)
 *   - replace hyphens / underscores / dots with space
 *   - collapse whitespace
 */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    // Strip trailing cloud/region+env deployment suffixes before version:
    //   e.g. -uw2-up, -eu2-ut, -ap1-ud, -uw2-up1, -eu1-prod, -us1-uat
    .replace(/-[a-z]{2,4}\d+[-_][a-z]{2,5}\d*$/i, '')
    // Strip standalone region codes at end: -uw2, -eu2, -ap1
    .replace(/-[a-z]{2,3}\d+$/i, '')
    // Strip version suffixes (-v1, _v2, .v1.0, v1 bare)
    .replace(/[-_.]v\d+(\.\d+)*$/i, '')
    .replace(/\bv\d+(\.\d+)*$/i, '')
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMatch(appName, apiLabel) {
  const a = normalizeName(appName);
  const b = normalizeName(apiLabel);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// ─── POST /api/health/auto-credentials ───────────────────────────────────────
/**
 * Foolproof multi-layer strategy to find the API Manager instance for a
 * deployed Mule app and return the clientIds from its APPROVED contracts.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  LAYER 1 — Direct api.id lookup  (100% accurate, fastest)              │
 * │  If the frontend passes `apiId` (from the app's Autodiscovery property  │
 * │  `api.id`), use it to call /apis/{apiId} directly — no name matching.  │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  LAYER 2 — assetId-filtered paginated search  (high accuracy)          │
 * │  If `assetId` is known, pass it as a query param to the API Manager    │
 * │  list endpoint so only instances of that asset are returned.            │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  LAYER 3 — Paginated fuzzy name search in deployment env  (good)       │
 * │  Fetch ALL instances (paginated, no 200-cap) and match on              │
 * │  instanceLabel / exchangeAssetName / assetId / asset.name.             │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  LAYER 4 — All envs in the same BG  (catches cross-env registrations)  │
 * │  Repeat Layer 3 for every other environment in the same BG.            │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  LAYER 5 — Parent BG walk  (catches root-org API registrations)        │
 * │  Walk up the BG hierarchy and repeat Layers 3-4 for each ancestor.     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Body: {
 *   orgId        string   BG of the deployed app
 *   envId        string   env of the deployed app
 *   appName      string   app name (used for fuzzy matching in Layers 2-5)
 *   apiId?       string   api.id from app Autodiscovery properties → Layer 1
 *   assetId?     string   Exchange assetId from app properties → Layer 2
 *   apiMgrOrgId? string   override BG to search in API Manager
 * }
 */
router.post('/auto-credentials', authMiddleware, async (req, res) => {
  const { orgId, envId, appName, apiId, assetId, apiMgrOrgId } = req.body || {};

  if (!orgId || !envId || !appName) {
    return res.status(400).json({
      error: 'orgId, envId, and appName are required',
      found: false,
      candidates: [],
    });
  }

  try {
    const client = createClient(req.anypointToken);
    const searchOrgId = (apiMgrOrgId && apiMgrOrgId !== orgId) ? apiMgrOrgId : orgId;

    // Log what was received — helps debug why Layer 1/2 may not fire
    console.log(`[auto-credentials] Request — appName="${appName}" apiId=${apiId || 'null'} assetId=${assetId || 'null'} org=${searchOrgId} env=${envId}`);

    // ── Shared helpers ──────────────────────────────────────────────────────

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
     * Pass filterAssetId to add ?assetId= server-side filtering (Layer 2).
     */
    async function fetchAllApisForEnv(oId, eId, filterAssetId) {
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
     * Fetch approved contracts for one API instance and return normalized rows.
     * clientId priority: coreServicesId (OAuth) → clientId → credentials.clientId
     */
    async function extractContractClientIds(oId, eId, api) {
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
              c.application?.coreServicesId ||      // ← PRIMARY (Anypoint OAuth)
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
        console.warn(`[auto-credentials] contracts fetch failed for API ${api.id}:`, err.message);
        return [];
      }
    }

    /** Collect unique clientIds from up to 5 API instances in parallel. */
    async function collectCandidates(oId, eId, matchedApis) {
      const seen = new Set();
      const allCandidates = [];
      const matchInfo = [];
      await Promise.allSettled(
        matchedApis.slice(0, 5).map(async api => {
          const rows = await extractContractClientIds(oId, eId, api);
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

    /** Fuzzy-filter a list of API instances against the app name. */
    function fuzzyMatch(apis) {
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

    /** Get all environments for an org (cached across layers). */
    async function getOrgEnvs(oId) {
      try {
        const r = await client.get(`/accounts/api/organizations/${oId}/environments`);
        const list = r.data?.data || r.data?.environments || r.data || [];
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    }

    /** Build a result response and send it. */
    function sendResult(res, allCandidates, matchInfo, matchedApis, layer) {
      console.log(`[auto-credentials] ✅ Layer ${layer} — ${allCandidates.length} clientId(s) for "${appName}"`);
      return res.json({
        found: allCandidates.length > 0,
        candidates: allCandidates,
        matchInfo,
        matchedApis: matchedApis.slice(0, 5).map(a => ({
          id: a.id,
          label: a.instanceLabel || a.asset?.exchangeAssetName || a.asset?.assetId || String(a.id),
        })),
        resolvedLayer: layer,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 1: Direct api.id lookup
    // If the Mule app has Autodiscovery configured, it will have `api.id` in
    // its runtime properties. Use that to fetch the exact API Manager instance.
    // ─────────────────────────────────────────────────────────────────────────
    if (apiId) {
      console.log(`[auto-credentials] Layer 1 — direct api.id="${apiId}"`);
      // Try the deployment env first; then scan others in the same org
      const envIds = [envId, ...(await getOrgEnvs(searchOrgId)).map(e => e.id).filter(id => id !== envId)];
      for (const eid of envIds) {
        try {
          const r = await client.get(
            `/apimanager/api/v1/organizations/${searchOrgId}/environments/${eid}/apis/${apiId}`
          );
          if (r.data?.id) {
            const { allCandidates, matchInfo } = await collectCandidates(searchOrgId, eid, [r.data]);
            if (allCandidates.length > 0) {
              return sendResult(res, allCandidates, matchInfo, [r.data], 1);
            }
          }
        } catch { /* try next env */ }
      }
      console.log('[auto-credentials] Layer 1 — no contracts found, falling through to Layer 2');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 2: assetId-filtered paginated search in deployment env
    // Passing ?assetId= to API Manager narrows the results to only instances
    // of that Exchange asset, removing false positives from name matching.
    // ─────────────────────────────────────────────────────────────────────────
    if (assetId) {
      console.log(`[auto-credentials] Layer 2 — assetId-filtered search: "${assetId}"`);
      const apis = await fetchAllApisForEnv(searchOrgId, envId, assetId);
      const matched = apis.length > 0 ? apis : []; // all returned are for this asset
      if (matched.length > 0) {
        const { allCandidates, matchInfo } = await collectCandidates(searchOrgId, envId, matched);
        if (allCandidates.length > 0) {
          return sendResult(res, allCandidates, matchInfo, matched, 2);
        }
      }
      console.log('[auto-credentials] Layer 2 — no contracts found, falling through to Layer 3');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 3: Paginated fuzzy name search — deployment env only
    // Fetches ALL instances (no 200-cap) and fuzzy-matches the app name.
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`[auto-credentials] Layer 3 — paginated fuzzy search in env ${envId}`);
    {
      const apis = await fetchAllApisForEnv(searchOrgId, envId);
      const matched = fuzzyMatch(apis);
      console.log(`[auto-credentials] Layer 3 — ${apis.length} instances, ${matched.length} match(es)`);
      if (matched.length > 0) {
        const { allCandidates, matchInfo } = await collectCandidates(searchOrgId, envId, matched);
        if (allCandidates.length > 0) {
          return sendResult(res, allCandidates, matchInfo, matched, 3);
        }
      }
    }

    // All layers exhausted — no match found
    console.log(`[auto-credentials] All layers exhausted — no API Manager instance found for "${appName}"`);
    return res.json({
      found: false,
      candidates: [],
      matchInfo: [],
      matchedApis: [],
      resolvedLayer: null,
      message: 'No matching API Manager instance found. Ensure api.id is stored in CPS non-secure props (*.api.id) or the API Manager instanceLabel matches the app name.',
    });

  } catch (error) {
    console.error('[auto-credentials] Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to resolve credentials from API Manager',
      found: false,
      candidates: [],
      matchInfo: [],
    });
  }
});

module.exports = router;
