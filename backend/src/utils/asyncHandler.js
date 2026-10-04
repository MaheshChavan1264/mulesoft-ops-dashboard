/**
 * Error-handling wrappers for Express route handlers.
 *
 * Two helpers live here because this codebase has two distinct repeated
 * shapes:
 *
 *  1. `asyncHandler(fn)` — generic: forwards any thrown/rejected error to
 *     `next(err)` (→ the global error handler in server.js) instead of
 *     becoming an unhandled rejection that hangs the request. Use this for
 *     handlers that need custom error shaping or don't proxy a single
 *     upstream call.
 *
 *  2. `proxyHandler(fallbackMessage, fn)` — specific: replaces the
 *     `try { ... } catch (error) { sendProxyError(res, error, '...'); }`
 *     block copy-pasted into 30+ route handlers across apis.js,
 *     applications.js, exchange.js, metrics.js, organizations.js and
 *     environments.js. Keeps the exact same status-code/message behaviour
 *     (via responseHelpers.sendProxyError) with one line per route instead
 *     of five.
 */
const { sendProxyError } = require('./responseHelpers');

/**
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<any>} fn
 * @returns {(req, res, next) => void}
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * @param {string} fallbackMessage  Human-readable fallback used when the
 *   upstream error carries no usable message (see extractAnypointErrorMessage).
 * @param {(req, res, next) => Promise<any>} fn
 * @returns {(req, res, next) => void}
 */
const proxyHandler = (fallbackMessage, fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    sendProxyError(res, error, fallbackMessage);
  }
};

module.exports = { asyncHandler, proxyHandler };
