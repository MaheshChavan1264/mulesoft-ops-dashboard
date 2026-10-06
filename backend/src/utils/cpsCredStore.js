/**
 * Session-backed CPS credential store.
 *
 * Centralises every read/write of `req.session.cpsCreds` so the encryption
 * of `clientSecret` (see utils/secretCrypto.js) happens in exactly one
 * place instead of at each of the dozen call sites in routes/cps.js that
 * used to read/write the raw session object directly — a session that is
 * itself persisted UNENCRYPTED to disk (sessions.db, see
 * utils/sqliteSessionStore.js). `clientId` is left as plaintext (already
 * surfaced, partially masked, to the UI — treated like a username rather
 * than a secret); `clientSecret` is encrypted at rest.
 */
const { encrypt, decrypt } = require('./secretCrypto');

/**
 * Store (or overwrite) a credential pair under `key`.
 *
 * @param {import('express-session').Session} session
 * @param {string} key
 * @param {{ clientId?: string, clientSecret?: string }} creds
 */
function setCred(session, key, { clientId, clientSecret } = {}) {
  if (!session.cpsCreds) session.cpsCreds = {};
  session.cpsCreds[key] = {
    clientId: clientId || '',
    clientSecret: encrypt(clientSecret || ''),
  };
}

/**
 * Fetch and decrypt a single credential pair by key.
 *
 * @param {import('express-session').Session} session
 * @param {string} key
 * @returns {{ clientId: string, clientSecret: string } | null}
 */
function getCred(session, key) {
  const raw = session.cpsCreds?.[key];
  if (!raw || !raw.clientId) return null;
  return { clientId: raw.clientId, clientSecret: decrypt(raw.clientSecret) };
}

/**
 * Fetch and decrypt every stored credential pair, keyed the same way they
 * were stored (legacy "ch1_prod", URL-only, or "url::bgOrgId").
 *
 * @param {import('express-session').Session} session
 * @returns {Record<string, { clientId: string, clientSecret: string }>}
 */
function getAllCreds(session) {
  const raw = session.cpsCreds || {};
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!val?.clientId) continue;
    out[key] = { clientId: val.clientId, clientSecret: decrypt(val.clientSecret) };
  }
  return out;
}

/**
 * Remove a stored credential pair.
 *
 * Also records the removed key in `session._cpsCredsRemoved` — a transient
 * marker (stripped before persistence, see sqliteSessionStore.js `set()`)
 * that tells the session store's merge-on-write logic this key was
 * deliberately deleted by THIS request, not merely untouched by it. Without
 * this, the store's additive merge (which exists to stop concurrent
 * credential POSTs from clobbering each other — see sqliteSessionStore.js)
 * would otherwise re-introduce a just-deleted key by merging it back in
 * from whatever the DB currently holds.
 *
 * @param {import('express-session').Session} session
 * @param {string} key
 */
function deleteCred(session, key) {
  if (session.cpsCreds) delete session.cpsCreds[key];
  if (!session._cpsCredsRemoved) session._cpsCredsRemoved = [];
  session._cpsCredsRemoved.push(key);
}

module.exports = { setCred, getCred, getAllCreds, deleteCred };
