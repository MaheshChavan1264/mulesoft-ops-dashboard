/**
 * Centralised structured logger — winston-based.
 *
 * Replaces the previous pino logger with:
 *  - Colorized human-readable console output in development, JSON in
 *    production (so log shippers / log aggregators can parse it).
 *  - A daily-rotating `logs/error-%DATE%.log` file capturing error (and
 *    fatal) level records, independent of what's printed to the console.
 *  - Automatic redaction of sensitive fields (passwords, tokens, client
 *    secrets, ...) from every logged payload, recursively.
 *
 * Backwards-compatible call signatures: existing call sites across the
 * codebase were written against pino's calling convention
 * (`logger.error({ err }, 'message')`) as well as the plain winston
 * convention (`logger.error('message', { meta })`) and (`logger.error('message')`).
 * All three are supported transparently — see `normalizeArgs` below.
 */
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const config = require('../config');

// ── Custom levels ────────────────────────────────────────────────────────────
// Adds `fatal` (above `error`) to winston's default npm levels, matching the
// pino levels this logger previously exposed via server.js's `logger.fatal`.
const LEVELS = { fatal: 0, error: 1, warn: 2, info: 3, http: 4, debug: 5 };
const COLORS = { fatal: 'red bold', error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'blue' };
winston.addColors(COLORS);

// ── Redaction ────────────────────────────────────────────────────────────────
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'client_secret',
  'authorization',
  'client_id',
  'cpscredentials',
  'clientsecret',
]);
const REDACTED = '[REDACTED]';

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

/** Deep-clones `value`, redacting sensitive keys and flattening Errors so their stack survives JSON/console serialisation. */
function redactValue(value, seen) {
  if (value instanceof Error) {
    const plain = { name: value.name, message: value.message, stack: value.stack };
    for (const key of Object.keys(value)) plain[key] = value[key];
    return redactValue(plain, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(val, seen);
    }
    return out;
  }
  return value;
}

const redactFormat = winston.format((info) => {
  const { level, message, timestamp, ...meta } = info;
  const redactedMeta = redactValue(meta, new WeakSet());
  const result = { level, message, timestamp, ...redactedMeta };
  // Object.entries (used inside redactValue) only copies string keys, so the
  // internal LEVEL/MESSAGE symbols winston attaches to `info` (read by
  // colorize/json downstream) must be re-applied explicitly here.
  for (const sym of Object.getOwnPropertySymbols(info)) {
    result[sym] = info[sym];
  }
  return result;
});

// ── Output formats ───────────────────────────────────────────────────────────
// Dev line shape: `<level> <timestamp>: <message> <meta>` — level leads so
// severity is the first thing scanned when skimming a scrolling terminal,
// with the timestamp immediately after it rather than out in front.
const devFormat = winston.format.combine(
  redactFormat(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${level} ${timestamp}: ${message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  redactFormat(),
  winston.format.timestamp(), // ISO 8601
  winston.format.json()
);

// ── Transports ───────────────────────────────────────────────────────────────
const consoleTransport = new winston.transports.Console({
  // info/debug/http -> stdout, error/fatal -> stderr
  stderrLevels: ['error', 'fatal'],
});

const fileTransport = new winston.transports.DailyRotateFile({
  dirname: path.join(__dirname, '..', '..', 'logs'),
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error', // captures 'error' and 'fatal' (both <= 'error' severity)
  maxSize: '20m',
  maxFiles: '14d',
  zippedArchive: false,
});

const winstonLogger = winston.createLogger({
  levels: LEVELS,
  level: process.env.LOG_LEVEL || (config.isProd ? 'info' : 'debug'),
  format: config.isProd ? prodFormat : devFormat,
  transports: [consoleTransport, fileTransport],
  exitOnError: false,
});

// ── Pino-compatible call signature shim ─────────────────────────────────────
// Supports:
//   logger.info('message')
//   logger.info('message', { meta })
//   logger.info({ meta }, 'message')      <- pino-style, used across routes/
//   logger.error({ err }, 'message')      <- pino-style with an Error
function normalizeArgs(args) {
  const [first, second] = args;
  if (first && typeof first === 'object') {
    return { message: typeof second === 'string' ? second : '', meta: first };
  }
  const meta = second && typeof second === 'object' ? second : second !== undefined ? { extra: second } : {};
  return { message: first, meta };
}

function wrapLogger(target) {
  const wrapped = {};
  for (const level of Object.keys(LEVELS)) {
    wrapped[level] = (...args) => {
      const { message, meta } = normalizeArgs(args);
      target.log(level, message || '', meta);
    };
  }
  wrapped.child = (bindings = {}) => wrapLogger(target.child(bindings));
  wrapped.raw = target;
  return wrapped;
}

module.exports = wrapLogger(winstonLogger);
