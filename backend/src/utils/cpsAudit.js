/**
 * Durable audit trail for CPS write/delete/auth-change operations.
 *
 * These routes mutate real production configuration (property values,
 * access-control lists, binaries) but previously only logged to
 * console.* — no durable record of who changed what, when, or whether it
 * succeeded. This writes one row per mutating CPS call to the
 * `cps_audit_log` table (see utils/db.js), mirroring the existing
 * `ping_history` persistence pattern.
 */
const db = require('./db');
const logger = require('./logger');

/**
 * Record one CPS write/delete/auth mutation attempt.
 *
 * @param {object} entry
 * @param {string} entry.sessionId
 * @param {string} [entry.username]
 * @param {string} entry.operation      e.g. 'WRITE', 'DELETE', 'AUTH_ADD', 'AUTH_REPLACE', 'BINARY_UPLOAD'
 * @param {string} [entry.cpsBaseUrl]
 * @param {string} [entry.projectKey]
 * @param {string} [entry.environment]
 * @param {string} [entry.propType]     'non-secure' | 'secure' | 'binaries'
 * @param {boolean} entry.success
 * @param {number} [entry.httpStatus]
 * @param {string|object} [entry.detail]  short human-readable detail (error message, counts, etc.)
 */
function logCpsAudit({
  sessionId,
  username,
  operation,
  cpsBaseUrl,
  projectKey,
  environment,
  propType,
  success,
  httpStatus,
  detail,
}) {
  const detailStr = detail && typeof detail === 'object' ? JSON.stringify(detail) : (detail || null);
  db.run(
    `INSERT INTO cps_audit_log (session_id, username, timestamp, operation, cps_base_url, project_key, environment, prop_type, success, http_status, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId || null,
      username || null,
      Date.now(),
      operation,
      cpsBaseUrl || null,
      projectKey || null,
      environment || null,
      propType || null,
      success ? 1 : 0,
      httpStatus || null,
      detailStr,
    ],
    (err) => { if (err) logger.error({ err }, '[cpsAudit] Failed to write audit row'); }
  );
}

module.exports = { logCpsAudit };
