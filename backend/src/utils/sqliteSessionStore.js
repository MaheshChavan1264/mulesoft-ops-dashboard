const { Store } = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

class SQLiteSessionStore extends Store {
  constructor(options = {}) {
    super();
    const dir = options.dir || '.';
    const file = options.db || 'sessions.db';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.ttl = options.ttl || DEFAULT_TTL_MS;
    this.db = new DatabaseSync(path.join(dir, file));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      )
    `);

    // Wipe every existing session as soon as the table exists — before this
    // store is handed to express-session, so no request can race it. Used
    // so a deliberate stop+start of the server forces everyone to log back
    // in again, while the table still protects against mid-run crashes
    // (the table persists during the process's lifetime, this only clears
    // it once, right at startup).
    if (options.clearOnStart) {
      try {
        this.db.exec('DELETE FROM sessions');
        const cleared = this.db.prepare('SELECT changes() AS c').get()?.c ?? 0;
        logger.info({ clearedSessions: cleared }, '[SessionStore] Cleared all sessions on startup');
      } catch (err) {
        logger.error({ err }, '[SessionStore] Failed to clear sessions on startup');
      }
    }

    this._pruneTimer = setInterval(() => this._prune(), options.cleanupInterval || PRUNE_INTERVAL_MS);
    if (this._pruneTimer.unref) this._pruneTimer.unref();
  }

  _prune() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
    } catch (err) {
      logger.error({ err }, '[SessionStore] prune error');
    }
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expired < Date.now()) {
        return this.destroy(sid, () => callback(null, null));
      }
      return callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, session, callback) {
    try {
      const expired = session.cookie && session.cookie.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + this.ttl;

      // Merge-on-write for `cpsCreds` — closes a lost-update race. Each
      // Express request loads the whole session via get() at request start,
      // mutates its own in-memory copy, and (since this is the only place
      // express-session persists it) calls set() with that copy once the
      // response finishes. Several CPS features POST credentials for many
      // apps in parallel (bulk export, GlobalSearchPage fan-out, bulk ping,
      // etc.) against the SAME session cookie, so two requests' get() calls
      // can both load the session before either has written anything back —
      // whichever request's set() lands last would normally overwrite the
      // other's newly-added cpsCreds entries wholesale, because the naive
      // blind-overwrite below has no idea what the other request wrote in
      // the meantime. To fix this without a global lock: right before
      // writing, re-read the row's CURRENT cpsCreds from the DB (reflecting
      // any sibling request that already saved) and union it with this
      // request's cpsCreds, letting this request's own keys win for any
      // overlap. cpsCreds is purely additive per key (setCred adds/replaces
      // one key), EXCEPT deleteCred, which removes a key — a plain union
      // would otherwise resurrect that key from the DB's copy, so
      // `_cpsCredsRemoved` (set by cpsCredStore.deleteCred) explicitly lists
      // keys this request intentionally deleted; those are stripped from
      // the merged result even if the DB's current copy still has them.
      if (session && session.cpsCreds) {
        try {
          const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ?').get(sid);
          const currentCpsCreds = row ? JSON.parse(row.sess)?.cpsCreds : null;
          if (currentCpsCreds) {
            const merged = { ...currentCpsCreds, ...session.cpsCreds };
            for (const removedKey of session._cpsCredsRemoved || []) delete merged[removedKey];
            session.cpsCreds = merged;
          }
        } catch { /* fall through to a plain overwrite if the merge itself fails */ }
      }
      // Transient marker only — never persisted (see cpsCredStore.deleteCred).
      delete session._cpsCredsRemoved;

      this.db.prepare(`
        INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired
      `).run(sid, JSON.stringify(session), expired);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, session, callback) {
    this.set(sid, session, callback);
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  all(callback) {
    try {
      const rows = this.db.prepare('SELECT sess FROM sessions WHERE expired >= ?').all(Date.now());
      callback(null, rows.map((r) => JSON.parse(r.sess)));
    } catch (err) {
      callback(err);
    }
  }

  length(callback) {
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expired >= ?').get(Date.now());
      callback(null, row.count);
    } catch (err) {
      callback(err);
    }
  }

  clear(callback) {
    try {
      this.db.exec('DELETE FROM sessions');
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }
}

module.exports = SQLiteSessionStore;
