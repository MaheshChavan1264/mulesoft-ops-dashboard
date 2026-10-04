/**
 * Request-tracing middleware.
 *
 * - Reads/generates an `x-request-id` correlation id for every request and
 *   echoes it back on the response headers.
 * - Runs the rest of the request inside an AsyncLocalStorage context (see
 *   utils/requestContext.js) so every downstream call — route handlers,
 *   service/helper functions, DB queries — can pick up the same requestId
 *   without it being threaded through every function signature. utils/logger.js
 *   reads this context automatically and stamps `requestId` onto every log line.
 * - Emits one structured completion log line per request on `res.on('finish')`
 *   with method, path, status code, response time, client IP and user-agent.
 *   Sensitive query parameters (token/secret) are redacted from the logged URL.
 */
const crypto = require('crypto');
const logger = require('../utils/logger');
const { requestContext } = require('../utils/requestContext');

const SENSITIVE_QUERY_PARAMS = ['token', 'secret'];

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
  req.requestId = requestId;
  req.log = logger.child({ requestId });

  const startedAt = process.hrtime.bigint();

  requestContext.run({ requestId }, () => {
    res.on('finish', () => {
      const responseTimeMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(
        {
          requestId,
          method: req.method,
          url: redactUrl(req.originalUrl || req.url),
          statusCode: res.statusCode,
          responseTimeMs: Math.round(responseTimeMs * 100) / 100,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        'HTTP request completed'
      );
    });

    next();
  });
}

module.exports = requestLogger;
module.exports.requestLogger = requestLogger;
module.exports.requestContext = requestContext;
