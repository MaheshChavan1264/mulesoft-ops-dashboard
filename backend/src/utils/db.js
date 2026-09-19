const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, 'app.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB] Error opening application database:', err.message);
  } else {
    console.log('[DB] Connected to application database (app.db).');
    
    // Initialize tables
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
        error TEXT
      )
    `);
    
    // Create indexes for faster queries
    db.run(`CREATE INDEX IF NOT EXISTS idx_ping_history_session_app ON ping_history(session_id, org_id, env_id, app_name)`);
  }
});

module.exports = db;
