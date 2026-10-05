const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { fetchExchangeAppCreds } = require('../utils/exchangeHelpers');
const { sendProxyError } = require('../utils/responseHelpers');
const db = require('../utils/db');
const { sharedHttpAgent, sharedHttpsAgent } = require('../utils/httpAgents');
const logger = require('../utils/logger');
const {
  fetchAllApisForEnv,
  collectCandidates,
  fuzzyMatchApis,
  getOrgEnvs,
} = require('../utils/apiManagerHelpers');

// Shared keep-alive agent that tolerates self-signed / internal-CA certs —
// same instance used by every CPS call in routes/cps.js (see utils/httpAgents.js).
const httpsAgent = sharedHttpsAgent;

const PING_PATHS = [
  '/api/v1/ping',
  '/api/v2/ping',
  '/v1/ping',        // some PAPIs use /v1/ping without /api prefix
  '/v2/ping',        // some PAPIs use /v2/ping without /api prefix
  '/api/ping',
  '/ping',
];
// Per-attempt axios timeout. Was 10s — too tight for apps with a slow cold
// start / heavy downstream dependency chain behind their ping endpoint;
// legitimate healthy apps were being reported as timed out well before they
// actually responded. Raised to 45s so a single slow-but-working attempt
// has room to complete; PING_OVERALL_DEADLINE_MS below still bounds the
// TOTAL time across all phases/paths so a fully unreachable app doesn't
// take forever to fail.
const PING_TIMEOUT_MS = 45000; // 45 s per individual attempt
// Hard ceiling on TOTAL wall-clock time for one /ping call, regardless of how many
// base URLs / paths remain to try. Previously each of up to 18 candidate URLs
// (3 bases x 6 paths) was tried strictly sequentially with a 30s timeout each,
// so a fully unreachable app could take ~9 minutes to fail. Paths within a phase
// are now fired in parallel (see below) and this deadline aborts everything in
// flight once the budget is exhausted, so callers get a definitive answer fast.
//
// Raised from 30s to 60s alongside PING_TIMEOUT_MS above — some real apps
// take 30-45s+ to respond (cold start, slow downstream call inside their own
// ping flow), and the old 30s ceiling could abort an in-flight, eventually-
// successful first-phase attempt before it ever got the chance to finish.
// Still comfortably inside PingTestPanel.jsx's 95s client-side safety
// timeout — keep that margin if either value changes again.
const PING_OVERALL_DEADLINE_MS = 60000; // 60 s total

/**
 * Returns a domain-qualifier segment to insert between the env slug and
 * "internalapi.sfdcbt.net" for environment families that use a dedicated
 * sub-domain.
 *
 * EI-FI-FINANCIALS-*  →  "fin"
 *   e.g.  app.stage.fin.internalapi.sfdcbt.net
 *
 * Add more rules here as new environment families are discovered.
 */
function getDomainQualifier(normalizedEnvName) {
  // EI-FI-FINANCIALS-* — explicit "FINANCIALS" keyword only
  if (normalizedEnvName.includes('FINANCIALS')) return 'fin';
  return '';
}

/**
 * Build the base URL for a CH1 or CH2 ping.
 *
 * CH1 URL patterns:
 *   Production:     {appName}.internalapi.sfdcbt.net
 *   Non-production: {appName}.stage.internalapi.sfdcbt.net
 *
 * With domain qualifier (e.g. EI-FI-FINANCIALS-* → "fin"):
 *   Production:     {appName}.fin.internalapi.sfdcbt.net
 *   Non-production: {appName}.stage.fin.internalapi.sfdcbt.net
 *
 * isProd is true when envType === 'production' OR envName ends with
 * -PROD / _PROD (orgs whose prod envs are not typed as 'production').
 *
 * @param {string} targetType      'CH1' | 'CH2'
 * @param {string} appName         Application name
 * @param {string} ch2IngressUrl   CH2 ingress URL (may be comma-separated)
 * @param {string} envType         'production' | 'sandbox' | 'design'
 * @param {string} [envName]       Full environment display name e.g. "EI-FI-FINANCIALS-STAGING"
 */
