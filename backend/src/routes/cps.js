const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');

// ── Credential key format: {ch}_{env}  e.g.  ch1_prod, ch2_uat ─────────────
const CRED_KEYS = ['ch1_prod', 'ch2_prod', 'ch1_uat', 'ch2_uat'];

/**
 * Resolve credentials from (in priority order):
 *  1. Session overrides (set via UI modal)
 *  2. Environment variables (CPS_CH1_PROD_CLIENT_ID, etc.)
 */
function getCredentials(req, envType, chType) {
  const key = `${chType}_${envType}`;
  const sessionCreds = req.session.cpsCreds || {};

  if (sessionCreds[key]?.clientId && sessionCreds[key]?.clientSecret) {
    return { clientId: sessionCreds[key].clientId, clientSecret: sessionCreds[key].clientSecret };
  }

  const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (clientId && clientSecret) return { clientId, clientSecret };

  return null;
}

/**
 * Detect envType (prod | uat) from base URL + environment string + env name.
 * Falls back to 'prod' if ambiguous.
 */
function detectEnvType(baseUrl = '', environment = '', envName = '') {
  const s = `${baseUrl} ${environment} ${envName}`.toLowerCase();
  if (/\b(prod|pd)\b/.test(s)) return 'prod';
  if (/\b(uat|ut|stage|stg|uap|sandbox)\b/.test(s)) return 'uat';
  return 'prod';
}

/**
 * Normalise deploymentType → 'ch1' | 'ch2'
 */
function detectChType(deploymentType = '') {
  return deploymentType.includes('2') || deploymentType === 'ch2' ? 'ch2' : 'ch1';
}

/* ── GET /api/cps/credentials ──────────────────────────────────────────────
   Returns config status per credential key (no secrets exposed)
*/
router.get('/credentials', authMiddleware, (req, res) => {
  const sessionCreds = req.session.cpsCreds || {};
  const status = {};

  CRED_KEYS.forEach((key) => {
    const [chType, envType] = key.split('_');
    const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
    const fromEnv = !!(process.env[`${prefix}_CLIENT_ID`]);
    const fromSession = !!(sessionCreds[key]?.clientId);
    status[key] = {
      configured: fromEnv || fromSession,
      source: fromSession ? 'session' : fromEnv ? 'env' : 'none'
    };
  });

  res.json({ credentials: status });
});

/* ── POST /api/cps/credentials ─────────────────────────────────────────────
   Save credential overrides to session
   Body: { credentials: { ch1_prod: { clientId, clientSecret }, ... } }
*/
router.post('/credentials', authMiddleware, (req, res) => {
  const { credentials = {} } = req.body;
  if (!req.session.cpsCreds) req.session.cpsCreds = {};

  for (const [key, creds] of Object.entries(credentials)) {
    if (!CRED_KEYS.includes(key)) continue;
    req.session.cpsCreds[key] = {
      clientId: creds.clientId || '',
      clientSecret: creds.clientSecret || ''
    };
  }

  console.log('CPS credentials updated in session:', Object.keys(credentials));
  res.json({ success: true, updated: Object.keys(credentials) });
});

/* ── DELETE /api/cps/credentials/:key ──────────────────────────────────────
   Remove a specific session override (revert to env var)
*/
router.delete('/credentials/:key', authMiddleware, (req, res) => {
  const { key } = req.params;
  if (req.session.cpsCreds) {
    delete req.session.cpsCreds[key];
  }
  res.json({ success: true, cleared: key });
});

/* ── GET /api/cps/fetch ────────────────────────────────────────────────────
   Proxy a CPS API read request.
   Query params:
     baseUrl        — CPS base URL (from cps.configServerBaseUrl)
     type           — non-secure | secure | non-secure-all | secure-all | binaries | binaries-auth
     environment    — prod | uat | uap | dr  (passed to CPS as-is)
     keys           — comma-separated key(s)
     deploymentType — "CloudHub 1.0" | "CloudHub 2.0" (to pick correct credentials)
     envName        — Anypoint env name (used for envType detection fallback)
*/
router.get('/fetch', authMiddleware, async (req, res) => {
  const { baseUrl, type, environment, keys, deploymentType, envName } = req.query;

  if (!baseUrl || !type) {
    return res.status(400).json({ error: 'baseUrl and type are required' });
  }

  const envType = detectEnvType(baseUrl, environment, envName);
  const chType = detectChType(deploymentType);
  const creds = getCredentials(req, envType, chType);

  if (!creds) {
    return res.status(422).json({
      error: `CPS credentials not configured for ${chType}_${envType}`,
      credKey: `${chType}_${envType}`,
      needsConfig: true
    });
  }

  const pathMap = {
    'non-secure':      '/api/v2/properties/non-secure',
    'non-secure-all':  '/api/v2/properties/non-secure/all',
    'secure':          '/api/v2/properties/secure',
    'secure-all':      '/api/v2/properties/secure/all',
    'binaries':        '/api/v2/binaries/secure',
    'binaries-auth':   '/api/v2/binaries/secure/auth'
  };

  const cpsPath = pathMap[type];
  if (!cpsPath) {
    return res.status(400).json({ error: `Unknown CPS type: ${type}` });
  }

  const params = {};
  if (environment) params.environment = environment;
  if (keys) params.keys = keys;

  try {
    const response = await axios.get(`${baseUrl}${cpsPath}`, {
      headers: {
        'client_id': creds.clientId,
        'client_secret': creds.clientSecret,
        'Content-Type': 'application/json'
      },
      params,
      timeout: 20000
    });

    // For binaries, return metadata only (not raw binary content)
    const data = response.data;
    if (type === 'binaries') {
      const binaryList = Array.isArray(data) ? data : (data.properties || data.binaries || []);
      const metaOnly = binaryList.map((b) => ({
        key: b.key || b.name,
        environment: b.environment,
        size: b.size,
        contentType: b.contentType || b.type || 'application/octet-stream',
        lastModified: b.lastModified || b.updatedAt
      }));
      return res.json({ type, binaries: metaOnly, raw: Array.isArray(data) ? undefined : data });
    }

    res.json(data);
  } catch (error) {
    const status = error.response?.status || 500;
    const msg = error.response?.data?.message
      || error.response?.data?.description
      || error.message
      || 'CPS request failed';
    console.error(`CPS fetch [${type}] error (${status}):`, msg);
    res.status(status).json({ error: msg, details: error.response?.data });
  }
});

module.exports = router;