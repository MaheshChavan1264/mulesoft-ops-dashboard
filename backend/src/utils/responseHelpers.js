/**
 * Shared HTTP response helpers.
 *
 * Every route that proxies Anypoint Platform API calls uses the same catch-block
 * pattern.  Centralising it here ensures consistent error shapes across all
 * endpoints and makes the route handlers easier to read.
 */

/**
 * Pull the most specific human-readable message out of an Anypoint
 * Platform API error response.
 *
 * Anypoint's error bodies are not consistent across endpoints — some use a
 * top-level `.message`, some a top-level `.description` or `.error`, some
 * return the body as a plain string, and validation-style failures (e.g.
 * "contract is ACTIVE, must be revoked before deleting") are often nested
 * one level deeper under `.errors[0].message` / `.errors[0].description`
 * while the top-level `.message` is just a generic "Validation Failed" or
 * "Bad Request". Routes that only checked `.message` would silently drop
 * that real, actionable message and fall back to a generic string instead
 * — which is why some upstream errors never reach the frontend in a useful
 * form even though the backend logged the real reason.
 *
 * @param {Error & { response?: { data?: any, status?: number } }} error
 * @param {string} fallback  Used only if nothing usable is found anywhere.
 * @returns {string}
 */
const extractAnypointErrorMessage = (error, fallback) => {
  const data = error.response?.data;
  return (
    data?.message ||
    data?.description ||
    data?.error ||
    data?.errors?.[0]?.message ||
    data?.errors?.[0]?.description ||
    (typeof data === 'string' ? data : null) ||
    error.message ||
    fallback
  );
};

/**
 * Send a standardised error response for a failed Anypoint proxy call.
 *
 * Behaviour:
 *  - Uses the upstream HTTP status when available, otherwise 500.
 *  - Uses the upstream error message when available, otherwise `fallbackMessage`.
 *  - Writes a console.error line so the log always shows what failed.
 *
 * @param {import('express').Response} res
 * @param {Error & { response?: { status?: number, data?: any } }} error
 * @param {string} fallbackMessage  Human-readable fallback shown to the client.
 */
const sendProxyError = (res, error, fallbackMessage) => {
  const status = error.response?.status || 500;
  const message = extractAnypointErrorMessage(error, fallbackMessage);
  console.error(fallbackMessage + ':', error.response?.data || error.message);
  res.status(status).json({ error: message });
};

module.exports = { sendProxyError, extractAnypointErrorMessage };