function buildBaseUrl(targetType, appName, ch2IngressUrl, envType, envName) {
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

  // Determine production vs non-production for the CH1 subdomain
  const isProd =
    (envType || '').toLowerCase() === 'production' ||
    /(?:^|[-_ ])prod$/i.test((envName || '').trim());

  // Domain qualifier for special env families (e.g. EI-FI-FINANCIALS-* → "fin")
  const qualifier = getDomainQualifier((envName || '').toUpperCase());

  // CH1 URL structure:
  //   prod, no qualifier:     app.internalapi.sfdcbt.net
  //   prod, with qualifier:   app.fin.internalapi.sfdcbt.net
  //   non-prod, no qualifier: app.stage.internalapi.sfdcbt.net
  //   non-prod, with qual:    app.stage.fin.internalapi.sfdcbt.net
  if (qualifier) {
    return isProd
      ? `https://${safe}.${qualifier}.internalapi.sfdcbt.net`
      : `https://${safe}.stage.${qualifier}.internalapi.sfdcbt.net`;
  }

  return isProd
    ? `https://${safe}.internalapi.sfdcbt.net`
    : `https://${safe}.stage.internalapi.sfdcbt.net`;
}

// ─── POST /api/health/oauth2-token ───────────────────────────────────────────
/**
 * Server-side proxy for OAuth2 client_credentials token requests.
 * Avoids CORS issues when the token endpoint doesn't allow browser origins.
 *
 * Body: { tokenUrl, clientId, clientSecret, grantType?, scope? }
 * Response: { access_token, token_type, expires_in }
 */
