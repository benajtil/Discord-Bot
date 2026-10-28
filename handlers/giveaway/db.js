const giveawayKey = (id) => `giveaway:${id}:current`;
const settingsKey = (id) => `giveaway:${id}:keywordSettings`;
const activitySettingsKey = (id) => `giveaway:${id}:activitySettings`;
const activityKey = (g, u) => `giveawayActivity:${g}:${u}`;
const streakKey = (g, u) => `giveaway:${g}:keywordStreak:${u}`;
const activityUsersKey = (id) => `giveaway:${id}:activityUsers`;
const {
  DEFAULT_KEYWORD_START_MINUTE,
  DEFAULT_KEYWORD_END_MINUTE,
  DAY,
  MAX_ACTIVITY_PERIOD,
} = require("./constants");
async function getSettings(db, id) {
  const s = (await db.get(settingsKey(id))) || {},
    start = Number(s.creditStartMinute),
    end = Number(s.creditEndMinute);
  return {
    enabled: s.enabled ?? false,
    keyword: s.keyword || "good morning",
    targetUserId: s.targetUserId || null,
    requiredDays: Math.max(1, Number(s.requiredDays) || 3),
    creditStartMinute:
      Number.isInteger(start) && start >= 0 && start < 1440
        ? start
        : DEFAULT_KEYWORD_START_MINUTE,
    creditEndMinute:
      Number.isInteger(end) && end >= 0 && end < 1440
        ? end
        : DEFAULT_KEYWORD_END_MINUTE,
  };
}
async function saveSettings(db, id, s) {
  return db.set(settingsKey(id), s);
}
async function getActivitySettings(db, id) {
  const s = (await db.get(activitySettingsKey(id))) || {};
  return {
    enabled: s.enabled ?? false,
    messages: Math.max(1, Number(s.messages) || 10),
    mode: s.mode === "daily" ? "daily" : "total",
    periodMs: Math.min(
      MAX_ACTIVITY_PERIOD,
      Math.max(60000, Number(s.periodMs) || DAY),
    ),
  };
}
async function saveActivitySettings(db, id, s) {
  return db.set(activitySettingsKey(id), s);
}
async function getGiveaway(db, id) {
  return db.get(giveawayKey(id));
}
async function saveGiveaway(db, id, g) {
  return db.set(giveawayKey(id), g);
}
async function getActivityMessages(db, g, u) {
  const a = (await db.get(activityKey(g, u))) || {};
  return Array.isArray(a.messages) ? a.messages : [];
}
module.exports = {
  giveawayKey,
  settingsKey,
  activitySettingsKey,
  activityKey,
  streakKey,
  activityUsersKey,
  getSettings,
  saveSettings,
  getActivitySettings,
  saveActivitySettings,
  getGiveaway,
  saveGiveaway,
  getActivityMessages,
};
