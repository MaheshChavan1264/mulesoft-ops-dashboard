/**
 * Symmetric encryption helper for secrets that must be persisted (CPS
 * client secrets stored in the session, which itself is persisted
 * unencrypted to sessions.db via sqliteSessionStore.js).
 *
 * Uses AES-256-GCM. The key is derived from CPS_CREDS_ENC_KEY if set,
 * otherwise from SESSION_SECRET (already required/validated at boot by
 * server.js) so no additional mandatory configuration is introduced.
 *
 * Encrypted values are tagged with an `enc:` prefix so `decrypt()` can
 * recognise and pass through already-plaintext values unchanged — this
 * keeps existing sessions created before this change working without a
 * migration step (they simply get re-encrypted the next time they're
 * written back to the session).
 */
const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:';

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const secret = config.cpsCredsEncKey || config.sessionSecret || 'mulesoft-dashboard-secret';
  cachedKey = crypto.createHash('sha256').update(secret).digest(); // 32 bytes — fits aes-256
  return cachedKey;
}

/**
 * Encrypt a string value for storage. Returns null/empty values unchanged
 * (no point encrypting "no secret").
 *
 * @param {string} plainText
 * @returns {string}
 */
function encrypt(plainText) {
  if (plainText == null || plainText === '') return plainText;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a value previously produced by `encrypt()`. Values that don't
 * carry the `enc:` prefix are returned as-is (back-compat with sessions
 * written before encryption was introduced, or plain empty strings).
 * Never throws — returns an empty string if decryption fails so a corrupt/
 * stale entry degrades to "no credential" instead of crashing the request.
 *
 * @param {string} value
 * @returns {string}
 */
function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value || '';
  try {
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    logger.error({ err }, '[secretCrypto] Failed to decrypt stored value — treating as empty');
    return '';
  }
}

module.exports = { encrypt, decrypt };
