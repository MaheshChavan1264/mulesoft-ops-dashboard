/**
 * getErrorMessage
 *
 * Normalizes the "pull a readable message out of an axios error" logic that
 * was hand-copied with slight drift (some sites skip the `.data?.message`
 * fallback, some skip the generic `.message` fallback) across ~17 call
 * sites — see FRONTEND_ARCHITECTURE_REVIEW.md finding "getErrorMessage()".
 *
 * Precedence: backend `error` field → backend `message` field →
 * the error object's own `.message` → the caller-supplied fallback.
 *
 * @param {*} err       the caught error (typically an axios error)
 * @param {string} [fallback]  message to use if nothing else is available
 * @returns {string}
 */
export function getErrorMessage(err, fallback = 'An unexpected error occurred.') {
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}
