import api from './api';
import { normaliseCpsUrl } from '../utils/cpsHelpers';

/**
 * cpsService.js
 *
 * Centralizes the "post CPS credentials, then fetch CPS properties" dance
 * that was independently re-implemented across ApplicationDetailPage's
 * CpsConfigTab, CpsComparisonPage, CpsManagerPage and GlobalSearchPage —
 * see FRONTEND_ARCHITECTURE_REVIEW.md §7 and the Top-10-Duplicate-Areas list
 * ("CPS URL-cleaning + fallback-request boilerplate").
 *
 * This module intentionally only unifies the parts that were byte-identical
 * (or near-identical) across call sites — URL normalization and the
 * "try the exact clientId, fall back to posting every CSV credential"
 * resolution strategy. The actual `/cps/fetch` shapes genuinely differ per
 * caller (CpsComparisonPage chains non-secure→secure/binaries by compare
 * type, CpsManagerPage defers the fetch to a separate call, CpsConfigTab
 * passes extra deploymentType/envName params, GlobalSearchPage batches
 * credentials across many apps) so those are left as thin, composable
 * wrappers rather than forced into one rigid function.
 */

/**
 * Build the `${normalisedBaseUrl}::${clientId}` credential map for every
 * credential currently loaded from the CSV import, and POST it to the
 * backend session. Fire-and-forget friendly — callers decide whether to
 * await it.
 *
 * @param {string} baseUrl           Raw (un-normalized) CPS base URL
 * @param {Array<{clientId, clientSecret}>} credentials
 * @returns {Promise<boolean>} true if at least one credential was posted
 */
export async function postAllCpsCredentials(baseUrl, credentials) {
  if (!baseUrl || !credentials?.length) return false;
  const normBase = normaliseCpsUrl(baseUrl);
  const credMap = {};
  for (const { clientId, clientSecret } of credentials) {
    credMap[`${normBase}::${clientId}`] = { clientId, clientSecret };
  }
  try {
    await api.post('/cps/credentials', { credentials: credMap });
    return true;
  } catch {
    return false;
  }
}

/**
 * POST a single clientId/secret pair under `${normalisedBaseUrl}::${scopeId}`
 * (where `scopeId` is usually the Business Group org ID — the slot the
 * backend's 401-retry logic treats as the "primary" credential for that URL).
 *
 * @returns {Promise<boolean>} true if the credential was posted successfully
 */
