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
 *   user-agent) only when a request is slow (> SLOW_REQUEST_MS) — detail
 *   that matters for diagnosing a problem shouldn't cost noise on every
 *   normal request.
 * - Sensitive query parameters (token/secret) are redacted from the logged URL.
 */
const crypto = require('crypto');
const logger = require('../utils/logger');

const SENSITIVE_QUERY_PARAMS = ['token', 'secret'];
const SLOW_REQUEST_MS = 1000;

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
    const url = redactUrl(req.originalUrl || req.url);
    const statusCode = res.statusCode;

    logger.info({ method, url, statusCode }, 'HTTP request completed');

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (durationMs > SLOW_REQUEST_MS) {
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
