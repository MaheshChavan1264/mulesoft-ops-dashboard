const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, 'app.db');

const sqlite = new DatabaseSync(dbPath);
logger.info('[DB] Connected to application database (app.db).');

const db = {
  run(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    params = params || [];
    try {
      const stmt = sqlite.prepare(sql);
      const info = stmt.run(...params);
      if (typeof callback === 'function') {
        callback.call({ lastID: info.lastInsertRowid, changes: info.changes }, null);
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback.call({}, err);
      } else {
        logger.error({ err }, '[DB] run error');
      }
    }
    return db;
  },

  get(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    params = params || [];
    try {
      const stmt = sqlite.prepare(sql);
      const row = stmt.get(...params);
      if (typeof callback === 'function') callback(null, row);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
    }
    return db;
  },

  all(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    params = params || [];
    try {
      const stmt = sqlite.prepare(sql);
      const rows = stmt.all(...params);
      if (typeof callback === 'function') callback(null, rows);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
    }
    return db;
  },

  exec(sql, callback) {
    try {
      sqlite.exec(sql);
      if (typeof callback === 'function') callback(null);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
      else logger.error({ err }, '[DB] exec error');
    }
    return db;
  },

  serialize(fn) {
    if (typeof fn === 'function') fn();
    return db;
  },

  close(callback) {
    try {
      sqlite.close();
      if (typeof callback === 'function') callback(null);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
    }
  }
};

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS ping_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      response_time_ms INTEGER,
      endpoint TEXT,
      payload TEXT,
      error TEXT,
      env_name TEXT,
      target_type TEXT,
      credentials TEXT,
      http_status INTEGER
    )
  `);

  const addColumnIfMissing = (column, type) => {
    try {
      sqlite.exec(`ALTER TABLE ping_history ADD COLUMN ${column} ${type}`);
    } catch (err) {
      // Column already exists - ignore (mirrors previous sqlite3 behavior of swallowing errors)
    }
  };
  addColumnIfMissing('env_name', 'TEXT');
  addColumnIfMissing('target_type', 'TEXT');
  addColumnIfMissing('credentials', 'TEXT');
  addColumnIfMissing('http_status', 'INTEGER');
  addColumnIfMissing('transaction_id', 'TEXT');

  db.run(`CREATE INDEX IF NOT EXISTS idx_ping_history_session_app ON ping_history(session_id, org_id, env_id, app_name)`);

  // ── CPS write/delete/auth-change audit trail ───────────────────────────
  // CPS write operations mutate real production configuration (property
  // values, access-control lists, binaries) but were previously only
  // logged to console.* with no durable record of who changed what.
  db.run(`
    CREATE TABLE IF NOT EXISTS cps_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      username TEXT,
      timestamp INTEGER NOT NULL,
      operation TEXT NOT NULL,
      cps_base_url TEXT,
      project_key TEXT,
      environment TEXT,
      prop_type TEXT,
      success INTEGER NOT NULL,
      http_status INTEGER,
      detail TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cps_audit_log_time ON cps_audit_log(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cps_audit_log_project ON cps_audit_log(cps_base_url, project_key)`);

  // ── Exchange API spec cache ────────────────────────────────────────────
  // GET /exchange/ping-spec resolves + downloads + parses an Exchange asset
  // spec (portal model fetch, possible raw OAS/RAML file download, AMF
  // enrichment) — several Anypoint API round-trips per call. Specs change
  // rarely (new asset version, not every deploy), so persist the parsed
  // result keyed by how it was resolved and skip Anypoint entirely while
  // the cached row is still within TTL. Durable (survives server restart),
  // unlike the frontend's in-memory SWR cache which clears on page reload.
  db.run(`
    CREATE TABLE IF NOT EXISTS exchange_spec_cache (
      cache_key TEXT PRIMARY KEY,
      org_id TEXT,
      app_name TEXT,
      group_id TEXT,
      asset_id TEXT,
      version TEXT,
      data TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_exchange_spec_cache_org_app ON exchange_spec_cache(org_id, app_name)`);
});

module.exports = db;
