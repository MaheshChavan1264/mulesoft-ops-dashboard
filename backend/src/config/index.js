/**
 * Centralised environment/config loader.
 *
 * Every `process.env.X` read used to happen ad hoc across server.js,
 * utils/anypointClient.js, routes/cps.js, etc., with `.env.example` only
 * documenting a subset of what's actually read. Loading and defaulting
 * everything once here makes the full set of knobs discoverable in one
 * file and testable without spinning up the real process.env.
 */
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

/** Parse a comma-separated env var into a trimmed, non-empty string array. */
function parseList(value, fallback) {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseIntEnv(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  nodeEnv: NODE_ENV,
  isProd,

  port: parseIntEnv(process.env.PORT, 5000),

  sessionSecret: process.env.SESSION_SECRET,
  sessionDbDir: process.env.SESSION_DB_DIR || './data',
  sessionMaxAgeMs: parseIntEnv(process.env.SESSION_MAX_AGE_MS, 24 * 60 * 60 * 1000),

  anypointUrl: process.env.ANYPOINT_PLATFORM_URL || 'https://anypoint.mulesoft.com',

  // CORS — previously hardcoded to localhost origins only, which silently
  // broke any real deployment. CORS_ORIGINS="https://a.com,https://b.com"
  corsOrigins: parseList(process.env.CORS_ORIGINS, ['http://localhost:5173', 'http://localhost:3000']),

  // CA bundle for CPS / ping / internal HTTPS calls — see utils/httpAgents.js
  cpsCaCertPath: process.env.CPS_CA_CERT_PATH || process.env.INTERNAL_CA_CERT_PATH || null,

  // Encryption key for CPS client secrets at rest — falls back to SESSION_SECRET
  // (see utils/secretCrypto.js) so this is optional, not required.
  cpsCredsEncKey: process.env.CPS_CREDS_ENC_KEY || null,

  rateLimit: {
    // Auth endpoints (login/token/connected-app) — brute-force protection
    authWindowMs: parseIntEnv(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    authMax: parseIntEnv(process.env.AUTH_RATE_LIMIT_MAX, 20),

    // General /api/* read/write traffic
    apiWindowMs: parseIntEnv(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    apiMax: parseIntEnv(process.env.API_RATE_LIMIT_MAX, 300),

    // /api/cps/search-user fans out many requests per call — needs a tighter cap
    searchUserWindowMs: parseIntEnv(process.env.SEARCH_USER_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    searchUserMax: parseIntEnv(process.env.SEARCH_USER_RATE_LIMIT_MAX, 10),

    // By default limiters only enforce in production (matches prior behaviour
    // for the auth limiter) — set to "true" to also enforce in dev/test.
    enforceOutsideProd: process.env.RATE_LIMIT_ENFORCE_DEV === 'true',
  },
};

module.exports = config;
