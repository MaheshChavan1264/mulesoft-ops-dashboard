const logger = require('./logger');

/**
 * Parses an HTTP `Retry-After` header value into a millisecond delay.
 * Anypoint (and HTTP generally) allows either a plain integer number of
 * seconds, or an HTTP-date — handle both instead of assuming the simpler
 * numeric form is the only one that'll ever show up.
 *
 * @param {string|undefined} headerValue
 * @returns {number|null}  ms to wait, or null if absent/unparseable
 */
function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000);
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

/**
 * Retries an Anypoint API call that fails with HTTP 429 (rate limited) or a
 * transient 502/503/504, using exponential backoff with jitter — honoring
 * the server's own `Retry-After` header when present instead of guessing.
 *
 * Deliberately scoped to ONLY these statuses (plus a short allowlist of
 * transient network error codes) — a real 401/403/404/500 should fail fast
 * and surface to the caller, not get silently retried into a longer delay.
 *
 * Each retry's own backoff doubles the per-worker "think time" inside a
 * bounded-concurrency pool (see utils/concurrencyPool.js) — since a worker
 * can't pull its next item until the current one resolves, this naturally
 * throttles the whole fan-out under sustained rate-limiting instead of
 * requiring a separate, more complex adaptive-concurrency mechanism.
 *
 * @param {() => Promise<any>} fn          the Anypoint call to attempt
 * @param {object} [opts]
 * @param {number} [opts.retries=3]        max retry attempts after the first try
 * @param {number} [opts.baseDelayMs=500]  base delay before the backoff multiplier
 * @param {number} [opts.maxDelayMs=8000]  cap on any single computed delay
 * @param {string} [opts.label]            short tag for log lines (e.g. app name)
 * @returns {Promise<any>}
 */
async function withRetry(fn, opts = {}) {
  const { retries = 3, baseDelayMs = 500, maxDelayMs = 8000, label } = opts;
  const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
  const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED']);

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      const code = err.code;
      const isRetryable = RETRYABLE_STATUSES.has(status) || RETRYABLE_CODES.has(code);
      if (!isRetryable || attempt >= retries) throw err;

      const retryAfterMs = status === 429 ? parseRetryAfterMs(err.response?.headers?.['retry-after']) : null;
      // Exponential backoff with +/-30% jitter — jitter avoids every worker
      // in the pool waking back up at the exact same instant and
      // re-triggering the same burst that caused the 429 in the first place.
      const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitteredMs = backoffMs * (0.7 + Math.random() * 0.6);
      const delayMs = Math.round(retryAfterMs ?? jitteredMs);

      attempt += 1;
      logger.warn(
        `[withRetry] ${label || 'request'} got ${status || code} — retry ${attempt}/${retries} after ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { withRetry, parseRetryAfterMs };
