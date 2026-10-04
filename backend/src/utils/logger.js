/**
 * Centralised logger — replaces ad hoc `console.log/warn/error` calls
 * scattered across every route file with hand-rolled tags (`[Ping]`,
 * `[CPS Write]`, `[auto-credentials]`, ...).
 *
 * Pino gives us log levels (so DEBUG-ish lines can be silenced in
 * production via LOG_LEVEL instead of being permanently commented out —
 * see the dead `//console.log(...)` lines this replaces), structured
 * fields (`logger.info({ orgId }, 'message')`), and child loggers scoped
 * per module (`logger.child({ module: 'cps' })`) so every line is
 * self-tagging without string concatenation.
 *
 * `pino-http` (see server.js) attaches a per-request child logger at
 * `req.log` with a request id, so call sites inside route handlers can
 * log with request correlation for free.
 */
const pino = require('pino');
const config = require('../config');

const logger = pino({
  level: process.env.LOG_LEVEL || (config.isProd ? 'info' : 'debug'),
  transport: config.isProd
    ? undefined
    : {
        target: 'pino/file',
        options: { destination: 1 }, // stdout, pretty-printing left to the terminal/dev tooling
      },
});

module.exports = logger;
