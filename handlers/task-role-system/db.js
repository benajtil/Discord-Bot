const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function createTaskDatabase(filename) {
  const resolved = path.resolve(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, setting_key)
    );
    CREATE TABLE IF NOT EXISTS members (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS counters (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, task_id, period_key)
    );
    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      points INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('approved')),
      submission_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (guild_id, user_id, task_id, period_key)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      proof TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewer_id TEXT,
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_submissions_guild_status ON submissions(guild_id, status, id);
    CREATE INDEX IF NOT EXISTS idx_completions_points ON completions(guild_id, user_id);
  `);

  const getSettingStmt = db.prepare(
    "SELECT setting_value FROM guild_settings WHERE guild_id = ? AND setting_key = ?",
  );
  const setSettingStmt =
    db.prepare(`INSERT INTO guild_settings (guild_id, setting_key, setting_value) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`);
  const deleteSettingStmt = db.prepare(
    "DELETE FROM guild_settings WHERE guild_id = ? AND setting_key = ?",
  );
  const listSettingsStmt = db.prepare(
    "SELECT setting_key, setting_value FROM guild_settings WHERE guild_id = ?",
  );
  const ensureMemberStmt = db.prepare(
    "INSERT OR IGNORE INTO members (guild_id, user_id) VALUES (?, ?)",
  );
  const getPointsStmt = db.prepare(
    "SELECT COALESCE(SUM(points), 0) AS points FROM completions WHERE guild_id = ? AND user_id = ?",
  );
  const getCompletionStmt = db.prepare(
    "SELECT * FROM completions WHERE guild_id = ? AND user_id = ? AND task_id = ? AND period_key = ?",
  );
  const getCounterStmt = db.prepare(
    "SELECT value FROM counters WHERE guild_id = ? AND user_id = ? AND task_id = ? AND period_key = ?",
  );
  const incrementCounterStmt =
    db.prepare(`INSERT INTO counters (guild_id,user_id,task_id,period_key,value) VALUES (?,?,?,?,1)
    ON CONFLICT(guild_id,user_id,task_id,period_key) DO UPDATE SET value = value + 1`);
  const createSubmissionStmt = db.prepare(
    "INSERT INTO submissions (guild_id,user_id,task_id,period_key,proof) VALUES (?,?,?,?,?)",
  );
  const getSubmissionStmt = db.prepare(
    "SELECT * FROM submissions WHERE id = ? AND guild_id = ?",
  );
  const listPendingStmt = db.prepare(
    "SELECT * FROM submissions WHERE guild_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ?",
  );
  const reviewSubmissionStmt = db.prepare(
    "UPDATE submissions SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ? AND status = 'pending'",
  );
  const awardCompletionStmt =
    db.prepare(`INSERT OR IGNORE INTO completions (guild_id,user_id,task_id,period_key,points,status,submission_id)
    VALUES (?,?,?,?,?,'approved',?)`);
  const countApprovedStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM completions WHERE guild_id = ? AND user_id = ?",
  );
  const countPendingStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM submissions WHERE guild_id = ? AND user_id = ? AND status = 'pending'",
  );

  return {
    getSetting(guildId, key) {
      return getSettingStmt.get(guildId, key)?.setting_value ?? null;
    },
    setSetting(guildId, key, value) {
      setSettingStmt.run(guildId, key, String(value));
    },
    deleteSetting(guildId, key) {
      return deleteSettingStmt.run(guildId, key).changes > 0;
    },
    listSettings(guildId) {
      return Object.fromEntries(
        listSettingsStmt
          .all(guildId)
          .map((row) => [row.setting_key, row.setting_value]),
      );
    },
    ensureMember(guildId, userId) {
      ensureMemberStmt.run(guildId, userId);
    },
    getPoints(guildId, userId) {
      return getPointsStmt.get(guildId, userId).points;
    },
    getCompletion(guildId, userId, taskId, periodKey) {
      return getCompletionStmt.get(guildId, userId, taskId, periodKey) || null;
    },
    getCounter(guildId, userId, taskId, periodKey) {
      return getCounterStmt.get(guildId, userId, taskId, periodKey)?.value || 0;
    },
    incrementCounter(guildId, userId, taskId, periodKey) {
      incrementCounterStmt.run(guildId, userId, taskId, periodKey);
      return getCounterStmt.get(guildId, userId, taskId, periodKey).value;
    },
    createSubmission({ guildId, userId, taskId, periodKey, proof }) {
      ensureMemberStmt.run(guildId, userId);
      return createSubmissionStmt.run(guildId, userId, taskId, periodKey, proof)
        .lastInsertRowid;
    },
    getSubmission(id, guildId) {
      return getSubmissionStmt.get(id, guildId) || null;
    },
    listPending(guildId, limit = 10) {
      return listPendingStmt.all(guildId, limit);
    },
    reviewSubmission(id, guildId, status, reviewerId, note) {
      return (
        reviewSubmissionStmt.run(status, reviewerId, note, id, guildId)
          .changes > 0
      );
    },
    awardCompletion({
      guildId,
      userId,
      taskId,
      periodKey,
      points,
      submissionId,
    }) {
      ensureMemberStmt.run(guildId, userId);
      return (
        awardCompletionStmt.run(
          guildId,
          userId,
          taskId,
          periodKey,
          points,
          submissionId,
        ).changes > 0
      );
    },
    countApproved(guildId, userId) {
      return countApprovedStmt.get(guildId, userId).count;
    },
    countPending(guildId, userId) {
      return countPendingStmt.get(guildId, userId).count;
    },
    close() {
      db.close();
    },
  };
}

module.exports = { createTaskDatabase };
