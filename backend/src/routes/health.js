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

  // Build a human-readable summary of why all paths failed
  const errorTypes = [...new Set(attempts.map(a => a.error).filter(Boolean))];
  let summary = 'All ping paths unreachable';
  if (errorTypes.some(e => e.includes('ECONNREFUSED') || e.includes('Connection refused'))) {
    summary = 'Connection refused — app port is not accepting connections. The app may be stopped or crashed.';
  } else if (errorTypes.some(e => e.includes('Timeout') || e.includes('ETIMEDOUT') || e.includes('ECONNABORTED'))) {
    summary = `Request timed out after ${PING_TIMEOUT_MS / 1000}s — the app may be overloaded, or a firewall/VPC rule is blocking the connection.`;
  } else if (errorTypes.some(e => e.includes('DNS') || e.includes('ENOTFOUND') || e.includes('EAI_AGAIN'))) {
    summary = 'DNS resolution failed — the hostname could not be resolved. Check that the app URL is correct and accessible from this network.';
  } else if (errorTypes.some(e => e.includes('SSL') || e.includes('certificate') || e.includes('CERT_'))) {
    summary = 'SSL/TLS error — the app\'s certificate is expired, self-signed, or untrusted.';
  } else if (attempts.every(a => !a.error && a.httpStatus >= 500)) {
    summary = 'App returned 5xx (server error) on all ping paths — the app is reachable but erroring internally.';
  }

  return res.json({
    status: 'FAILED',
    activeEndpoint: null,
    responseTimeMs: null,
    httpStatus: null,
    payload: null,
    attempts,
    error: summary,
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

// ─── POST /api/health/auto-contract-creds ────────────────────────────────────
/**
 * Auto-resolve ping credentials by finding an existing Exchange application
 * owned by the logged-in user and using it to create (or reuse) a contract
 * on the target API instance.
 *
 * Flow:
 *   1. List the user's existing Exchange applications
 *   2. Find one that already has an APPROVED contract on this API instance → reuse it
 *   3. If none → pick the first user app and create a new contract
 *   4. Fetch clientId + clientSecret for that app
 *
 * Body: { orgId, envId, apiId }
 * Response: { clientId, clientSecret, contractStatus, appName, appId }
 */
router.post('/auto-contract-creds', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId, envType } = req.body || {};
  if (!orgId || !envId || !apiId) {
    return res.status(400).json({ error: 'orgId, envId, and apiId are required' });
  }

  try {
    const client = createClient(req.anypointToken);

    // 1. List user's Exchange applications (owned by current user / org)
    console.log(`[auto-contract-creds] Listing user apps for org ${orgId}`);
    let userApps = [];
    try {
      const appsRes = await client.get(
        `/exchange/api/v2/organizations/${orgId}/applications`,
        { params: { limit: 50 } }
      );
      userApps = Array.isArray(appsRes.data) ? appsRes.data : (appsRes.data?.applications || appsRes.data?.data || []);
    } catch (e) {
      console.warn('[auto-contract-creds] Could not list user apps:', e.message);
    }

    if (userApps.length === 0) {
      return res.status(404).json({
        error: 'No Exchange applications found for the current user. Create an application in Anypoint Exchange first.',
        contractStatus: 'no-apps'
      });
    }
    console.log(`[auto-contract-creds] Found ${userApps.length} user app(s)`);

    // Helper: fetch credentials for an app
    const fetchAppCreds = async (appId) => {
      try {
        // Try credentials endpoint first
        const r = await client.get(`/exchange/api/v2/organizations/${orgId}/applications/${appId}/credentials`);
        const cred = r.data;
        return {
          clientId: cred.clientId || cred.client_id || null,
          clientSecret: cred.clientSecret || cred.client_secret || null,
        };
      } catch {
        try {
          // Fallback: main app endpoint
          const r = await client.get(`/exchange/api/v2/organizations/${orgId}/applications/${appId}`);
          return {
            clientId: r.data.clientId || r.data.client_id || null,
            clientSecret: r.data.clientSecret || r.data.client_secret || null,
          };
        } catch { return { clientId: null, clientSecret: null }; }
      }
    };

    // 2. Fetch existing contracts on this API and check if any belong to a user app
    console.log(`[auto-contract-creds] Fetching existing contracts for API ${apiId}`);
    let existingContracts = [];
    try {
      const contractsRes = await client.get(
        `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`
      );
      existingContracts = contractsRes.data?.contracts || contractsRes.data || [];
    } catch (e) {
      console.warn('[auto-contract-creds] Could not fetch contracts:', e.message);
    }

    const userAppIds = new Set(userApps.map(a => String(a.id)));

    // Check for APPROVED contracts from any of the user's apps
    const existingApproved = existingContracts.find(c =>
      (c.status || '').toUpperCase() === 'APPROVED' &&
      userAppIds.has(String(c.application?.id || c.applicationId || ''))
    );

    if (existingApproved) {
      const appId = existingApproved.application?.id || existingApproved.applicationId;
      const appName = existingApproved.application?.name || 'User App';
      console.log(`[auto-contract-creds] Found existing approved contract for app ${appName} (${appId})`);
      const creds = await fetchAppCreds(appId);
      if (creds.clientId && creds.clientSecret) {
        return res.json({ ...creds, contractStatus: 'approved', appName, appId });
      }
    }

    // Check for PENDING contracts from any of the user's apps
    // IMPORTANT: Return the pending status WITHOUT creating a new contract.
    // This is the "Check Approval" flow — we should never create a duplicate.
    const existingPendingAny = existingContracts.find(c =>
      (c.status || '').toUpperCase() !== 'APPROVED' &&
      userAppIds.has(String(c.application?.id || c.applicationId || ''))
    );

    if (existingPendingAny) {
      const appId = existingPendingAny.application?.id || existingPendingAny.applicationId;
      const appName = existingPendingAny.application?.name || 'User App';
      const status = (existingPendingAny.status || 'PENDING').toLowerCase();
      console.log(`[auto-contract-creds] Found existing ${status.toUpperCase()} contract for app ${appName} (${appId}) — returning status only`);
      // Return credentials of the user's app even though contract is pending
      const creds = await fetchAppCreds(appId);
      return res.json({ clientId: creds.clientId, clientSecret: creds.clientSecret, contractStatus: status, appName, appId });
    }

    // 3. No existing contract at all — create one using the most appropriate user app.
    //
    // Selection priority (environment-aware):
    //   • Production env  → app whose name contains BOTH "prod"  AND "ping"
    //   • Non-prod env    → app whose name contains BOTH "uat"   AND "ping"
    //   • Fallback #1     → app whose name contains "ping" (any env)
    //   • Fallback #2     → first available app
    //
    const isProd = (envType || '').toLowerCase() === 'production';
    const nameLo = (a) => (a.name || '').toLowerCase();

    const targetApp =
      (isProd
        ? userApps.find(a => nameLo(a).includes('prod') && nameLo(a).includes('ping'))
        : userApps.find(a => nameLo(a).includes('uat')  && nameLo(a).includes('ping'))
      ) ||
      userApps.find(a => nameLo(a).includes('ping')) ||
      userApps[0];
    const targetAppId = targetApp.id;
    const targetAppName = targetApp.name || 'User App';
    console.log(`[auto-contract-creds] No existing contract found — creating for app "${targetAppName}" (${targetAppId})`);

    // Double-check this specific app doesn't already have a contract (safety net)
    const existingPending = existingContracts.find(c =>
      String(c.application?.id || c.applicationId || '') === String(targetAppId)
    );

    let contractStatus = 'pending';
    if (!existingPending) {
      // Fetch available SLA tiers
      let tierId = null;
      try {
        const tiersRes = await client.get(
          `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/tiers`
        );
        const tiers = tiersRes.data?.tiers || tiersRes.data || [];
        // Prefer tier with autoApprove, else take first
        const autoTier = tiers.find(t => t.autoApprove === true) || tiers[0];
        if (autoTier) tierId = autoTier.id;
      } catch { /* no tiers required */ }

      // Create the contract
      const contractBody = { applicationId: targetAppId };
      if (tierId) contractBody.requestedTierId = tierId;
      try {
        const createRes = await client.post(
          `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`,
          contractBody
        );
        const created = createRes.data;
        contractStatus = (created.status || 'pending').toLowerCase();
        console.log(`[auto-contract-creds] Contract created, status: ${contractStatus}`);
      } catch (createErr) {
        console.warn('[auto-contract-creds] Could not create contract:', createErr.response?.data || createErr.message);
        return res.status(createErr.response?.status || 500).json({
          error: createErr.response?.data?.message || 'Failed to create contract',
          contractStatus: 'error',
          appName: targetAppName,
          appId: targetAppId,
        });
      }
    } else {
      contractStatus = (existingPending.status || 'pending').toLowerCase();
      console.log(`[auto-contract-creds] Contract already exists with status: ${contractStatus}`);
    }

    // 4. Fetch credentials for the user app
    const creds = await fetchAppCreds(targetAppId);
    return res.json({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      contractStatus,
      appName: targetAppName,
      appId: targetAppId,
    });

  } catch (error) {
    console.error('[auto-contract-creds] Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to auto-resolve contract credentials',
      contractStatus: 'error',
    });
  }
});

module.exports = router;
