const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');

// ── Legacy key format: {ch}_{env}  e.g.  ch1_prod, ch2_uat ─────────────────
const LEGACY_KEYS = ['ch1_prod', 'ch2_prod', 'ch1_uat', 'ch2_uat'];

/**
 * Normalise a CPS base URL for use as a credential key:
 *  - strip trailing slash
 *  - strip /api/v2 suffix (the app may include it in cps.configServerBaseUrl)
 */
function normaliseUrl(url = '') {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
}

/**
 * Resolve credentials (priority order):
 *  1. Session override keyed by exact normalised base URL  ← new, per-server
 *  2. Session override keyed by legacy ch/env type        ← backwards-compat
 *  3. Env vars  CPS_CH1_PROD_CLIENT_ID / _SECRET          ← backwards-compat
 */
function getCredentials(req, rawBaseUrl, envType, chType) {
  const sessionCreds = req.session.cpsCreds || {};
  const normUrl = normaliseUrl(rawBaseUrl);

  // 1. URL-keyed session credential (new format)
  const byUrl = sessionCreds[normUrl];
  if (byUrl?.clientId && byUrl?.clientSecret) {
    return { clientId: byUrl.clientId, clientSecret: byUrl.clientSecret };
  }

  // 2. Legacy ch/env session credential
  const legacyKey = `${chType}_${envType}`;
  const byLegacy = sessionCreds[legacyKey];
  if (byLegacy?.clientId && byLegacy?.clientSecret) {
    return { clientId: byLegacy.clientId, clientSecret: byLegacy.clientSecret };
  }

  // 3. Env vars (legacy ch/env format)
  const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (clientId && clientSecret) return { clientId, clientSecret };

  return null;
}

/** Detect envType (prod | uat) from baseUrl + environment string + env name. */
function detectEnvType(baseUrl = '', environment = '', envName = '') {
  const s = `${baseUrl} ${environment} ${envName}`.toLowerCase();
  if (/\b(prod|pd)\b/.test(s)) return 'prod';
  if (/\b(uat|ut|stage|stg|uap|sandbox)\b/.test(s)) return 'uat';
  return 'prod';
}

/** Normalise deploymentType → 'ch1' | 'ch2' */
function detectChType(deploymentType = '') {
  return deploymentType.includes('2') || deploymentType === 'ch2' ? 'ch2' : 'ch1';
}

/* ── GET /api/cps/credentials ────────────────────────────────────────────────
   Returns credential status:
   - url-keyed entries (new format, stored in session)
   - legacy ch/env entries (session + env vars)
*/
router.get('/credentials', authMiddleware, (req, res) => {
  const sessionCreds = req.session.cpsCreds || {};

  // Legacy ch/env status
  const legacy = {};
  LEGACY_KEYS.forEach((key) => {
    const [chType, envType] = key.split('_');
    const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
    const fromEnv = !!(process.env[`${prefix}_CLIENT_ID`]);
    const fromSession = !!(sessionCreds[key]?.clientId);
    legacy[key] = { configured: fromEnv || fromSession, source: fromSession ? 'session' : fromEnv ? 'env' : 'none' };
  });

  // URL-keyed entries from session
  const byUrl = {};
  Object.entries(sessionCreds).forEach(([key, val]) => {
    if (!LEGACY_KEYS.includes(key) && val?.clientId) {
      byUrl[key] = { configured: true, source: 'session', maskedId: val.clientId.substring(0, 8) + '…' };
    }
  });

  res.json({ credentials: legacy, byUrl });
});

/* ── POST /api/cps/credentials ───────────────────────────────────────────────
   Save credential overrides to session.
   Supports both formats in one call:
   Body: {
     credentials: {
       "ch1_prod": { clientId, clientSecret },              ← legacy format
       "https://server.com": { clientId, clientSecret }    ← new URL-keyed format
     }
   }
*/
router.post('/credentials', authMiddleware, (req, res) => {
  const { credentials = {} } = req.body;
  if (!req.session.cpsCreds) req.session.cpsCreds = {};

  for (const [key, creds] of Object.entries(credentials)) {
    if (!creds.clientId && !creds.clientSecret) continue;
    // URL-keyed: normalise the key
    const storageKey = LEGACY_KEYS.includes(key) ? key : normaliseUrl(key);
    req.session.cpsCreds[storageKey] = {
      clientId: creds.clientId || '',
      clientSecret: creds.clientSecret || ''
    };
  }

  console.log('CPS credentials saved:', Object.keys(credentials));
  res.json({ success: true, saved: Object.keys(credentials) });
});

/* ── DELETE /api/cps/credentials/:key ────────────────────────────────────────
   Remove a session credential (key = legacy format OR URL-encoded base URL)
*/
router.delete('/credentials/:key', authMiddleware, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (req.session.cpsCreds) {
    delete req.session.cpsCreds[key];
    delete req.session.cpsCreds[normaliseUrl(key)];
  }
  res.json({ success: true, cleared: key });
});

/* ── GET /api/cps/fetch ──────────────────────────────────────────────────────
   Proxy a CPS API read request.
*/
router.get('/fetch', authMiddleware, async (req, res) => {
  const { baseUrl, type, environment, keys, deploymentType, envName } = req.query;

  if (!baseUrl || !type) {
    return res.status(400).json({ error: 'baseUrl and type are required' });
  }

  const envType = detectEnvType(baseUrl, environment, envName);
  const chType = detectChType(deploymentType);
  const creds = getCredentials(req, baseUrl, envType, chType);

  if (!creds) {
    return res.status(422).json({
      error: `CPS credentials not configured for ${normaliseUrl(baseUrl)}`,
      credKey: `${chType}_${envType}`,
      cpsUrl: normaliseUrl(baseUrl),
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
  console.log(`CPS → GET ${fullUrl}?${queryStr}  [creds: ${normaliseUrl(baseUrl)}]`);

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

    // For binaries: return metadata only (not raw file bytes)
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