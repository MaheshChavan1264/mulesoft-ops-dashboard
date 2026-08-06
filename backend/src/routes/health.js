const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');

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

module.exports = router;