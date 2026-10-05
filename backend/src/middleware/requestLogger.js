/**
 * Request-tracing middleware.
 *
 * - Echoes an `x-request-id` correlation id on the response headers (reads
 *   an incoming one if the client already sent one, generates a fresh one
 *   otherwise) — useful for a client/support ticket to reference a specific
 *   call, without that id cluttering every log line server-side.
 * - Emits one compact structured completion log line per request on
 *   `res.on('finish')` with just method, url and status code.
 * - Separately emits a WARN with the fuller picture (duration, client IP,
 *   user-agent) only when a request is slow — detail that matters for
 *   diagnosing a problem shouldn't cost noise on every normal request.
 * - Sensitive query parameters (token/secret) are redacted from the logged URL.
 *
 * ── Slow-request threshold ──────────────────────────────────────────────────
 * This backend is a proxy that fans out to the Anypoint/CPS APIs — several
 * endpoints (org-wide app summary, scheduler aggregation, Exchange search,
 * CPS bulk credential search) deliberately make many sequential/parallel
 * upstream calls per request and routinely take multiple seconds even when
 * working correctly. A single flat threshold either floods the logs with
 * "slow" warnings for those known-heavy routes, or has to be set so high it
 * misses real regressions on normally-fast endpoints. SLOW_PATH_OVERRIDES
 * below gives those specific routes a much higher bar; everything else uses
 * the general SLOW_REQUEST_MS default.
 */
const crypto = require('crypto');
const logger = require('../utils/logger');

const SENSITIVE_QUERY_PARAMS = ['token', 'secret'];

// General default — generous enough to avoid noise from normal network
// jitter / a single upstream Anypoint call, tight enough to still catch a
// genuinely hung simple route. Configurable since "slow" is relative to the
// deployment's own network distance to Anypoint.
const SLOW_REQUEST_MS = parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS, 10) || 3000;

// Known fan-out endpoints that legitimately make many upstream calls per
// request — matched against the request path (not query string) with
// `.includes()`, so these match regardless of the dynamic :orgId/:appId
// segments in between.
const SLOW_PATH_OVERRIDES = [
  { match: '/applications/summary/', ms: 15000 },
  { match: '/applications/schedulers/', ms: 20000 },
  { match: '/metrics/summary/', ms: 15000 },
  { match: '/exchange/org/', ms: 15000 },
  { match: '/exchange/ping-spec', ms: 15000 },
  { match: '/cps/search-user', ms: 30000 },
  { match: '/cps/fetch', ms: 10000 },
];

function slowThresholdFor(path) {
  const override = SLOW_PATH_OVERRIDES.find((o) => path.includes(o.match));
  return override ? override.ms : SLOW_REQUEST_MS;
}

/** Redacts sensitive query parameters from a path+query string before logging. */
function redactUrl(rawUrl) {
  const [pathPart, queryPart] = String(rawUrl || '').split('?');
  if (!queryPart) return pathPart;

  const params = new URLSearchParams(queryPart);
  for (const key of params.keys()) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_QUERY_PARAMS.some((sensitive) => lowerKey.includes(sensitive))) {
      params.set(key, '[REDACTED]');
    }
  }
  return `${pathPart}?${params.toString()}`;
}

function requestLogger(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const requestId = (typeof incomingId === 'string' && incomingId.trim()) || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const method = req.method;
    const path = req.path || req.originalUrl || req.url || '';
    const url = redactUrl(req.originalUrl || req.url);
    const statusCode = res.statusCode;

    //logger.info({ method, url, statusCode }, 'HTTP request completed');

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (durationMs > slowThresholdFor(path)) {
      logger.warn(
        {
          method,
          url,
          statusCode,
          durationMs: Math.round(durationMs),
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        'Slow HTTP request'
      );
    }
  });

  next();
}

module.exports = requestLogger;
module.exports.requestLogger = requestLogger;
