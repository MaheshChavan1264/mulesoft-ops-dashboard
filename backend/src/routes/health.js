const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Agent that tolerates self-signed / internal-CA certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const PING_PATHS = ['/api/v1/ping', '/api/v2/ping', '/api/ping', '/ping'];
const PING_TIMEOUT_MS = 5000;

function buildBaseUrl(targetType, appName, ch2IngressUrl) {
  const safe = (appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (targetType === 'CH2' && ch2IngressUrl) {
    // Anypoint sometimes returns a comma-separated list of URLs (internal + external).
    // Split, clean, then prefer the public-facing URL over the internal one.
    const candidates = ch2IngressUrl
      .split(',')
      .map(u => u.trim().replace(/\/+$/, ''))
      .filter(u => /^https?:\/\/.+/.test(u));

    if (candidates.length > 0) {
      // Prefer the external/public URL (doesn't contain "internalapi")
      const external = candidates.find(u => !u.includes('internalapi'));
      return external || candidates[0];
    }
  }

  // CH1, or CH2 without an ingress URL (bulk ping scenario) →
  // derive from app name using the standard API domain
  return `https://${safe}.api.sfdcbt.net`;
}

/**
 * POST /api/health/ping
 *
 * Body: {
 *   targetType:    'CH1' | 'CH2',
 *   appName:       string,
 *   ch2IngressUrl: string    (CH2 only — public ingress URL)
 *   clientId:      string    (optional — sent as client_id header)
 *   clientSecret:  string    (optional — sent as client_secret header)
 *   transactionId: string    (optional — sent as x-transaction-id, defaults to 'smokeTest')
 * }
 */
router.post('/ping', async (req, res) => {
  const {
    targetType = 'CH1',
    appName,
    ch2IngressUrl,
    clientId,
    clientSecret,
    transactionId = 'smokeTest',
  } = req.body || {};

  if (!appName) {
    return res.status(400).json({ error: 'appName is required' });
  }

  const base = buildBaseUrl(targetType, appName, ch2IngressUrl);
  // base is always non-null now (falls back to derived domain)

  // Build outbound headers — log them so we can verify what's being sent
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
    const url = `${base}${path}`;
    const t0 = Date.now();

    try {
      const response = await axios.get(url, {
        timeout: PING_TIMEOUT_MS,
        validateStatus: () => true,
        headers: outboundHeaders,
        maxRedirects: 5,
        httpsAgent,   // tolerate internal / self-signed CA certs
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

      // Detect Mule "No listener for endpoint" — endpoint path doesn't exist on this app,
      // so skip to the next path rather than treating it as a success.
      const payloadStr = payload
        ? typeof payload === 'string' ? payload : JSON.stringify(payload)
        : '';
      const isNoListener =
        payloadStr.toLowerCase().includes('no listener for endpoint') ||
        payloadStr.toLowerCase().includes('no flow') ||
        payloadStr.toLowerCase().includes('resource not found') ||
        (httpStatus === 404 && payloadStr.toLowerCase().includes('not found'));

      if (httpStatus < 500 && !isNoListener) {
        const status =
          httpStatus >= 200 && httpStatus < 300 ? 'SUCCESS' :
          httpStatus >= 400 && httpStatus < 500 ? 'PARTIAL' : 'FAILED';

        return res.json({
          status,
          activeEndpoint: url,
          responseTimeMs,
          httpStatus,
          payload,
          attempts,
        });
      }

      // 5xx or "No listener" — continue to next path
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

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalize an API/app name for fuzzy matching:
 *   - lowercase
 *   - strip version suffixes (-v1, -v2, -v1.0, v1 …)
 *   - replace hyphens, underscores, dots with a single space
 *   - collapse multiple spaces
 */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[-_.]v\d+(\.\d+)*$/i, '')   // trailing -v1 / _v2 / .v1.0
    .replace(/\bv\d+(\.\d+)*$/i, '')       // trailing v1 / v2.0
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

// ─── POST /api/health/auto-credentials ──────────────────────────────────────
/**
 * Given an app name + org/env, searches API Manager for a matching API
 * instance and returns the clientIds from its APPROVED contracts.
 * The frontend then performs a local lookup against the in-memory credential
 * map to find the matching clientSecret — the secret never reaches this server.
 *
 * Body: { orgId, envId, appName }
 * Response: {
 *   found: boolean,
 *   candidates: string[],          ← clientIds of approved contracts
 *   matchInfo: [{                   ← metadata for each candidate
 *     clientId, apiInstanceName, apiInstanceId, contractApp
 *   }],
 *   matchedApis: [{ id, label }]   ← API Manager instances that matched
 * }
 */
router.post('/auto-credentials', authMiddleware, async (req, res) => {
  const { orgId, envId, appName, apiMgrOrgId } = req.body || {};

  if (!orgId || !envId || !appName) {
    return res.status(400).json({
      error: 'orgId, envId, and appName are required',
      found: false,
      candidates: [],
    });
  }

  try {
    const client = createClient(req.anypointToken);

    let apis = [];
    let resolvedEnvId = envId;
    // searchOrgId: use the apiMgrOrgId override if provided, else same BG as deployment
    const searchOrgId = (apiMgrOrgId && apiMgrOrgId !== orgId) ? apiMgrOrgId : orgId;

    /**
     * Try fetching API Manager instances for a given org+env.
     * Returns [] on any error.
     */
    async function fetchApisForEnv(oId, eId) {
      try {
        const r = await client.get(
          `/apimanager/api/v1/organizations/${oId}/environments/${eId}/apis`,
          { params: { limit: 200 } }
        );
        const raw = r.data?.apis || r.data?.data || r.data || [];
        return Array.isArray(raw) ? raw : [];
      } catch { return []; }
    }

    // 1a. Try the deployment env first (fast path — covers most cases)
    apis = await fetchApisForEnv(searchOrgId, envId);
    resolvedEnvId = envId;

    // 1b. If no APIs found in the deployment env, search ALL other environments
    //     in the same org. This handles the common pattern where the app is
    //     deployed in env X but API Manager instances are registered in env Y
    //     within the same Business Group.
    if (apis.length === 0) {
      console.log(`[auto-credentials] No APIs in deployment env — scanning all envs in org ${searchOrgId}…`);
      try {
        const envsRes = await client.get(`/accounts/api/organizations/${searchOrgId}/environments`);
        const envList = envsRes.data?.data || envsRes.data?.environments || envsRes.data || [];

        for (const env of Array.isArray(envList) ? envList : []) {
          if (env.id === envId) continue; // already tried
          const envApis = await fetchApisForEnv(searchOrgId, env.id);
          if (envApis.length > 0) {
            const hasMatch = envApis.some(a =>
              [a.instanceLabel, a.asset?.exchangeAssetName, a.asset?.assetId, a.asset?.name]
                .filter(Boolean).some(c => isMatch(appName, c))
            );
            if (hasMatch) {
              apis = envApis;
              resolvedEnvId = env.id;
              console.log(`[auto-credentials] ✅ Match found in env "${env.name}" (${env.id})`);
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[auto-credentials] Could not list org environments:', e.message);
      }
    }

    // 2. Find instances whose label/assetId fuzzy-matches the app name
    const matchedApis = apis.filter(api => {
      const candidates = [
        api.instanceLabel,
        api.asset?.exchangeAssetName,
        api.asset?.assetId,
        api.asset?.name,
      ].filter(Boolean);
      return candidates.some(c => isMatch(appName, c));
    });

    console.log(`[auto-credentials] appName="${appName}" → ${matchedApis.length} API Manager match(es)`);

    if (matchedApis.length === 0) {
      return res.json({
        found: false,
        candidates: [],
        matchInfo: [],
        matchedApis: [],
        message: 'No matching API Manager instance found for this app name',
      });
    }

    // 3. Fetch contracts for each matched instance (up to 5)
    const allCandidates = [];
    const matchInfo = [];

    await Promise.allSettled(
      matchedApis.slice(0, 5).map(async (api) => {
        try {
          const contractsRes = await client.get(
            `/apimanager/api/v1/organizations/${searchOrgId}/environments/${resolvedEnvId}/apis/${api.id}/contracts`
          );

          const raw = contractsRes.data?.contracts || contractsRes.data || [];
          const contracts = Array.isArray(raw) ? raw : [];

          const approved = contracts.filter(
            c => (c.status || '').toUpperCase() === 'APPROVED'
          );

          const apiLabel =
            api.instanceLabel ||
            api.asset?.exchangeAssetName ||
            api.asset?.assetId ||
            String(api.id);

          for (const contract of approved) {
            // In Anypoint Platform, the OAuth client_id is stored as
            // application.coreServicesId in the contracts response.
            // Other field paths are kept as fallbacks for older API Manager versions.
            const clientId =
              contract.application?.coreServicesId ||   // PRIMARY — confirmed field name
              contract.application?.clientId ||
              contract.application?.credentials?.clientId ||
              contract.clientApplication?.coreServicesId ||
              contract.clientId ||
              contract.credentials?.clientId ||
              null;

            if (clientId && !allCandidates.includes(clientId)) {
              allCandidates.push(clientId);
              matchInfo.push({
                clientId,
                apiInstanceName: apiLabel,
                apiInstanceId: api.id,
                contractApp: contract.application?.name || 'Unknown',
              });
            }
          }
        } catch (err) {
          console.warn(
            `[auto-credentials] Could not fetch contracts for API ${api.id}:`,
            err.message
          );
        }
      })
    );

    console.log(`[auto-credentials] Found ${allCandidates.length} approved contract clientId(s) for "${appName}"`);

    return res.json({
      found: allCandidates.length > 0,
      candidates: allCandidates,
      matchInfo,
      matchedApis: matchedApis.slice(0, 5).map(a => ({
        id: a.id,
        label:
          a.instanceLabel ||
          a.asset?.exchangeAssetName ||
          a.asset?.assetId ||
          String(a.id),
      })),
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
