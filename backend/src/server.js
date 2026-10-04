const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const requestLogger = require('./middleware/requestLogger');

// ── Session secret validation ─────────────────────────────────────────────────
// Fail fast in production if SESSION_SECRET is not set or is the known default.
// In development, emit a warning but continue.
const DEFAULT_SECRET = 'mulesoft-dashboard-secret';
if (!config.sessionSecret || config.sessionSecret === DEFAULT_SECRET) {
  if (config.isProd) {
    logger.fatal(
      'SESSION_SECRET must be set to a strong random string in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
    process.exit(1);
  } else {
    logger.warn(
      'SESSION_SECRET is not set or is the default. ' +
      'This is insecure — set SESSION_SECRET in .env before deploying to production.'
    );
  }
}

const fs = require('fs');
const authRoutes = require('./routes/auth');
const organizationsRoutes = require('./routes/organizations');
const environmentsRoutes = require('./routes/environments');
const applicationsRoutes = require('./routes/applications');
const apisRoutes = require('./routes/apis');
const exchangeRoutes = require('./routes/exchange');
const metricsRoutes = require('./routes/metrics');
const cpsRoutes = require('./routes/cps');
const healthRoutes = require('./routes/health');

// ── SQLite session store ──────────────────────────────────────────────────────
// Replaces the default MemoryStore (which loses all sessions on restart).
// Sessions are persisted to ./data/sessions.db — survives restarts, deploys,
// and OOM-induced process kills without logging out all users.
const SQLiteStore = require('./utils/sqliteSessionStore');
try { if (!fs.existsSync(config.sessionDbDir)) fs.mkdirSync(config.sessionDbDir, { recursive: true }); } catch {}

const app = express();

// Trust the first proxy hop when running behind nginx / a load balancer.
// Required for req.secure and cookie.secure to work correctly in production.
if (config.isProd) {
  app.set('trust proxy', 1);
}

// ── Security headers ──────────────────────────────────────────────────────────
// helmet sets a conservative baseline (X-Content-Type-Options, X-Frame-Options,
// HSTS when served over HTTPS, etc). CSP is disabled here because this server
// only serves a JSON API (the SPA is a separate static deploy) — a strict CSP
// on API responses adds no protection and risks breaking tooling that inspects
// headers; revisit if this process ever also serves the frontend bundle.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── Structured request logging ────────────────────────────────────────────────
// Assigns/propagates an x-request-id, runs the request inside an
// AsyncLocalStorage context so every log line downstream is correlated, and
// emits one structured completion log line per request/response.
app.use(requestLogger);

// Middleware
app.use(cors({
  // Previously hardcoded to localhost origins only, which silently broke any
  // real deployment. Configure real origins via CORS_ORIGINS in .env.
  origin: config.corsOrigins,
  credentials: true
}));
// gzip/brotli-capable response compression — the summary endpoint and CH2
// deployment detail (embedded `configuration` blob) are large repetitive
// JSON payloads that shrink substantially over the wire; negligible CPU
// cost compared to the Anypoint fan-out this backend is already waiting on.
app.use(compression());
// ── Conditional-GET support for read-only API responses ────────────────────
// Express already generates a weak ETag for every res.json() response by
// default (its built-in `etag: 'weak'` setting, never disabled here); the
// missing piece was a Cache-Control header telling the browser's HTTP cache
// it's allowed to store the response AND must revalidate with the server
// before reuse (`no-cache` means "always revalidate", not "don't cache").
// Combined with the ETag, a repeat GET for an unchanged resource comes back
// as a tiny 304 Not Modified instead of the full JSON body — pure bandwidth
// savings with zero staleness risk, since every request still round-trips
// to this server, which still enforces its own NodeCache/SWR freshness
// logic before deciding what to send. `private` keeps this out of
// shared/CDN caches since every response is scoped to the caller's
// session-authenticated Anypoint token.
app.use((req, res, next) => {
  if (req.method === 'GET') res.set('Cache-Control', 'private, no-cache');
  next();
});
// Default body size limit — small and safe for all general routes.
// CPS payloads (bulk property lists) can be large, so the limit is overridden
// specifically for /api/cps below before mounting its router.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: config.sessionDbDir }),
  secret: config.sessionSecret || DEFAULT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.isProd,   // true in production (HTTPS only), false in dev
    httpOnly: true,          // prevents JavaScript access to the cookie
    sameSite: 'lax',         // CSRF mitigation — blocks cross-site POST requests
    maxAge: config.sessionMaxAgeMs
  }
}));

// ── Rate limiting ────────────────────────────────────────────────────────────
// By default limiters only enforce in production (RATE_LIMIT_ENFORCE_DEV=true
// to also enforce locally) so they never get in the way during development.
const enforceLimiter = (req) => !config.isProd && !config.rateLimit.enforceOutsideProd;

// Auth endpoints — brute-force / credential-stuffing protection.
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
  skip: enforceLimiter,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/token-login', authLimiter);
app.use('/api/auth/connected-app-login', authLimiter);

// General /api/* traffic — a buggy frontend loop or malicious client should
// not be able to hammer this server (and every downstream Anypoint/CPS/
// internal host it fans requests out to) without limit.
const generalApiLimiter = rateLimit({
  windowMs: config.rateLimit.apiWindowMs,
  max: config.rateLimit.apiMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  skip: enforceLimiter,
});
app.use('/api', generalApiLimiter);

// /api/cps/search-user fans out up to CONCURRENCY (30) requests per call
// across every app passed in — needs a much tighter per-session cap than
// the general limiter above.
const searchUserLimiter = rateLimit({
  windowMs: config.rateLimit.searchUserWindowMs,
  max: config.rateLimit.searchUserMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many credential-search requests. Please wait before retrying.' },
  skip: enforceLimiter,
});
app.use('/api/cps/search-user', searchUserLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/environments', environmentsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/apis', apisRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/metrics', metricsRoutes);
// CPS routes receive a higher body-size limit — property payloads can be large
app.use('/api/cps', express.json({ limit: '50mb' }));
app.use('/api/cps', cpsRoutes);
app.use('/api/health', healthRoutes);

// Server health check
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Global Error Handler ────────────────────────────────────────────────────
// Must be registered AFTER all routes. Express identifies this as an
// error-handling middleware by the 4-parameter signature (err, req, res, next).
// Any route that calls next(err) or throws will land here instead of hanging.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.status || 500;
  (req.log || logger).error(
    {
      requestId: req.requestId,
      route: req.originalUrl || req.path,
      statusCode,
      stack: err.stack,
    },
    'Unhandled route error'
  );
  res.status(statusCode).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(config.port, () => {
  logger.info(`MuleSoft Dashboard Backend running on port ${config.port}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Stop accepting new connections and close the SQLite handles (app.db,
// sessions.db) cleanly on SIGTERM/SIGINT instead of relying on the process
// being killed mid-request — matters for rolling deploys / container restarts.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down gracefully`);

  const forceExitTimer = setTimeout(() => {
    logger.warn('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10000);
  if (forceExitTimer.unref) forceExitTimer.unref();

  server.close(() => {
    try {
      require('./utils/db').close();
    } catch (err) {
      logger.error({ err }, 'Error closing app.db during shutdown');
    }
    clearTimeout(forceExitTimer);
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
