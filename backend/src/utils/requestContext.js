/**
 * Shared AsyncLocalStorage context for request correlation.
 *
 * Lives in its own module (rather than inside logger.js or
 * middleware/requestLogger.js) so both can depend on it without creating a
 * require() cycle: the logger needs to read the active requestId, and the
 * request-tracing middleware needs to populate it and also logs through the
 * logger.
 */
const { AsyncLocalStorage } = require('async_hooks');

const requestContext = new AsyncLocalStorage();

/** Returns the requestId for the currently active request, or undefined. */
function getRequestId() {
  const store = requestContext.getStore();
  return store ? store.requestId : undefined;
}

module.exports = { requestContext, getRequestId };