router.post('/oauth2-token', authMiddleware, async (req, res) => {
  const { tokenUrl, clientId, clientSecret, grantType = 'client_credentials', scope } = req.body || {};
  if (!tokenUrl || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'tokenUrl, clientId, and clientSecret are required' });
  }
  try {
    const params = new URLSearchParams({ grant_type: grantType, client_id: clientId, client_secret: clientSecret });
    if (scope) params.append('scope', scope);
    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      httpAgent: sharedHttpAgent,
      httpsAgent,
      timeout: 15000,
      validateStatus: () => true,
    });
    if (response.status >= 400) {
      const errMsg = response.data?.error_description || response.data?.error || response.data?.message || `HTTP ${response.status}`;
      return res.status(response.status).json({ error: errMsg, raw: response.data });
    }
    const { access_token, token_type, expires_in } = response.data;
    if (!access_token) {
      return res.status(400).json({ error: 'Token endpoint did not return access_token', raw: response.data });
    }
    logger.debug(`[oauth2-token] Token fetched from ${tokenUrl} (expires_in=${expires_in})`);
    return res.json({ access_token, token_type: token_type || 'Bearer', expires_in });
  } catch (e) {
    logger.error({ err: e }, '[oauth2-token] Error');
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/health/ping
 */
router.post('/ping', authMiddleware, async (req, res) => {
  const {
    targetType = 'CH1',
    appName,
    ch2IngressUrl,
    clientId,
    clientSecret,
    bearerToken,        // JWT / OAuth2 Bearer token — sends Authorization: Bearer <token>
    transactionId = 'smokeTest',
    queryParams = '',   // optional: "key1=val1&key2=val2" appended to every ping URL
    envType = '',       // 'production' | 'sandbox' | 'design' — selects CH1 domain
    envName = '',       // full env display name e.g. "EI-FI-FINANCIALS-STAGING" — used for domain qualifier
    orgId,
    envId,
    credentialsLabel = '—',
  } = req.body || {};

  if (!appName) {
    return res.status(400).json({ error: 'appName is required' });
  }

  const base = buildBaseUrl(targetType, appName, ch2IngressUrl, envType, envName);

  // Determine prod/non-prod for fallback decisions
  const isProdPing =
    (envType || '').toLowerCase() === 'production' ||
    /(?:^|[-_ ])prod$/i.test((envName || '').trim());

  const qualifier = getDomainQualifier((envName || '').toUpperCase());

  // standardBase fallback strategy:
  //   1. Qualified envs (e.g. .fin.): always add plain internalapi.sfdcbt.net as final fallback
  //   2. Non-prod, no qualifier: add plain internalapi.sfdcbt.net as fallback
  //      (catches edge cases where the env is non-prod but the app lives on the prod domain)
  //   3. Prod, no qualifier: no fallback needed (already using the root domain)
  const standardBase = (() => {
    if (targetType === 'CH2') return null;
    if (qualifier) {
      // e.g. qualified → try both .stage.fin. (primary) and .internalapi. (final fallback)
      return `https://${(appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-')}.internalapi.sfdcbt.net`;
    }
    if (!isProdPing) {
      // Non-prod primary is .stage.internalapi. — fallback to plain .internalapi.
      return `https://${(appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-')}.internalapi.sfdcbt.net`;
    }
    return null;
  })();

  // HTTP variant of the qualified base (tried if HTTPS TLS fails on .fin. servers)
  const httpBase = qualifier ? base.replace(/^https:\/\//, 'http://') : null;

  if (qualifier) {
    logger.debug(`[Ping] Domain qualifier detected: "${qualifier}" (envName="${envName}") → primary base: ${base}`);
    if (httpBase)     logger.debug(`[Ping] HTTP fallback: ${httpBase} (tried if HTTPS .${qualifier}. TLS fails)`);
    if (standardBase) logger.debug(`[Ping] Standard fallback: ${standardBase} (tried if ALL .${qualifier}. paths fail)`);
  }

  const outboundHeaders = {
    Accept: 'application/json, */*',
    'Content-Type': 'application/json', // always sent — required by many Mule APIs
    'x-transaction-id': transactionId,
  };
  if (bearerToken) outboundHeaders['Authorization'] = `Bearer ${bearerToken}`;
  if (clientId) outboundHeaders['client_id'] = clientId;
  if (clientSecret) outboundHeaders['client_secret'] = clientSecret;

  logger.debug({ base }, '[Ping] Base URL');
  logger.debug({
    headers: {
      'x-transaction-id': transactionId,
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken.slice(0, 20)}… (len ${bearerToken.length})` } : {}),
      ...(clientId ? { client_id: `${clientId.slice(0, 6)}…` } : {}),
      ...(clientSecret ? { client_secret: `${clientSecret.slice(0, 4)}… (len ${clientSecret.length})` } : {}),
    },
  }, '[Ping] Headers being sent');

  // Build the ordered URL list:
  //   1. HTTPS qualified (.fin.) paths  — tried first (correct URL, prefer HTTPS)
  //   2. HTTP qualified (.fin.) paths   — tried if HTTPS fails (some .fin. servers use HTTP)
  //   3. HTTPS standard paths           — final fallback (no qualifier)
  //
  // Paths WITHIN a phase are fired in PARALLEL (Promise.all) rather than
  // sequentially: at most one path is expected to exist on a given app, so
  // the others typically resolve fast anyway (404 / no-listener), and this
  // caps a phase's duration at ~1 request instead of 6. Phases are still
  // tried in order so the "correct" base URL is always preferred when it
  // works. An overall deadline (PING_OVERALL_DEADLINE_MS) bounds the TOTAL
  // time regardless of how many phases/paths remain.
  const buildPhaseUrls = (b) => PING_PATHS.map(p => queryParams ? `${b}${p}?${queryParams}` : `${b}${p}`);
  const phases = [
    { label: 'https-qualified', urls: buildPhaseUrls(base) },
    { label: 'http-qualified', urls: httpBase ? buildPhaseUrls(httpBase) : [] },
    { label: 'standard-fallback', urls: standardBase ? buildPhaseUrls(standardBase) : [] },
  ].filter((p) => p.urls.length > 0);

  const attempts = [];
  const deadlineAt = Date.now() + PING_OVERALL_DEADLINE_MS;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), PING_OVERALL_DEADLINE_MS);

  /** Try a single ping URL. Always resolves — never throws. */
  const attemptOne = async (url) => {
    const t0 = Date.now();
    try {
      const response = await axios.get(url, {
        timeout: PING_TIMEOUT_MS,
        validateStatus: () => true,
        headers: outboundHeaders,
        maxRedirects: 5,
        httpAgent: sharedHttpAgent,
        httpsAgent,
        signal: controller.signal,
      });

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

      // Store payload per attempt so the frontend can show the response body for each path tried
      let attemptPayload = null;
      try {
        attemptPayload = typeof response.data === 'object' ? response.data : String(response.data).slice(0, 2000);
      } catch {}

      const payloadStr = payload
        ? typeof payload === 'string' ? payload : JSON.stringify(payload)
        : '';

      // Detect responses that mean "this path doesn't exist on the app" —
      // in these cases skip to the next path rather than stopping early.
      //
      // Rules (any of the following → skip):
      //   1. HTTP 404 — path not found on the Mule app
      //   2. Mule "No listener for endpoint" text
      //   3. "No flow" text (older Mule runtimes)
      //   4. "resource not found" text
      //   5. ENDPT_FAILURE text — Mule app-level 404 wrapped inside HTTP 200
      //   6. Structured app-level 404: { "error": [{ "code": "404", "status": "NOT_FOUND" }] }
      const isAppLevel404 = (() => {
        if (!payload || typeof payload !== 'object') return false;
        const errors = Array.isArray(payload.error) ? payload.error
          : (payload.error && typeof payload.error === 'object' ? [payload.error] : []);
        return errors.some(e =>
          String(e?.code) === '404' ||
          e?.status === 'NOT_FOUND' ||
          String(e?.description?.[0]?.message || '').toUpperCase().includes('ENDPT_FAILURE')
        );
      })();

      const isNoListener =
        httpStatus === 404 ||
        payloadStr.toLowerCase().includes('no listener for endpoint') ||
        payloadStr.toLowerCase().includes('no flow') ||
        payloadStr.toLowerCase().includes('resource not found') ||
        payloadStr.toUpperCase().includes('ENDPT_FAILURE') ||
        isAppLevel404;

      // ── 5xx with meaningful app body → app is reachable (PARTIAL) ────────
      // Some apps return 500 with a rich pingResponse/endpoints body when a
      // downstream service fails — the app itself IS reachable.
      const hasMeaningfulBody = payload && typeof payload === 'object' && (
        payload.pingResponse ||
        payload.endpoints ||
        payload.summary ||
        (Array.isArray(payload.errors) && payload.errors.length > 0)
      );

      logger.debug(`[Ping] ✓ ${url} → HTTP ${httpStatus} (${responseTimeMs}ms)${isAppLevel404 ? ' [app-level 404 — skipping]' : ''}`);

      let success = null;
      if (httpStatus < 500 && !isNoListener) {
        const status =
          httpStatus >= 200 && httpStatus < 300 ? 'SUCCESS' :
          httpStatus >= 400 && httpStatus < 500 ? 'PARTIAL' : 'FAILED';
        success = { status, activeEndpoint: url, responseTimeMs, httpStatus, payload };
      } else if (httpStatus >= 500 && !isNoListener && hasMeaningfulBody) {
        logger.debug(`[Ping] ${url} → ${httpStatus} with meaningful pingResponse body — marking PARTIAL (app reachable, downstream error)`);
        success = { status: 'PARTIAL', activeEndpoint: url, responseTimeMs, httpStatus, payload };
      }

      return { attempt: { url, httpStatus, responseTimeMs, payload: attemptPayload }, success };
    } catch (err) {
      const responseTimeMs = Date.now() - t0;
      let errorDetail = err.message;

      if (controller.signal.aborted) {
        errorDetail = `Overall ping deadline (${PING_OVERALL_DEADLINE_MS}ms) exceeded`;
      } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        errorDetail = `Timeout after ${PING_TIMEOUT_MS}ms`;
      } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        errorDetail = 'DNS resolution failed — host unreachable';
      } else if (err.code === 'ECONNREFUSED') {
        errorDetail = 'Connection refused';
      } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        errorDetail = 'SSL certificate error';
      }

      logger.debug(`[Ping] ✗ ${url} → ${errorDetail} (${responseTimeMs}ms)`);
      return { attempt: { url, error: errorDetail, responseTimeMs, payload: null }, success: null };
    }
  };

  let finalResult = null;

  for (const phase of phases) {
    if (Date.now() >= deadlineAt) {
      logger.debug(`[Ping] Overall deadline (${PING_OVERALL_DEADLINE_MS}ms) reached — stopping before phase "${phase.label}"`);
      break;
    }
    if (phase.label === 'http-qualified') {
      logger.debug(`[Ping] HTTPS .${qualifier}. paths failed — now trying HTTP .${qualifier}.: ${httpBase}`);
    } else if (phase.label === 'standard-fallback') {
      logger.debug(`[Ping] Qualified paths exhausted — now trying standard fallback: ${standardBase}`);
    }
    logger.debug(`[Ping] Phase "${phase.label}" — trying ${phase.urls.length} path(s) in parallel`);

    const settled = await Promise.all(phase.urls.map(attemptOne));
    for (const { attempt, success } of settled) {
      attempts.push(attempt);
      if (!finalResult && success) finalResult = success; // first success in path order wins
    }
    if (finalResult) break;
  }

  clearTimeout(deadlineTimer);

  if (finalResult) {
    const result = { ...finalResult, attempts };

    if (orgId && envId) {
      logger.debug(`[Ping DB] Saving ${finalResult.status} for ${appName} org=${orgId} env=${envId}`);
      db.run(
        `INSERT INTO ping_history (session_id, org_id, env_id, app_name, timestamp, status, response_time_ms, endpoint, payload, env_name, target_type, credentials, http_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.sessionID, orgId, envId, appName, Date.now(), finalResult.status, finalResult.responseTimeMs, finalResult.activeEndpoint, JSON.stringify(finalResult.payload), envName, targetType, credentialsLabel, finalResult.httpStatus || null],
        (err) => { if (err) logger.error({ err }, '[ping] Error saving history'); }
      );
    } else {
      logger.debug(`[Ping DB] Skipping save because orgId or envId missing. orgId=${orgId}, envId=${envId}`);
    }

    return res.json(result);
  }

  // Build a human-readable summary of why all paths failed
  const deadlineHit = Date.now() >= deadlineAt;
  const errorTypes = [...new Set(attempts.map(a => a.error).filter(Boolean))];
  let summary = 'All ping paths unreachable';
  if (deadlineHit) {
    summary = `Ping aborted after the overall ${PING_OVERALL_DEADLINE_MS / 1000}s time budget was exhausted trying all candidate paths.`;
  } else if (errorTypes.some(e => e.includes('ECONNREFUSED') || e.includes('Connection refused'))) {
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

  const result = {
    status: 'FAILED',
    activeEndpoint: null,
    responseTimeMs: null,
    httpStatus: null,
    payload: null,
    attempts,
    error: summary,
  };

  // Save failed ping to DB
  if (orgId && envId) {
    logger.debug(`[Ping DB] Saving FAILED for ${appName} org=${orgId} env=${envId}`);
    db.run(
      `INSERT INTO ping_history (session_id, org_id, env_id, app_name, timestamp, status, error, env_name, target_type, credentials) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.sessionID, orgId, envId, appName, Date.now(), 'FAILED', summary, envName, targetType, credentialsLabel],
      (err) => { if (err) logger.error({ err }, '[ping] Error saving history FAILED'); }
    );
  } else {
    logger.debug(`[Ping DB] Skipping save FAILED because orgId or envId missing. orgId=${orgId}, envId=${envId}`);
  }

  return res.json(result);
});

// ─── GET /api/health/ping/history ───────────────────────────────────────────
router.get('/ping/history', authMiddleware, (req, res) => {
  const { orgId, envId, appName } = req.query;
  
  let query = `SELECT * FROM ping_history WHERE session_id = ?`;
  let params = [req.sessionID];

  if (orgId && envId && appName) {
    query += ` AND org_id = ? AND env_id = ? AND app_name = ?`;
    params.push(orgId, envId, appName);
  }

  query += ` ORDER BY timestamp DESC LIMIT 100`; // Limit to 100 for global view

  db.all(query, params, (err, rows) => {
    if (err) {
      logger.error({ err }, '[ping/history] Error fetching history');
      return res.status(500).json({ error: 'Failed to fetch ping history' });
    }
    const history = rows.map(r => {
      let parsedPayload = null;
      if (r.payload) {
        try { parsedPayload = JSON.parse(r.payload); } catch { parsedPayload = r.payload; }
      }
      return {
        id: r.id,
        timestamp: r.timestamp,
        status: r.status,
        responseTimeMs: r.response_time_ms,
        endpoint: r.endpoint,
        payload: parsedPayload,
        error: r.error,
        appName: r.app_name, // include app_name for global view
        env_name: r.env_name,
        target_type: r.target_type,
        credentials: r.credentials,
        http_status: r.http_status
      };
    });
    return res.json(history);
  });
});

// ─── DELETE /api/health/ping/history ────────────────────────────────────────
router.delete('/ping/history', authMiddleware, (req, res) => {
  const { orgId, envId, appName } = req.query;

  let query = `DELETE FROM ping_history WHERE session_id = ?`;
  let params = [req.sessionID];

  if (orgId && envId && appName) {
    query += ` AND org_id = ? AND env_id = ? AND app_name = ?`;
    params.push(orgId, envId, appName);
  }

  db.run(query, params, (err) => {
    if (err) {
      logger.error({ err }, '[ping/history] Error deleting history');
      return res.status(500).json({ error: 'Failed to clear history' });
    }
    return res.json({ success: true });
  });
});

// ─── POST /api/health/auto-credentials ───────────────────────────────────────
/**
 * Foolproof multi-layer strategy to find the API Manager instance for a
 * deployed Mule app and return the clientIds from its APPROVED contracts.
 *
 * Layers 1-3 are implemented here (Layer 4 and 5 are the outer catch-all).
 *
 * Body: { orgId, envId, appName, apiId?, assetId?, apiMgrOrgId? }
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

    logger.debug(`[auto-credentials] Request — appName="${appName}" apiId=${apiId || 'null'} assetId=${assetId || 'null'} org=${searchOrgId} env=${envId}`);

    /** Build a result response and send it. */
    const sendResult = (allCandidates, matchInfo, matchedApis, layer) => {
      logger.info(`[auto-credentials] Layer ${layer} — ${allCandidates.length} clientId(s) for "${appName}"`);
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
    };

    // ── LAYER 1: Direct api.id lookup ─────────────────────────────────────
    if (apiId && apiId !== '0') {
      logger.debug(`[auto-credentials] Layer 1 — direct api.id="${apiId}"`);
      const envIds = [envId, ...(await getOrgEnvs(client, searchOrgId)).map(e => e.id).filter(id => id !== envId)];
      for (const eid of envIds) {
        try {
          const r = await client.get(
            `/apimanager/api/v1/organizations/${searchOrgId}/environments/${eid}/apis/${apiId}`
          );
          if (r.data?.id) {
            const { allCandidates, matchInfo } = await collectCandidates(client, searchOrgId, eid, [r.data]);
            if (allCandidates.length > 0) {
              return sendResult(allCandidates, matchInfo, [r.data], 1);
            }
          }
        } catch { /* try next env */ }
      }
      logger.debug('[auto-credentials] Layer 1 — no contracts found, falling through to Layer 2');
    }

    // ── LAYER 2: assetId-filtered paginated search ────────────────────────
    if (assetId) {
      logger.debug(`[auto-credentials] Layer 2 — assetId-filtered search: "${assetId}"`);
      const apis = await fetchAllApisForEnv(client, searchOrgId, envId, assetId);
      if (apis.length > 0) {
        const { allCandidates, matchInfo } = await collectCandidates(client, searchOrgId, envId, apis);
        if (allCandidates.length > 0) {
          return sendResult(allCandidates, matchInfo, apis, 2);
        }
      }
      logger.debug('[auto-credentials] Layer 2 — no contracts found, falling through to Layer 3');
    }

    // ── LAYER 3: Paginated fuzzy name search — deployment env only ────────
    logger.debug(`[auto-credentials] Layer 3 — paginated fuzzy search in env ${envId}`);
    {
      const apis = await fetchAllApisForEnv(client, searchOrgId, envId);
      const matched = fuzzyMatchApis(apis, appName);
      logger.debug(`[auto-credentials] Layer 3 — ${apis.length} instances, ${matched.length} match(es)`);
      if (matched.length > 0) {
        const { allCandidates, matchInfo } = await collectCandidates(client, searchOrgId, envId, matched);
        if (allCandidates.length > 0) {
          return sendResult(allCandidates, matchInfo, matched, 3);
        }
      }
    }

    // All layers exhausted
    logger.info(`[auto-credentials] All layers exhausted — no API Manager instance found for "${appName}"`);
    return res.json({
      found: false,
      candidates: [],
      matchInfo: [],
      matchedApis: [],
      resolvedLayer: null,
      message: 'No matching API Manager instance found. Ensure api.id is stored in CPS non-secure props (*.api.id) or the API Manager instanceLabel matches the app name.',
    });

  } catch (error) {
    sendProxyError(res, error, 'Failed to resolve credentials from API Manager');
  }
});

// ─── POST /api/health/auto-contract-creds ────────────────────────────────────
/**
 * Auto-resolve ping credentials by finding an existing Exchange application
 * owned by the logged-in user and using it to create (or reuse) a contract
 * on the target API instance.
 *
 * Body: { orgId, envId, apiId, envType? }
 * Response: { clientId, clientSecret, contractStatus, appName, appId }
 */
router.post('/auto-contract-creds', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId, envType, envName } = req.body || {};
  if (!orgId || !envId || !apiId) {
    return res.status(400).json({ error: 'orgId, envId, and apiId are required' });
  }

  try {
    const client = createClient(req.anypointToken);

    // 1. List user's Exchange applications
    logger.debug(`[auto-contract-creds] Listing user apps for org ${orgId}`);
    let userApps = [];
    try {
      const appsRes = await client.get(
        `/exchange/api/v2/organizations/${orgId}/applications`,
        { params: { limit: 50 } }
      );
      userApps = Array.isArray(appsRes.data) ? appsRes.data : (appsRes.data?.applications || appsRes.data?.data || []);
    } catch (e) {
      logger.warn({ err: e }, '[auto-contract-creds] Could not list user apps');
    }

    if (userApps.length === 0) {
      return res.status(404).json({
        error: 'No Exchange applications found for the current user. Create an application in Anypoint Exchange first.',
        contractStatus: 'no-apps'
      });
    }
    logger.debug(`[auto-contract-creds] Found ${userApps.length} user app(s)`);

    // 2. Fetch existing contracts on this API
    logger.debug(`[auto-contract-creds] Fetching existing contracts for API ${apiId}`);
    let existingContracts = [];
    try {
      const contractsRes = await client.get(
        `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`
      );
      existingContracts = contractsRes.data?.contracts || contractsRes.data || [];
    } catch (e) {
      logger.warn({ err: e }, '[auto-contract-creds] Could not fetch contracts');
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
      logger.debug(`[auto-contract-creds] Found existing approved contract for app ${appName} (${appId})`);
      const creds = await fetchExchangeAppCreds(client, orgId, appId);
      if (creds.clientId && creds.clientSecret) {
        return res.json({ ...creds, contractStatus: 'approved', appName, appId });
      }
    }

    // Check for PENDING contracts from any of the user's apps from exchange
    const existingPendingAny = existingContracts.find(c =>
      (c.status || '').toUpperCase() !== 'APPROVED' &&
      userAppIds.has(String(c.application?.id || c.applicationId || ''))
    );

    if (existingPendingAny) {
      const appId = existingPendingAny.application?.id || existingPendingAny.applicationId;
      const appName = existingPendingAny.application?.name || 'User App';
      const status = (existingPendingAny.status || 'PENDING').toLowerCase();
      logger.debug(`[auto-contract-creds] Found existing ${status.toUpperCase()} contract for app ${appName} (${appId}) — returning status only`);
      const creds = await fetchExchangeAppCreds(client, orgId, appId);
      return res.json({ clientId: creds.clientId, clientSecret: creds.clientSecret, contractStatus: status, appName, appId });
    }

    // 3. No existing contract — create one using the most appropriate user app
    // isProd: true when envType is explicitly 'production' OR when the environment
    // NAME ends with -PROD / _PROD (e.g. "MY-ORG-PROD", "COMPANY_PROD").
    // This handles orgs whose prod envs are not typed as 'production' in Anypoint.
    const isProd =
      (envType || '').toLowerCase() === 'production' ||
      /(?:^|[-_ ])prod$/i.test((envName || '').trim());
    logger.debug(`[auto-contract-creds] isProd=${isProd} (envType="${envType || ''}", envName="${envName || ''}")`);
    const nameLo = (a) => (a.name || '').toLowerCase();

    const targetApp =
      (isProd
        ? userApps.find(a => nameLo(a).includes('prod') && nameLo(a).includes('ping'))
        : userApps.find(a => nameLo(a).includes('stage') && nameLo(a).includes('ping'))
      ) ||
      userApps.find(a => nameLo(a).includes('ping')) ||
      userApps[0];
    const targetAppId = targetApp.id;
    const targetAppName = targetApp.name || 'User App';
    logger.debug(`[auto-contract-creds] No existing contract found — creating for app "${targetAppName}" (${targetAppId})`);

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
        const autoTier = tiers.find(t => t.autoApprove === true) || tiers[0];
        if (autoTier) tierId = autoTier.id;
      } catch { /* no tiers required */ }

      // Build candidate app list: env-type apps first, then ping-only, then rest
      const envTypeApps = userApps.filter(a => isProd
        ? (nameLo(a).includes('prod') && nameLo(a).includes('ping'))
        : (nameLo(a).includes('stage') && nameLo(a).includes('ping'))
      );
      const pingOnlyApps = userApps.filter(a =>
        nameLo(a).includes('ping') &&
        !(isProd
          ? (nameLo(a).includes('prod') && nameLo(a).includes('ping'))
          : (nameLo(a).includes('stage') && nameLo(a).includes('ping'))
        )
      );
      const otherApps2 = userApps.filter(a => !nameLo(a).includes('ping'));

      // Always include the full fallback pool — envType apps are tried first,
      // but if they all fail with IDP conflicts we fall through to ping-only
      // apps and then the rest. Previously the fallback was gated on
      // envTypeApps.length === 0, which meant IDP failures on envType apps
      // caused the contract creation to abort prematurely.
      const seen = new Set([String(targetApp.id)]);
      const candidateApps = [
        targetApp,
        ...envTypeApps.filter(a => !seen.has(String(a.id)) && seen.add(String(a.id))),
        ...pingOnlyApps.filter(a => !seen.has(String(a.id)) && seen.add(String(a.id))),
        ...otherApps2.filter(a => !seen.has(String(a.id)) && seen.add(String(a.id))),
      ];
      logger.debug(`[auto-contract-creds] Candidate apps (${isProd ? 'PROD' : 'stage'}): ${candidateApps.map(a => a.name).join(', ')}`);
      let created = false;
      let lastErr = null;

      for (const candidateApp of candidateApps) {
        const contractBody = { applicationId: candidateApp.id };
        if (tierId) contractBody.requestedTierId = tierId;
        try {
          const createRes = await client.post(
            `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`,
            contractBody
          );
          contractStatus = (createRes.data?.status || 'pending').toLowerCase();
          logger.debug(`[auto-contract-creds] Contract created with app "${candidateApp.name}" (${candidateApp.id}), status: ${contractStatus}`);
          Object.assign(targetApp, { id: candidateApp.id, name: candidateApp.name });
          created = true;
          break;
        } catch (createErr) {
          const msg = createErr.response?.data?.message || createErr.message || '';
          const isIdpConflict = msg.toLowerCase().includes('idp') || msg.toLowerCase().includes('identity');
          if (isIdpConflict) {
            logger.debug(`[auto-contract-creds] IDP conflict for app "${candidateApp.name}" — trying next app`);
            lastErr = createErr;
            continue;
          }
          logger.warn({ detail: createErr.response?.data || msg }, '[auto-contract-creds] Could not create contract');
          return res.status(createErr.response?.status || 500).json({
            error: msg || 'Failed to create contract',
            contractStatus: 'error',
            appName: candidateApp.name,
            appId: candidateApp.id,
          });
        }
      }

      if (!created) {
        const errMsg = lastErr?.response?.data?.message || lastErr?.message || 'All available apps have IDP conflicts with this API instance';
        logger.warn({ errMsg }, '[auto-contract-creds] Could not create contract with any app');
        return res.status(409).json({
          error: errMsg,
          contractStatus: 'error',
          hint: 'The user\'s Exchange applications use a different Identity Provider than this API instance. Manually create a contract in Anypoint Exchange, then use "Auto-fill from API Manager".',
        });
      }
    } else {
      contractStatus = (existingPending.status || 'pending').toLowerCase();
      logger.debug(`[auto-contract-creds] Contract already exists with status: ${contractStatus}`);
    }

    // 4. Fetch credentials for the user app
    const creds = await fetchExchangeAppCreds(client, orgId, targetAppId);
    return res.json({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      contractStatus,
      appName: targetAppName,
      appId: targetAppId,
    });

  } catch (error) {
    sendProxyError(res, error, 'Failed to auto-resolve contract credentials');
  }
});

module.exports = router;