export async function postScopedCpsCredential(baseUrl, scopeId, clientId, clientSecret) {
  if (!baseUrl || !scopeId || !clientId || !clientSecret) return false;
  const normBase = normaliseCpsUrl(baseUrl);
  try {
    await api.post('/cps/credentials', {
      credentials: { [`${normBase}::${scopeId}`]: { clientId, clientSecret } },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve and post CPS credentials using the shared two-strategy approach
 * duplicated (byte-identical) in CpsComparisonPage.selectApp and
 * CpsManagerPage.selectApp:
 *   1. If the app declares its own `cpsClientId` (and it isn't masked as
 *      `****`) and that secret is in the loaded CSV, POST it scoped to
 *      `${normBase}::${scopeId}` — the "primary" slot for that org/app.
 *   2. Otherwise (or in addition), POST every CSV credential individually
 *      under `${normBase}::${clientId}` so the backend's retry loop can try
 *      each one and promote the correct one.
 *
 * @param {object} opts
 * @param {string} opts.cpsBaseUrl
 * @param {string} [opts.cpsClientId]   clientId extracted from ARM properties, if any
 * @param {string} opts.scopeId         Business Group org ID (or other scope key)
 * @param {boolean} opts.hasCredentials whether any CSV credentials are loaded
 * @param {(clientId: string) => string|undefined} opts.getSecret
 * @param {() => Array<{clientId, clientSecret}>} opts.getAllCredentials
 * @returns {Promise<boolean>} true if any credential was successfully posted
 */
export async function resolveAndPostCpsCredentials({
  cpsBaseUrl, cpsClientId, scopeId, hasCredentials, getSecret, getAllCredentials,
}) {
  if (!cpsBaseUrl || !hasCredentials) return false;

  const isMasked = (v) => !v || /^\*+$/.test(v.trim());

  let postedScoped = false;
  if (cpsClientId && !isMasked(cpsClientId)) {
    const secret = getSecret(cpsClientId);
    if (secret) {
      postedScoped = await postScopedCpsCredential(cpsBaseUrl, scopeId, cpsClientId, secret);
    }
  }

  // Always ALSO post every other CSV credential under its own `url::clientId`
  // slot — not just when the scoped post above was skipped/failed. The
  // backend's per-group secure-property retry (routes/cps.js) tries every
  // OTHER credential already in the session when a specific secure group
  // "COULD NOT ACCESS" with the primary one (different secure groups on the
  // same CPS server commonly require different credentials). If this
  // function stopped at the first successful post (as it used to), the
  // session only ever held ONE credential for that URL, so the backend had
  // nothing left to retry with — any secure group not covered by that one
  // credential would permanently fail to resolve, even though a working
  // credential for it was sitting right there in the loaded CSV the whole
  // time. See the Schedulers dashboard's "Resolve CPS Crons" / the
  // Infrastructure tab's "Get Cron Expressions" — this is why some
  // schedulers whose cron/timezone live in a secure property group never
  // resolved while others on the same app did.
  const allCreds = getAllCredentials();
  const postedAll = allCreds.length > 0 ? await postAllCpsCredentials(cpsBaseUrl, allCreds) : false;

  return postedScoped || postedAll;
}

/**
 * Thin wrapper around `GET /cps/fetch` — kept intentionally generic since
 * callers pass genuinely different param shapes (type, keys, environment,
 * bgOrgId, and occasionally deploymentType/envName). `baseUrl` is forwarded
 * exactly as given (NOT re-normalized here) since callers already pass the
 * same raw/normalized form they use for the credential POST, and silently
 * changing that could alter which cached session credential the backend
 * matches against.
 *
 * @param {object} params  Forwarded as-is to the `/cps/fetch` query params
 *   (baseUrl, type, keys, environment, bgOrgId, ...)
 * @returns {Promise<any>} raw axios response data
 */
export async function fetchCpsProperties(params) {
  const r = await api.get('/cps/fetch', { params });
  return r.data;
}

/**
 * Low-level POST /cps/credentials — pass the exact `{ credentials: {...} }`
 * payload through unchanged. Prefer `postScopedCpsCredential`/
 * `postAllCpsCredentials` for the two common shapes above; this exists for
 * call sites with bespoke key formats (e.g. a single `${url}::${bgId}`
 * placeholder entry) that don't fit either helper without risking a subtly
 * different key being posted.
 */
export function postCpsCredentialsRaw(payload) {
  return api.post('/cps/credentials', payload);
}

// ── Write / delete CPS properties ─────────────────────────────────────────

/** POST /cps/write — create or update non-secure/secure properties for a project. */
export function writeCpsProperties(payload) {
  return api.post('/cps/write', payload);
}

/** DELETE /cps/project — remove a CPS project (or a single secure group). */
export function deleteCpsProject(payload) {
  return api.delete('/cps/project', { data: payload });
}

// ── Binary assets ──────────────────────────────────────────────────────────

/** POST /cps/binary — upload a binary asset (keystore/truststore/cert/etc.). */
export function uploadCpsBinary(payload) {
  return api.post('/cps/binary', payload);
}

// ── Access control (allowed/read-only clientIds) ──────────────────────────

export function getCpsAuth(params) {
  return api.get('/cps/auth', { params });
}

export function postCpsAuth(payload) {
  return api.post('/cps/auth', payload);
}

// ── Session credential inspection (debugging/settings UI) ────────────────

/** GET /cps/credentials — list clientIds currently stored in the backend session. */
export function getCpsCredentials() {
  return api.get('/cps/credentials');
}

/** DELETE /cps/credentials/{urlKey} — forget a single stored session credential. */
export function deleteCpsCredential(urlKey) {
  return api.delete(`/cps/credentials/${urlKey}`);
}

/** POST /cps/credentials/test — validate a clientId/secret pair against a CPS server. */
export function testCpsCredential(payload) {
  return api.post('/cps/credentials/test', payload);
}

// ── Global Search backend fan-out ─────────────────────────────────────────

/** POST /cps/search-user — backend-side fan-out search across many apps' CPS properties. */
export function searchCpsUsers(payload, config) {
  return api.post('/cps/search-user', payload, config);
}
