const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');

const LEGACY_KEYS = ['ch1_prod', 'ch2_prod', 'ch1_uat', 'ch2_uat'];

/** Strip trailing slash and /api/v2 suffix from a CPS base URL */
function normaliseUrl(url = '') {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
}

/** Build compound key: "{normalised-url}::{bgOrgId}" */
function urlBgKey(rawUrl, bgOrgId) {
  return `${normaliseUrl(rawUrl)}::${bgOrgId}`;
}

/**
 * Credential resolution — priority order:
 *  1. Session keyed by "{url}::{bgOrgId}"  ← per-server × per-BG
 *  2. Session keyed by "{url}" only         ← per-server fallback
 *  3. Session keyed by legacy "ch1_prod"    ← backwards-compat
 *  4. Env vars  CPS_CH1_PROD_CLIENT_ID/SECRET
 */
function getCredentials(req, rawBaseUrl, bgOrgId, envType, chType) {
  const sessionCreds = req.session.cpsCreds || {};
  const normUrl = normaliseUrl(rawBaseUrl);

  // 1. URL + BG composite key
  if (bgOrgId) {
    const key = `${normUrl}::${bgOrgId}`;
    const c = sessionCreds[key];
    if (c?.clientId && c?.clientSecret) return { clientId: c.clientId, clientSecret: c.clientSecret };
  }

  // 2. URL-only key (shared across BGs for that server)
  const byUrl = sessionCreds[normUrl];
  if (byUrl?.clientId && byUrl?.clientSecret) return { clientId: byUrl.clientId, clientSecret: byUrl.clientSecret };

  // 3. Legacy ch/env key
  const legacyKey = `${chType}_${envType}`;
  const byLegacy = sessionCreds[legacyKey];
  if (byLegacy?.clientId && byLegacy?.clientSecret) return { clientId: byLegacy.clientId, clientSecret: byLegacy.clientSecret };

  // 4. Env vars
  const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (clientId && clientSecret) return { clientId, clientSecret };

  return null;
}

function detectEnvType(baseUrl = '', environment = '', envName = '') {
  const s = `${baseUrl} ${environment} ${envName}`.toLowerCase();
  if (/\b(prod|pd)\b/.test(s)) return 'prod';
  if (/\b(uat|ut|stage|stg|uap|sandbox)\b/.test(s)) return 'uat';
  return 'prod';
}

function detectChType(deploymentType = '') {
  return deploymentType.includes('2') || deploymentType === 'ch2' ? 'ch2' : 'ch1';
}

/* ── GET /api/cps/credentials ────────────────────────────────────────────────
   Returns:
   - byUrlBg: URL×BG entries (new format)
   - byUrl: URL-only entries (per-server fallback)
   - legacy: ch/env entries + env-var status
*/
router.get('/credentials', authMiddleware, (req, res) => {
  const sessionCreds = req.session.cpsCreds || {};

  // Legacy
  const legacy = {};
  LEGACY_KEYS.forEach((key) => {
    const [chType, envType] = key.split('_');
    const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
    const fromEnv = !!(process.env[`${prefix}_CLIENT_ID`]);
    const fromSession = !!(sessionCreds[key]?.clientId);
    legacy[key] = { configured: fromEnv || fromSession, source: fromSession ? 'session' : fromEnv ? 'env' : 'none' };
  });

  // URL+BG and URL-only from session
  const byUrlBg = {};
  const byUrl = {};
  Object.entries(sessionCreds).forEach(([key, val]) => {
    if (LEGACY_KEYS.includes(key) || !val?.clientId) return;
    if (key.includes('::')) {
      byUrlBg[key] = { configured: true, source: 'session', maskedId: val.clientId.substring(0, 8) + '…' };
    } else {
      byUrl[key] = { configured: true, source: 'session', maskedId: val.clientId.substring(0, 8) + '…' };
    }
  });

  res.json({ credentials: legacy, byUrl, byUrlBg });
});

