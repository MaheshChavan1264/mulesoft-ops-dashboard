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

  // 2b. Any url::clientId* entry stored by Strategy 2 (masked cpsClientId path)
  //     Mark as _fromFallback so /fetch can also retry on empty 200 responses
  const urlPrefixEntries = Object.entries(sessionCreds)
    .filter(([k, v]) => k.startsWith(`${normUrl}::`) && v?.clientId && v?.clientSecret);
  if (urlPrefixEntries.length > 0) {
    const [, c] = urlPrefixEntries[0];
    return { clientId: c.clientId, clientSecret: c.clientSecret, _fromFallback: true };
  }

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

  // Helper: make one CPS GET call with a specific credential pair
  const makeCpsCall = async (clientId, clientSecret, timeoutMs = 20000) => {
    return axios.get(fullUrl, {
      headers: { 'client_id': clientId, 'client_secret': clientSecret, 'Content-Type': 'application/json' },
      params,
      timeout: timeoutMs,
      validateStatus: () => true, // handle all statuses ourselves
    });
  };

  let response;
  try {
    console.log(`CPS primary call — clientId="${creds.clientId.slice(0,8)}…"`);
    response = await makeCpsCall(creds.clientId, creds.clientSecret);
    console.log(`CPS primary response — HTTP ${response.status} (clientId="${creds.clientId.slice(0,8)}…")`);

    // Helper: check if a CPS response indicates no project access.
    // Detects three patterns:
    //   1. Empty responses array or empty properties objects
    //   2. properties = "COULD NOT ACCESS" (string) — CPS explicit denial
    //   3. Top-level empty object/array
    const isNoAccessResponse = (r) => {
      const d = r.data;
      if (!d) return true;
      if (Array.isArray(d?.responses)) {
        if (d.responses.length === 0) return true;
        return d.responses.every(x => {
          if (!x.properties) return true;
          if (typeof x.properties === 'string') return true;  // "COULD NOT ACCESS"
          if (typeof x.properties === 'object') return Object.keys(x.properties).length === 0;
          return true;
        });
      }
      if (Array.isArray(d)) return d.length === 0;
      if (typeof d === 'object') return Object.keys(d).length === 0;
      return false;
    };

    // Retry conditions:
    //   1. HTTP 401 — wrong credential (server-level auth failure)
    //   2. HTTP 200 but empty response + credential came from step 2b fallback
    //      (credential has server access but not project-level access)
    const shouldRetry = response.status === 401 ||
      (response.status === 200 && creds._fromFallback && isNoAccessResponse(response));

    if (shouldRetry && response.status === 200) {
      console.log(`CPS 200 but no project access — credential "${creds.clientId.slice(0,8)}…" returned empty or "COULD NOT ACCESS"; trying other credentials`);
    }

    if (shouldRetry) {
      const sessionCreds = req.session.cpsCreds || {};
      const altEntries = Object.entries(sessionCreds)
        .filter(([k, v]) => k.startsWith(`${normaliseUrl(baseUrl)}::`) && v?.clientId && v?.clientId !== creds.clientId && v?.clientSecret);

      console.log(`CPS 401 — ${altEntries.length} alt credential(s) available for retry`);
      if (altEntries.length > 0) {
        const BATCH = 5;
        let found = false;
        for (let i = 0; i < altEntries.length && !found; i += BATCH) {
          const batch = altEntries.slice(i, i + BATCH);
          const batchNum = Math.floor(i / BATCH) + 1;
          const totalBatches = Math.ceil(altEntries.length / BATCH);
          console.log(`CPS retry batch ${batchNum}/${totalBatches} — testing clientIds: [${batch.map(([,c]) => c.clientId.slice(0,8)+'…').join(', ')}]`);
          const settled = await Promise.allSettled(
            batch.map(([, c]) => makeCpsCall(c.clientId, c.clientSecret, 5000).then(r => ({ cred: c, res: r })))
          );
          for (const s of settled) {
            if (s.status === 'rejected') {
              console.log(`CPS retry — clientId="${s.reason?.config?.headers?.client_id?.slice(0,8) || '?'}…" threw: ${s.reason?.code || s.reason?.message}`);
            } else {
              const { cred, res: r } = s.value;
              const noAccess = isNoAccessResponse(r);
              console.log(`CPS retry — clientId="${cred.clientId.slice(0,8)}…" → HTTP ${r.status}${r.status === 200 && noAccess ? ' (no project access)' : r.status === 200 ? ' ✅ has data' : ''}`);
              // Accept this credential if: not 401 AND not "no project access"
              if (r.status !== 401 && !(r.status === 200 && noAccess)) {
                response = r;
                req.session.cpsCreds[`${normaliseUrl(baseUrl)}::${bgOrgId}`] = { clientId: cred.clientId, clientSecret: cred.clientSecret };
                console.log(`CPS retry resolved ✅ — promoted clientId "${cred.clientId.slice(0,8)}…" as primary (batch ${batchNum}/${totalBatches})`);
                found = true;
                break;
              }
            }
          }
        }
        if (!found) {
          console.warn(`CPS retry ❌ — all ${altEntries.length} credentials returned 401 or empty data`);
        }
      } else {
        console.warn(`CPS 401 — no alt credentials available; CSV may not contain a valid credential for this server`);
      }
    }
  } catch (fetchErr) {
    const msg = fetchErr.code === 'ECONNABORTED' || fetchErr.code === 'ETIMEDOUT'
      ? `CPS request timed out after ${fetchErr.config?.timeout || 20000}ms`
      : fetchErr.message || 'CPS network error';
    console.error(`CPS fetch error for ${fullUrl}: [${fetchErr.code || 'ERR'}] ${msg}`);
    return res.status(504).json({ error: msg, attemptedUrl: `${fullUrl}?${queryStr}` });
  }

  try {
    if (response.status >= 400) {
      const errMsg = response.data?.message || response.data?.description || response.data?.error
        || (typeof response.data === 'string' ? response.data : null) || `HTTP ${response.status}`;
      console.error(`CPS error (${response.status}) ${fullUrl}?${queryStr}: ${errMsg}`);
      return res.status(response.status).json({ error: errMsg, attemptedUrl: `${fullUrl}?${queryStr}`, details: response.data });
    }

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

/* ── POST /api/cps/search-user ───────────────────────────────────────────────
   Fan-out CPS search: find all apps whose non-secure OR secure CPS properties
   contain a given username (value-match, case-insensitive).

   Body: {
     username: string,
     apps: [{
       appName, appId?, cpsBaseUrl, cpsKey, cpsEnv,
       deploymentType, envName, bgOrgId
     }]
   }

   Returns: {
     results: [{
       appName, appId, matchedProps: [{ key, value, source }]
     }],
     scanned: number,
     skipped: number   // apps with no CPS config
   }
*/
router.post('/search-user', authMiddleware, async (req, res) => {
  const { username, apps = [] } = req.body || {};
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (!Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'apps array is required' });
  }

  const searchTerm = username.trim().toLowerCase();
  const CONCURRENCY = 15;

  /** Flatten CPS response (all formats) into a flat {key:value} map */
  function flattenProps(data) {
    if (!data) return {};
    let flat = {};

    const propsArray =
      Array.isArray(data) ? data
      : Array.isArray(data?.responses) ? data.responses
      : Array.isArray(data?.properties) ? data.properties
      : null;

    if (propsArray) {
      propsArray.forEach(entry => {
        const inner = entry?.properties;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          Object.assign(flat, inner);
        } else if (Array.isArray(inner)) {
          inner.forEach(p => { if (p?.key != null) flat[String(p.key)] = p.value ?? p.val ?? ''; });
        } else if (entry && typeof entry === 'object' && !Array.isArray(entry) && !entry.key && !entry.environment) {
          Object.assign(flat, entry);
        }
      });
    } else if (data && typeof data === 'object') {
      const firstVal = Object.values(data)[0];
      if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
        flat = data[Object.keys(data)[0]] || firstVal;
      } else {
        flat = data;
      }
    }
    return flat;
  }

  /** Scan a flat props map for the search term in values */
  function scanProps(flat, source) {
    const hits = [];
    for (const [k, v] of Object.entries(flat)) {
      if (v != null && String(v).toLowerCase().includes(searchTerm)) {
        hits.push({ key: k, value: String(v), source });
      }
    }
    return hits;
  }

  /** Process one app — fetch non-secure + optionally secure, return matched props */
  async function processApp(appEntry) {
    const { appName, appId, cpsBaseUrl, cpsKey, cpsEnv, deploymentType, envName, bgOrgId } = appEntry;
    if (!cpsBaseUrl || !cpsKey) return null; // no CPS config

    const envType = detectEnvType(cpsBaseUrl, cpsEnv, envName);
    const chType = detectChType(deploymentType || '');
    const creds = getCredentials(req, cpsBaseUrl, bgOrgId, envType, chType);
    if (!creds) return null; // no credentials — skip silently

    const cleanBase = normaliseUrl(cpsBaseUrl);
    const params = { environment: cpsEnv, keys: cpsKey };

    let matchedProps = [];

    // ── Non-secure fetch ──────────────────────────────────────────────────
    try {
      const nsUrl = `${cleanBase}/api/v2/properties/non-secure`;
      console.log(`[search-user] NS ${nsUrl} keys=${cpsKey} env=${cpsEnv} app=${appName}`);
      const nsRes = await axios.get(nsUrl, {
        headers: { client_id: creds.clientId, client_secret: creds.clientSecret, 'Content-Type': 'application/json' },
        params,
        timeout: 15000,
      });
      const nsFlat = flattenProps(nsRes.data);
      matchedProps = matchedProps.concat(scanProps(nsFlat, 'non-secure'));

      // ── Secure fetch (only if cps.secure.properties key exists) ──────────
      const secureKeys = nsFlat['cps.secure.properties'] || '';
      if (secureKeys) {
        try {
          const sUrl = `${cleanBase}/api/v2/properties/secure`;
          console.log(`[search-user] SEC ${sUrl} keys=${secureKeys} env=${cpsEnv} app=${appName}`);
          const sRes = await axios.get(sUrl, {
            headers: { client_id: creds.clientId, client_secret: creds.clientSecret, 'Content-Type': 'application/json' },
            params: { environment: cpsEnv, keys: secureKeys },
            timeout: 15000,
          });
          const sFlat = flattenProps(sRes.data);
          matchedProps = matchedProps.concat(scanProps(sFlat, 'secure'));
        } catch { /* secure fetch failed — continue with non-secure results */ }
      }
    } catch { return null; }

    if (matchedProps.length === 0) return null;
    return { appName, appId: appId || appName, matchedProps };
  }

  // ── Concurrency-limited fan-out ──────────────────────────────────────────
  const results = [];
  let skipped = 0;
  let scanned = 0;

  for (let i = 0; i < apps.length; i += CONCURRENCY) {
    const batch = apps.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(a => processApp(a)));
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        if (outcome.value === null) {
          skipped++;
        } else {
          scanned++;
          results.push(outcome.value);
        }
      } else {
        skipped++;
      }
    }
  }

  console.log(`[search-user] "${username}" — scanned ${scanned}, matched ${results.length}, skipped ${skipped}`);
  res.json({ results, scanned: scanned + results.length, skipped });
});

module.exports = router;
