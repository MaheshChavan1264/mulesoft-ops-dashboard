/**
 * Pure CPS (Configuration Property Server) helpers extracted from
 * routes/cps.js. These have no Express/axios/session coupling — they take
 * plain data in and return plain data out — which makes them unit-testable
 * without a running server, and removes the odd `router.xxx = fn` export
 * hack that used to be the only way anything outside cps.js could reach
 * them (nothing actually did; it was dead flexibility).
 */

const LEGACY_KEYS = ['ch1_prod', 'ch2_prod', 'ch1_uat', 'ch2_uat'];

/** Strip trailing slash and /api/v2 suffix from a CPS base URL. */
function normaliseUrl(url = '') {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
}

/** Build compound key: "{normalised-url}::{bgOrgId}" */
function urlBgKey(rawUrl, bgOrgId) {
  return `${normaliseUrl(rawUrl)}::${bgOrgId}`;
}

/** Detect 'prod' vs 'uat' from a CPS base URL / environment / env display name. */
function detectEnvType(baseUrl = '', environment = '', envName = '') {
  const s = `${baseUrl} ${environment} ${envName}`.toLowerCase();
  if (/\b(prod|pd)\b/.test(s)) return 'prod';
  // \bstage\b does NOT match "staging" — use stag(e|ing)? to cover both
  if (/\b(uat|ut|stag(e|ing)?|stg|uap|sandbox)\b/.test(s)) return 'uat';
  return 'prod';
}

/** Detect CloudHub generation ('ch1' | 'ch2') from a deployment-type string. */
function detectChType(deploymentType = '') {
  return deploymentType.includes('2') || deploymentType === 'ch2' ? 'ch2' : 'ch1';
}

/**
 * Credential resolution — priority order:
 *  1. sessionCreds keyed by "{url}::{bgOrgId}"  ← per-server × per-BG
 *  2. sessionCreds keyed by "{url}" only         ← per-server fallback
 *  3. sessionCreds keyed by legacy "ch1_prod"    ← backwards-compat
 *  4. Env vars  CPS_CH1_PROD_CLIENT_ID/SECRET  (via `envLookup`, defaults to process.env)
 *
 * @param {Record<string, {clientId:string, clientSecret:string}>} sessionCreds  decrypted session creds (see utils/cpsCredStore.js)
 * @param {string} rawBaseUrl
 * @param {string} [bgOrgId]
 * @param {string} envType   'prod' | 'uat'
 * @param {string} chType    'ch1' | 'ch2'
 * @param {(name: string) => string | undefined} [envLookup]  defaults to `process.env[name]`
 * @returns {{ clientId: string, clientSecret: string, _fromFallback?: boolean } | null}
 */
function resolveCredentials(sessionCreds, rawBaseUrl, bgOrgId, envType, chType, envLookup = (k) => process.env[k]) {
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
  const clientId = envLookup(`${prefix}_CLIENT_ID`);
  const clientSecret = envLookup(`${prefix}_CLIENT_SECRET`);
  if (clientId && clientSecret) return { clientId, clientSecret };

  return null;
}

/** Flatten a CPS properties response (all known shapes) into a flat {key: value} map. */
function flattenCpsProps(data) {
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

/**
 * Scan a flat props map for any of `searchTerms` in keys/values.
 *
 * @param {Record<string, any>} flat
 * @param {string} source  'non-secure' | 'secure' — tagged onto each hit
 * @param {{ searchTerms: string[], searchMode?: 'key'|'value', exactMatch?: boolean }} opts
 */
function scanCpsProps(flat, source, { searchTerms, searchMode = 'value', exactMatch = false }) {
  const hits = [];
  for (const [k, v] of Object.entries(flat)) {
    if (v != null) {
      const target = searchMode === 'key' ? String(k) : String(v);
      const matchFound = searchTerms.some(term =>
        exactMatch ? target.toLowerCase() === term : target.toLowerCase().includes(term)
      );
      if (matchFound) hits.push({ key: k, value: String(v), source });
    }
  }
  return hits;
}

/**
 * Find a related password property in the same namespace as matchedKey.
 *
 * Pass 1 (preferred): prefix-restricted match — same top-level namespace as
 *   the matched key (e.g., matchedKey="db.username" → looks for "db.*password*").
 *   Skips values that are themselves masked (all-asterisk placeholders).
 *
 * Pass 2 (fallback): no prefix restriction — returns the first non-masked
 *   password-like value found anywhere in props. Used when the secure group
 *   stores credentials under a different namespace (e.g., non-secure key uses
 *   "anypoint.mq.*" prefix but the secure group just has "password").
 */
function findCpsPassword(props, matchedKey) {
  const PWD_PATTERN = /password|passwd|\.secret$|_secret$|\.pwd$|_pwd$/i;
  const prefix = matchedKey.includes('.') ? matchedKey.split('.')[0] : '';

  // Pass 1: prefix-restricted, skip masked (***) values
  for (const [k, v] of Object.entries(props || {})) {
    if (!PWD_PATTERN.test(k)) continue;
    if (prefix && !k.startsWith(prefix)) continue;
    const val = v != null ? String(v) : '';
    if (val && !/^\*+$/.test(val)) return val; // real value found
  }

  // Pass 2: cross-namespace fallback — any password-like key with a real value
  if (prefix) {
    for (const [k, v] of Object.entries(props || {})) {
      if (!PWD_PATTERN.test(k)) continue;
      const val = v != null ? String(v) : '';
      if (val && !/^\*+$/.test(val)) return val; // cross-namespace real value
    }
  }

  return '';
}

/** Check if a non-secure CPS response contains no usable data or only access-denied entries. */
function isEmptyCpsResponse(data) {
  if (!data) return true;
  if (Array.isArray(data?.responses)) {
    if (data.responses.length === 0) return true;
    // "COULD NOT ACCESS" stored as a string → credential lacks project-level access
    if (data.responses.some(r => typeof r?.properties === 'string')) return true;
    return data.responses.every(r => !r?.properties ||
      (typeof r.properties === 'object' && Object.keys(r.properties).length === 0)
    );
  }
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') return Object.keys(data).length === 0;
  return true;
}

module.exports = {
  LEGACY_KEYS,
  normaliseUrl,
  urlBgKey,
  detectEnvType,
  detectChType,
  resolveCredentials,
  flattenCpsProps,
  scanCpsProps,
  findCpsPassword,
  isEmptyCpsResponse,
};