/* ── POST /api/cps/credentials ───────────────────────────────────────────────
   Accepts mixed key formats:
   - "ch1_prod"                                   → legacy
   - "https://server.com"                         → URL-only (shared across BGs)
   - "https://server.com::org-id-here"           → URL+BG (per-server × per-BG) ← primary
*/
router.post('/credentials', authMiddleware, (req, res) => {
  const { credentials = {} } = req.body;
  if (!req.session.cpsCreds) req.session.cpsCreds = {};

  for (const [key, creds] of Object.entries(credentials)) {
    if (!creds.clientId && !creds.clientSecret) continue;
    let storageKey;
    if (LEGACY_KEYS.includes(key)) {
      storageKey = key;
    } else if (key.includes('::')) {
      // URL::bgId — normalise just the URL part
      const [rawUrl, bgId] = key.split('::');
      storageKey = `${normaliseUrl(rawUrl)}::${bgId}`;
    } else {
      storageKey = normaliseUrl(key);
    }
    req.session.cpsCreds[storageKey] = { clientId: creds.clientId || '', clientSecret: creds.clientSecret || '' };
  }

  console.log('CPS credentials saved:', Object.keys(credentials));
  res.json({ success: true });
});

/* ── DELETE /api/cps/credentials/:key ───────────────────────────────────────
   key is URI-encoded; can be legacy, URL-only, or URL::bgId
*/
router.delete('/credentials/:key', authMiddleware, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (req.session.cpsCreds) {
    delete req.session.cpsCreds[key];
  }
  res.json({ success: true, cleared: key });
});

/* ── GET /api/cps/fetch ──────────────────────────────────────────────────────
   Additional query param: bgOrgId (the BG org ID — used for credential lookup)
*/
router.get('/fetch', authMiddleware, async (req, res) => {
  const { baseUrl, type, environment, keys, deploymentType, envName, bgOrgId } = req.query;

  if (!baseUrl || !type) return res.status(400).json({ error: 'baseUrl and type are required' });

  const envType = detectEnvType(baseUrl, environment, envName);
  const chType = detectChType(deploymentType);
  const creds = getCredentials(req, baseUrl, bgOrgId, envType, chType);

  if (!creds) {
    return res.status(422).json({
      error: `CPS credentials not configured for this server / BG combination`,
      credKey: `${chType}_${envType}`,
      cpsUrl: normaliseUrl(baseUrl),
      bgOrgId: bgOrgId || null,
      suggestedKey: bgOrgId ? `${normaliseUrl(baseUrl)}::${bgOrgId}` : normaliseUrl(baseUrl),
      needsConfig: true
    });
  }

  const pathMap = {
    'non-secure':     '/api/v2/properties/non-secure',
    'non-secure-all': '/api/v2/properties/non-secure/all',
    'secure':         '/api/v2/properties/secure',
    'secure-all':     '/api/v2/properties/secure/all',
    'binaries':       '/api/v2/binaries/secure',
    'binaries-auth':  '/api/v2/binaries/secure/auth'
  };

  const cpsPath = pathMap[type];
  if (!cpsPath) return res.status(400).json({ error: `Unknown CPS type: ${type}` });

  const params = {};
  if (environment) params.environment = environment;
  if (keys) params.keys = keys;

  const cleanBaseUrl = normaliseUrl(baseUrl);
  const fullUrl = `${cleanBaseUrl}${cpsPath}`;
  const queryStr = new URLSearchParams(params).toString();
  console.log(`CPS → GET ${fullUrl}?${queryStr}  [bg: ${bgOrgId || 'none'}]`);

  try {
    const response = await axios.get(fullUrl, {
      headers: {
        'client_id': creds.clientId,
        'client_secret': creds.clientSecret,
        'Content-Type': 'application/json'
      },
      params,
      timeout: 20000
    });

    const data = response.data;
    if (type === 'binaries') {
      const list = Array.isArray(data) ? data : (data.properties || data.binaries || []);
      return res.json({
        type,
        binaries: list.map((b) => ({
          key: b.key || b.name,
          environment: b.environment,
          size: b.size,
          contentType: b.contentType || b.type || 'application/octet-stream',
          lastModified: b.lastModified || b.updatedAt
        }))
      });
    }

    res.json(data);
  } catch (error) {
    const status = error.response?.status || 500;
    const msg = error.response?.data?.message
      || error.response?.data?.description
      || error.response?.data?.error
      || (typeof error.response?.data === 'string' ? error.response.data : null)
      || error.message
      || 'CPS request failed';
    console.error(`CPS error (${status}) ${fullUrl}?${queryStr}: ${msg}`);
    res.status(status).json({ error: msg, attemptedUrl: `${fullUrl}?${queryStr}`, details: error.response?.data });
  }
});

module.exports = router;
