const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function createXpStaffDatabase(filePath = "./data/xp-level-staff.sqlite") {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const db = new Database(absolutePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (guild_id, key)
    );
    CREATE TABLE IF NOT EXISTS profiles (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      experience TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewer_id TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_xp_staff_apps ON applications(guild_id, status, id);
  `);
  const getSetting = db.prepare(
    "SELECT value FROM settings WHERE guild_id=? AND key=?",
  );
  const setSetting =
    db.prepare(`INSERT INTO settings(guild_id,key,value) VALUES(?,?,?)
    ON CONFLICT(guild_id,key) DO UPDATE SET value=excluded.value`);
  const getXp = db.prepare(
    "SELECT xp FROM profiles WHERE guild_id=? AND user_id=?",
  );
  const addXp =
    db.prepare(`INSERT INTO profiles(guild_id,user_id,xp) VALUES(?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET xp=profiles.xp+excluded.xp, updated_at=CURRENT_TIMESTAMP`);
  const leaderboard = db.prepare(
    "SELECT user_id,xp FROM profiles WHERE guild_id=? ORDER BY xp DESC LIMIT ?",
  );
  const pending = db.prepare(
    "SELECT * FROM applications WHERE guild_id=? AND user_id=? AND status='pending' LIMIT 1",
  );
  const createApp = db.prepare(
    "INSERT INTO applications(guild_id,user_id,reason,experience) VALUES(?,?,?,?)",
  );
  const listApps = db.prepare(
    "SELECT * FROM applications WHERE guild_id=? AND status='pending' ORDER BY id LIMIT ?",
  );
  const getApp = db.prepare(
    "SELECT * FROM applications WHERE guild_id=? AND id=?",
  );
  const reviewApp = db.prepare(
    "UPDATE applications SET status=?,reviewer_id=?,note=?,reviewed_at=CURRENT_TIMESTAMP WHERE guild_id=? AND id=? AND status='pending'",
  );
  return {
    getSetting(g, k) {
      return getSetting.get(g, k)?.value ?? null;
    },
    setSetting(g, k, v) {
      setSetting.run(g, k, String(v));
    },
    getXp(g, u) {
      return getXp.get(g, u)?.xp || 0;
    },
    addXp(g, u, n) {
      addXp.run(g, u, n);
      return getXp.get(g, u).xp;
    },
    leaderboard(g, n = 10) {
      return leaderboard.all(g, n);
    },
    hasPending(g, u) {
      return Boolean(pending.get(g, u));
    },
    createApp(g, u, r, e) {
      return createApp.run(g, u, r, e).lastInsertRowid;
    },
    listApps(g, n = 10) {
      return listApps.all(g, n);
    },
    getApp(g, id) {
      return getApp.get(g, id) || null;
    },
    reviewApp(g, id, status, reviewer, note) {
      return reviewApp.run(status, reviewer, note, g, id).changes > 0;
    },
    close() {
      db.close();
    },
  };
}
module.exports = { createXpStaffDatabase };
