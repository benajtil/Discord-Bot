const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const DAY = 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_PERIOD = 30 * DAY;
const ENTRY_EMOJI = "🎉";
const COLOR = 0x8b5cf6;
const TIME_ZONE = "Asia/Manila";

const giveawayKey = (guildId) => `giveaway:${guildId}:current`;
const settingsKey = (guildId) => `giveaway:${guildId}:keywordSettings`;
const activitySettingsKey = (guildId) => `giveaway:${guildId}:activitySettings`;
const activityKey = (guildId, userId) =>
  `giveawayActivity:${guildId}:${userId}`;
const streakKey = (guildId, userId) =>
  `giveaway:${guildId}:keywordStreak:${userId}`;
const activityUsersKey = (guildId) => `giveaway:${guildId}:activityUsers`;

const DEFAULT_KEYWORD_START_MINUTE = 0;
const DEFAULT_KEYWORD_END_MINUTE = 12 * 60;

// Prevent multiple timers or commands from ending the same giveaway at once.
const endingGiveaways = new Set();

/* -------------------- DATE / TIME -------------------- */

function getManilaDayKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getManilaTodayLabel() {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function previousDayKey(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getManilaMinuteOfDay(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return Number(values.hour) * 60 + Number(values.minute);
}

/* -------------------- KEYWORD CREDIT WINDOW -------------------- */

function parseClockTime(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();

  if (minute > 59) return null;

  if (period) {
    if (hour < 1 || hour > 12) return null;

    hour %= 12;

    if (period === "PM") {
      hour += 12;
    }
  } else if (hour > 23) {
    return null;
  }

  return hour * 60 + minute;
}

function formatClockTime(totalMinutes) {
  const minutes = ((Number(totalMinutes) % 1440) + 1440) % 1440;

  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function isWithinKeywordWindow(settings, timestamp = Date.now()) {
  const current = getManilaMinuteOfDay(timestamp);
  const start = Number(settings.creditStartMinute);
  const end = Number(settings.creditEndMinute);

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return false;
  }

  if (start < 0 || start >= 1440 || end < 0 || end >= 1440) {
    return false;
  }

  if (start < end) {
    return current >= start && current < end;
  }

  // Supports windows crossing midnight, such as 8 PM–2 AM.
  return current >= start || current < end;
}

/* -------------------- PROGRESS UI -------------------- */

// Returns details for a modern Unicode progress bar.
function getProgressDetails(current, target, size = 12) {
  const safeSize = Math.max(1, Math.floor(Number(size) || 12));
  const safeTarget = Math.max(1, Number(target) || 1);
  const safeCurrent = Math.max(0, Math.min(safeTarget, Number(current) || 0));

  const percentage = Math.round((safeCurrent / safeTarget) * 100);

  const filled = Math.max(
    0,
    Math.min(safeSize, Math.round((percentage / 100) * safeSize)),
  );

  return {
    bar: "▰".repeat(filled) + "▱".repeat(safeSize - filled),
    percentage,
    current: safeCurrent,
    target: safeTarget,
    complete: percentage >= 100,
  };
}

// Keep this returning a string because other sections use it in template literals.
function makeProgressBar(current, target, size = 12) {
  return getProgressDetails(current, target, size).bar;
}

function progressLine(label, current, target, complete = false) {
  const progress = getProgressDetails(current, target);

  return [
    `${progress.complete || complete ? "🟢" : "🔹"} **${label}**`,
    `\`${progress.bar}\` **${progress.percentage}%**`,
    `\`${progress.current}/${progress.target}\` completed`,
  ].join("\n");
}

/* -------------------- GENERAL HELPERS -------------------- */

function parseDuration(value) {
  const match = String(value || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(m|min|h|hr|d|day|w|week|month|mo)$/);

  if (!match) return null;

  const amount = Number(match[1]);

  const multipliers = {
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    d: DAY,
    day: DAY,
    w: 7 * DAY,
    week: 7 * DAY,
    mo: 30 * DAY,
    month: 30 * DAY,
  };

  if (!amount || amount > 1000) return null;

  return amount * multipliers[match[2]];
}

function formatDuration(milliseconds) {
  if (milliseconds % (7 * DAY) === 0) {
    return `${milliseconds / (7 * DAY)}w`;
  }

  if (milliseconds % DAY === 0) {
    return `${milliseconds / DAY}d`;
  }

  if (milliseconds % 3_600_000 === 0) {
    return `${milliseconds / 3_600_000}h`;
  }

  if (milliseconds % 60_000 === 0) {
    return `${milliseconds / 60_000}m`;
  }

  return `${Math.round(milliseconds / 1000)}s`;
}

function normalizeKeyword(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function containsGiveawayKeyword(content, keyword) {
  const normalizedKeyword = normalizeKeyword(keyword);

  return (
    normalizedKeyword.length > 0 &&
    normalizeKeyword(content).includes(normalizedKeyword)
  );
}

/* -------------------- DATABASE -------------------- */

async function getSettings(db, guildId) {
  const saved = (await db.get(settingsKey(guildId))) || {};

  const start = Number(saved.creditStartMinute);
  const end = Number(saved.creditEndMinute);

  return {
    enabled: saved.enabled ?? false,
    keyword: saved.keyword || "good morning",
    targetUserId: saved.targetUserId || null,
    requiredDays: Math.max(1, Number(saved.requiredDays) || 3),

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

async function saveSettings(db, guildId, settings) {
  await db.set(settingsKey(guildId), settings);
}

async function getActivitySettings(db, guildId) {
  const saved = (await db.get(activitySettingsKey(guildId))) || {};

  return {
    enabled: saved.enabled ?? false,
    messages: Math.max(1, Number(saved.messages) || 10),
    mode: saved.mode === "daily" ? "daily" : "total",
    periodMs: Math.min(
      MAX_ACTIVITY_PERIOD,
      Math.max(60_000, Number(saved.periodMs) || DAY),
    ),
  };
}

async function saveActivitySettings(db, guildId, settings) {
  await db.set(activitySettingsKey(guildId), settings);
}

async function getGiveaway(db, guildId) {
  return db.get(giveawayKey(guildId));
}

async function saveGiveaway(db, guildId, giveaway) {
  await db.set(giveawayKey(guildId), giveaway);
}

async function getActivityMessages(db, guildId, userId) {
  const activity = (await db.get(activityKey(guildId, userId))) || {};

  return Array.isArray(activity.messages) ? activity.messages : [];
}

/* -------------------- KEYWORD STREAK -------------------- */
async function isKeywordEligible(db, guild, giveaway, userId) {
  const settings = await getSettings(db, guild.id);

  // Require keyword tracking to be configured.
  if (!settings.enabled || !settings.targetUserId) {
    return false;
  }

  const streak = await getStreak(db, guild.id, userId);
  const today = getManilaDayKey();

  // The member must have received credit today.
  if (streak.lastDay !== today) {
    return false;
  }

  // Require the configured number of consecutive credited days.
  const requiredDays = Math.max(1, Number(settings.requiredDays) || 3);

  if (streak.count < requiredDays) {
    return false;
  }

  // Confirm that the streak includes the required consecutive days.
  const creditedDays = new Set(streak.creditedDays || []);
  let day = today;

  for (let i = 0; i < requiredDays; i++) {
    if (!creditedDays.has(day)) {
      return false;
    }

    day = previousDayKey(day);
  }

  return true;
}
async function getStreak(db, guildId, userId) {
  const streak = await db.get(streakKey(guildId, userId));

  if (!streak || typeof streak !== "object") {
    return {
      lastDay: null,
      count: 0,
      creditedDays: [],
    };
  }

  return {
    lastDay: streak.lastDay || null,
    count: Number(streak.count) || 0,
    creditedDays: Array.isArray(streak.creditedDays) ? streak.creditedDays : [],
  };
}

async function creditKeywordMessage(
  db,
  guildId,
  userId,
  timestamp = Date.now(),
) {
  const today = getManilaDayKey(timestamp);
  const streak = await getStreak(db, guildId, userId);

  // Only one credit per member per Manila calendar day.
  if (streak.lastDay === today) {
    return {
      credited: false,
      streak: streak.count,
    };
  }

  streak.count =
    streak.lastDay === previousDayKey(today) ? streak.count + 1 : 1;

  streak.lastDay = today;
  streak.creditedDays = [...streak.creditedDays, today].slice(-60);

  await db.set(streakKey(guildId, userId), streak);

  return {
    credited: true,
    streak: streak.count,
  };
}

/* -------------------- ACTIVITY REQUIREMENTS -------------------- */

function describeActivitySettings(settings) {
  if (!settings.enabled) return "Disabled";

  if (settings.mode === "daily") {
    const daysRequired = Math.max(1, Math.round(settings.periodMs / DAY));

    return (
      `${settings.messages} messages per calendar day ` +
      `for ${daysRequired} consecutive calendar day(s)`
    );
  }

  return (
    `${settings.messages} messages within ` + formatDuration(settings.periodMs)
  );
}

function checkActivityEligibility(messages, settings, now = Date.now()) {
  if (!settings.enabled) {
    return { ok: true };
  }

  const validMessages = messages
    .map(Number)
    .filter(
      (timestamp) =>
        Number.isFinite(timestamp) &&
        timestamp > 0 &&
        timestamp <= now &&
        timestamp >= now - MAX_ACTIVITY_PERIOD,
    );

  if (settings.mode === "daily") {
    const daysRequired = Math.max(1, Math.round(settings.periodMs / DAY));

    const countsByDay = new Map();

    for (const timestamp of validMessages) {
      const day = getManilaDayKey(timestamp);

      countsByDay.set(day, (countsByDay.get(day) || 0) + 1);
    }

    let day = getManilaDayKey(now);

    for (let offset = 0; offset < daysRequired; offset++) {
      const count = countsByDay.get(day) || 0;

      if (count < settings.messages) {
        return {
          ok: false,
          reason:
            `You need at least **${settings.messages} messages per day** ` +
            `for **${daysRequired} consecutive calendar day(s)**. ` +
            `For ${day}, you have ${count}/${settings.messages} messages.`,
        };
      }

      day = previousDayKey(day);
    }

    return { ok: true };
  }

  const cutoff = now - settings.periodMs;

  const count = validMessages.filter((timestamp) => timestamp >= cutoff).length;

  if (count < settings.messages) {
    return {
      ok: false,
      reason:
        `You need **${settings.messages} messages within ` +
        `${formatDuration(settings.periodMs)}**. ` +
        `You currently have ${count}/${settings.messages}.`,
    };
  }

  return { ok: true };
}

/* -------------------- BUTTONS -------------------- */

function makePreviewButtons(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:publish:${guildId}`)
      .setLabel("Publish Giveaway")
      .setEmoji("🚀")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`giveaway:cancel:${guildId}`)
      .setLabel("Cancel")
      .setEmoji("✖️")
      .setStyle(ButtonStyle.Secondary),
  );
}

function makeEntryButtons(guildId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway:enter:${guildId}`)
        .setLabel(disabled ? "Giveaway Ended" : "Enter Giveaway")
        .setEmoji(ENTRY_EMOJI)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId(`giveaway:progress:${guildId}`)
        .setLabel("Check My Progress")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
}

/* -------------------- EMBEDS -------------------- */

function makeGiveawayEmbed(giveaway, settings, activitySettings) {
  const endTime = Number(giveaway.endsAt);
  const validEndTime = Number.isFinite(endTime) && endTime > 0;
  const ended = giveaway.status === "ended";
  const requirements = [];

  if (giveaway.requiredRoleId) {
    requirements.push(`• Required role: <@&${giveaway.requiredRoleId}>`);
  }

  if (activitySettings?.enabled) {
    requirements.push(
      `• Activity: ${describeActivitySettings(activitySettings)}`,
    );
  }

  if (Number(giveaway.requiredMessages) > 0) {
    requirements.push(
      `• ${giveaway.requiredMessages} messages within ` +
        `${giveaway.messageDays || 1} day(s)`,
    );
  }

  if (Number(giveaway.requiredActiveDays) > 0) {
    requirements.push(
      `• Active on ${giveaway.requiredActiveDays} day(s) within ` +
        `${giveaway.activeDaysWithin || 7} day(s)`,
    );
  }

  // Keyword is displayed as a progress feature, not an entry requirement.
  if (settings?.enabled) {
    requirements.push(
      `• Optional progress: send **"${settings.keyword}"** ` +
        `for ${settings.requiredDays || 3} consecutive day(s)`,
    );

    requirements.push(
      settings.targetUserId
        ? `• Keyword target: mention or reply to <@${settings.targetUserId}>`
        : "• Keyword target is not configured",
    );

    requirements.push(
      `• Keyword credit window: ` +
        `${formatClockTime(settings.creditStartMinute)} – ` +
        `${formatClockTime(settings.creditEndMinute)} Manila time`,
    );
  }

  const winners = Array.isArray(giveaway.winners) ? giveaway.winners : [];

  const winnerText = ended
    ? giveaway.endedWithoutWinner
      ? "Not selected"
      : winners.length
        ? winners.map((id) => `<@${id}>`).join(", ")
        : "No eligible winners"
    : `${Number(giveaway.winnerCount) || 1} winner(s)`;

  const timeText = ended
    ? "Ended"
    : validEndTime
      ? `<t:${Math.floor(endTime / 1000)}:R> ` +
        `(<t:${Math.floor(endTime / 1000)}:f>)`
      : "Not configured";

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x747f8d : COLOR)
    .setAuthor({ name: "KATOR6 • GIVEAWAY" })
    .setTitle(`🎁 ${giveaway.prize || "Giveaway"}`)
    .setDescription(
      [
        "Enter for a chance to win!",
        "",
        "━━━━━━━━━━━━━━━━━━",
        `**👑 Host**\n<@${giveaway.hostId}>`,
        `**🏆 Winner(s)**\n${winnerText}`,
        `**⏳ Time remaining**\n${timeText}`,
        `**🎟️ Entries**\n${(giveaway.entries || []).length}`,
        `**📋 Requirements**\n${
          requirements.length
            ? requirements.join("\n")
            : "No additional requirements."
        }`,
        "",
        "━━━━━━━━━━━━━━━━━━",
        ended
          ? "This giveaway has ended."
          : "Press **Enter Giveaway** below to check your eligibility.",
      ].join("\n"),
    )
    .setFooter({ text: "Kator6 • Good luck!" });

  if (validEndTime) {
    embed.setTimestamp(new Date(endTime));
  }

  return embed;
}

function makePreviewEmbed(giveaway, settings, activitySettings) {
  const embed = makeGiveawayEmbed(giveaway, settings, activitySettings);

  embed.setColor(0xf0b232);
  embed.setAuthor({ name: "KATOR6 • GIVEAWAY PREVIEW" });
  embed.setDescription(
    [
      "Review your giveaway before publishing it.",
      "",
      embed.data.description || "",
      "",
      "⚠️ **This is a private preview.** Members cannot enter until you publish.",
    ].join("\n"),
  );

  return embed;
}

/* -------------------- ENTRY REQUIREMENTS -------------------- */

async function checkEntryRequirements(db, guild, giveaway, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);

  if (!member || member.user.bot) {
    return {
      ok: false,
      reason: "Bots cannot enter this giveaway.",
    };
  }

  // 1. Check required role.
  if (
    giveaway.requiredRoleId &&
    !member.roles.cache.has(giveaway.requiredRoleId)
  ) {
    return {
      ok: false,
      reason: `You need the <@&${giveaway.requiredRoleId}> role.`,
    };
  }

  // 2. Check activity requirements.
  const messages = await getActivityMessages(db, guild.id, userId);
  const activitySettings = await getActivitySettings(db, guild.id);

  const activityCheck = checkActivityEligibility(messages, activitySettings);

  if (!activityCheck.ok) {
    return activityCheck;
  }

  // 3. Check legacy total-message requirement.
  if (Number(giveaway.requiredMessages) > 0) {
    const cutoff = Date.now() - Number(giveaway.messageDays || 1) * DAY;

    const count = messages.filter((time) => Number(time) >= cutoff).length;

    if (count < Number(giveaway.requiredMessages)) {
      return {
        ok: false,
        reason:
          `You need ${giveaway.requiredMessages} messages within ` +
          `${giveaway.messageDays || 1} day(s). ` +
          `You currently have ${count}.`,
      };
    }
  }

  // 4. Check legacy active-day requirement.
  if (Number(giveaway.requiredActiveDays) > 0) {
    const cutoff = Date.now() - Number(giveaway.activeDaysWithin || 7) * DAY;

    const activeDays = new Set(
      messages
        .filter((time) => Number(time) >= cutoff)
        .map((time) => getManilaDayKey(Number(time))),
    ).size;

    if (activeDays < Number(giveaway.requiredActiveDays)) {
      return {
        ok: false,
        reason:
          `You need to be active on ${giveaway.requiredActiveDays} ` +
          `different day(s) within ` +
          `${giveaway.activeDaysWithin || 7} days. ` +
          `You currently have ${activeDays}.`,
      };
    }
  }

  // 5. Require completion of the daily keyword task.
  const keywordEligible = await isKeywordEligible(db, guild, giveaway, userId);

  if (!keywordEligible) {
    return {
      ok: false,
      reason:
        "You must complete the daily keyword task before entering. " +
        "Send the required keyword and make sure you receive credit.",
    };
  }

  // All requirements passed.
  return { ok: true };
}

/* -------------------- PRIVATE REPLIES -------------------- */

async function replyPrivately(interaction, content) {
  const payload = {
    content,
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

/* -------------------- REFRESH GIVEAWAY -------------------- */

async function refreshGiveawayMessage(client, db, guildId) {
  const giveaway = await getGiveaway(db, guildId);

  if (!giveaway?.messageId) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);

  if (!guild) return;

  const channel = await guild.channels
    .fetch(giveaway.channelId)
    .catch(() => null);

  if (!channel?.isTextBased()) return;

  const message = await channel.messages
    .fetch(giveaway.messageId)
    .catch(() => null);

  if (!message) return;

  const settings = await getSettings(db, guildId);
  const activitySettings = await getActivitySettings(db, guildId);

  const ended = giveaway.status === "ended";

  await message
    .edit({
      embeds: [makeGiveawayEmbed(giveaway, settings, activitySettings)],
      components: makeEntryButtons(guildId, ended),
    })
    .catch((error) => console.error("[Giveaway refresh]", error));
}

async function publishGiveaway(client, db, guild, giveaway) {
  const channel = await guild.channels
    .fetch(giveaway.channelId)
    .catch(() => null);

  if (!channel?.isTextBased()) {
    throw new Error(
      "The selected channel is unavailable or is not a text channel.",
    );
  }

  const settings = await getSettings(db, guild.id);
  const activitySettings = await getActivitySettings(db, guild.id);

  const message = await channel.send({
    embeds: [makeGiveawayEmbed(giveaway, settings, activitySettings)],
    components: makeEntryButtons(guild.id),
  });

  giveaway.messageId = message.id;
  giveaway.status = "active";

  await saveGiveaway(db, guild.id, giveaway);

  return message;
}

/* -------------------- END / REROLL -------------------- */

async function endGiveaway(
  client,
  db,
  guildId,
  reroll = false,
  selectWinners = true,
) {
  if (endingGiveaways.has(guildId)) {
    return {
      ok: false,
      reason:
        "This giveaway is already being processed. Please try again shortly.",
    };
  }

  endingGiveaways.add(guildId);

  try {
    const giveaway = await getGiveaway(db, guildId);

    if (!giveaway || (giveaway.status !== "active" && !reroll)) {
      return {
        ok: false,
        reason: "There is no active giveaway to end.",
      };
    }

    if (reroll && giveaway.status !== "ended") {
      return {
        ok: false,
        reason: "End the giveaway before rerolling.",
      };
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);

    if (!guild) {
      return {
        ok: false,
        reason: "Server not found.",
      };
    }

    const previousWinners = Array.isArray(giveaway.winners)
      ? giveaway.winners
      : [];

    const candidates = [];

    if (selectWinners) {
      for (const userId of giveaway.entries || []) {
        if (previousWinners.includes(userId)) continue;

        const check = await checkEntryRequirements(db, guild, giveaway, userId);

        if (check.ok) {
          candidates.push(userId);
        }
      }
    }

    const selected = [];
    const winnerCount = Math.max(1, Number(giveaway.winnerCount) || 1);

    while (candidates.length > 0 && selected.length < winnerCount) {
      const index = Math.floor(Math.random() * candidates.length);

      selected.push(candidates.splice(index, 1)[0]);
    }

    if (reroll) {
      giveaway.winners = [...previousWinners, ...selected];
    } else {
      giveaway.winners = selected;
      giveaway.status = "ended";
      giveaway.endedAt = Date.now();
      giveaway.endedWithoutWinner = !selectWinners;
    }

    await saveGiveaway(db, guildId, giveaway);
    await refreshGiveawayMessage(client, db, guildId);

    const channel = await guild.channels
      .fetch(giveaway.channelId)
      .catch(() => null);

    if (channel?.isTextBased()) {
      if (selected.length > 0) {
        await channel
          .send({
            content:
              `🎉 Congratulations ${selected
                .map((id) => `<@${id}>`)
                .join(", ")}! ` + `You won **${giveaway.prize}**!`,
            allowedMentions: {
              users: selected,
            },
          })
          .catch((error) =>
            console.error("[Giveaway winner announcement]", error),
          );
      } else if (!selectWinners && !reroll) {
        await channel
          .send(
            `⏹️ The giveaway for **${giveaway.prize}** has ended without a winner.`,
          )
          .catch(() => {});
      } else {
        await channel
          .send(
            `No eligible winners could be selected for **${giveaway.prize}**.`,
          )
          .catch(() => {});
      }
    }

    return {
      ok: true,
      winners: selected,
    };
  } catch (error) {
    console.error("[Giveaway end]", error);

    return {
      ok: false,
      reason: "An error occurred while processing the giveaway.",
    };
  } finally {
    endingGiveaways.delete(guildId);
  }
}

/* -------------------- SLASH COMMAND -------------------- */

function buildGiveawaySlashCommand() {
  return new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Prepare a giveaway preview")
        .addStringOption((option) =>
          option.setName("prize").setDescription("Prize").setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Posting channel")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("duration")
            .setDescription("Example: 30m, 2h, 3d")
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("winners")
            .setDescription("Number of winners")
            .setMinValue(1)
            .setMaxValue(20)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName("required_role")
            .setDescription("Role required to enter"),
        ),
    )

    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show the current giveaway"),
    )

    .addSubcommand((sub) =>
      sub
        .setName("end")
        .setDescription("End the current giveaway")
        .addStringOption((option) =>
          option
            .setName("winner_mode")
            .setDescription("Choose whether to select a winner")
            .setRequired(true)
            .addChoices(
              {
                name: "🎉 Select winner(s)",
                value: "select",
              },
              {
                name: "⏹️ End without a winner",
                value: "none",
              },
            ),
        ),
    )

    .addSubcommand((sub) =>
      sub.setName("reroll").setDescription("Select additional winner(s)"),
    );
}

/* -------------------- MODULE -------------------- */

function createGiveawayModule(client, db, prefix = "!") {
  if (client.__ysabelleGiveawayLoaded) {
    return {
      slashCommand: buildGiveawaySlashCommand(),
      handleSlashCommand: async () => false,
      handlePrefix: async () => false,
    };
  }

  client.__ysabelleGiveawayLoaded = true;

  /* ---------- MEMBER PROGRESS EMBED ---------- */

  async function buildMemberProgressEmbed(guild, giveaway, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member || member.user.bot) {
      return new EmbedBuilder()
        .setColor(COLOR)
        .setAuthor({
          name: "KATOR6 • GIVEAWAY CENTER",
        })
        .setTitle("📊 Your Entry Progress")
        .setDescription("Unable to load your progress. Please try again.")
        .setTimestamp();
    }

    const now = Date.now();

    const messages = (await getActivityMessages(db, guild.id, userId))
      .map(Number)
      .filter(
        (timestamp) =>
          Number.isFinite(timestamp) &&
          timestamp > 0 &&
          timestamp <= now &&
          timestamp >= now - MAX_ACTIVITY_PERIOD,
      );

    const lines = [];

    // Required role
    if (giveaway.requiredRoleId) {
      const role = await guild.roles
        .fetch(giveaway.requiredRoleId)
        .catch(() => null);

      const hasRole =
        Boolean(role) && member.roles.cache.has(giveaway.requiredRoleId);

      lines.push(
        `${hasRole ? "✅" : "❌"} **Required Role**\n` +
          (hasRole
            ? `You have the **${role.name}** role.`
            : role
              ? `You need the **${role.name}** role.`
              : "The configured role no longer exists."),
      );
    } else {
      lines.push("✅ **Required Role**\nNo role is required.");
    }

    // Activity requirement
    const activitySettings = await getActivitySettings(db, guild.id);

    if (activitySettings.enabled) {
      const required = activitySettings.messages;

      if (activitySettings.mode === "daily") {
        const daysRequired = Math.max(
          1,
          Math.round(activitySettings.periodMs / DAY),
        );

        const counts = new Map();

        for (const timestamp of messages) {
          const day = getManilaDayKey(timestamp);

          counts.set(day, (counts.get(day) || 0) + 1);
        }

        const today = getManilaDayKey(now);
        const todayCount = counts.get(today) || 0;

        let completedDays = 0;
        let day = today;

        for (let offset = 0; offset < daysRequired; offset++) {
          if ((counts.get(day) || 0) >= required) {
            completedDays++;
            day = previousDayKey(day);
          } else {
            break;
          }
        }

        lines.push(
          `${todayCount >= required ? "✅" : "⬜"} **Today's Messages**\n` +
            `\`${makeProgressBar(todayCount, required)}\` ` +
            `**${Math.min(todayCount, required)}/${required}** today`,
        );

        lines.push(
          `${completedDays >= daysRequired ? "✅" : "⬜"} **Consecutive Activity Days**\n` +
            `\`${makeProgressBar(completedDays, daysRequired)}\` ` +
            `**${completedDays}/${daysRequired} days**`,
        );
      } else {
        const cutoff = now - activitySettings.periodMs;

        const count = messages.filter(
          (timestamp) => timestamp >= cutoff,
        ).length;

        const complete = count >= required;

        lines.push(
          `${complete ? "✅" : "⬜"} **Activity Messages**\n` +
            `\`${makeProgressBar(count, required)}\` ` +
            `**${Math.min(count, required)}/${required}** messages\n` +
            `Within ${formatDuration(activitySettings.periodMs)}`,
        );
      }
    } else {
      lines.push("➖ **Activity Requirement**\nDisabled.");
    }

    // Keyword streak: progress only, not an entry requirement.
    const keywordSettings = await getSettings(db, guild.id);

    if (keywordSettings.enabled) {
      const streak = await getStreak(db, guild.id, userId);

      const requiredDays = Math.max(
        1,
        Number(keywordSettings.requiredDays) || 3,
      );

      const creditedToday = streak.lastDay === getManilaDayKey(now);

      const complete =
        Boolean(keywordSettings.targetUserId) &&
        creditedToday &&
        streak.count >= requiredDays;

      lines.push(
        `${complete ? "✅" : "⬜"} **Keyword Progress: ${keywordSettings.keyword}**\n` +
          `\`${makeProgressBar(streak.count, requiredDays)}\` ` +
          `**${Math.min(streak.count, requiredDays)}/${requiredDays} days**\n` +
          `Today's credit: ${creditedToday ? "✅ Received" : "⬜ Not received"}\n` +
          `Credit window: ${formatClockTime(keywordSettings.creditStartMinute)} – ${formatClockTime(keywordSettings.creditEndMinute)} Manila time\n` +
          `Target: ${
            keywordSettings.targetUserId
              ? `<@${keywordSettings.targetUserId}>`
              : "❌ Not configured"
          }\n` +
          "_Keyword progress does not affect giveaway eligibility._",
      );
    } else {
      lines.push("➖ **Keyword Progress**\nDisabled.");
    }

    // Legacy message requirement
    if (Number(giveaway.requiredMessages) > 0) {
      const cutoff = now - Number(giveaway.messageDays || 1) * DAY;

      const count = messages.filter((timestamp) => timestamp >= cutoff).length;

      const required = Number(giveaway.requiredMessages);

      lines.push(
        progressLine(
          `Legacy Message Requirement (${giveaway.messageDays || 1} day(s))`,
          count,
          required,
          count >= required,
        ),
      );
    }

    // Legacy active-days requirement
    if (Number(giveaway.requiredActiveDays) > 0) {
      const cutoff = now - Number(giveaway.activeDaysWithin || 7) * DAY;

      const activeDays = new Set(
        messages
          .filter((timestamp) => timestamp >= cutoff)
          .map((timestamp) => getManilaDayKey(timestamp)),
      ).size;

      const required = Number(giveaway.requiredActiveDays);

      lines.push(
        progressLine(
          "Legacy Active Days",
          activeDays,
          required,
          activeDays >= required,
        ),
      );
    }

    const eligibility = await checkEntryRequirements(
      db,
      guild,
      giveaway,
      userId,
    );

    return new EmbedBuilder()
      .setColor(eligibility.ok ? 0x22c55e : COLOR)
      .setAuthor({
        name: "KATOR6 • GIVEAWAY CENTER",
      })
      .setTitle("📊 Your Entry Progress")
      .setDescription(
        [
          `**🎁 ${giveaway.prize}**`,
          "",
          eligibility.ok
            ? "🟢 **You're eligible to enter!**"
            : "🟡 **You're making progress**",
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          ...lines,
          "━━━━━━━━━━━━━━━━━━━━",
          eligibility.ok
            ? "Click **Enter Giveaway** to join."
            : `**Next step:** ${eligibility.reason}`,
        ].join("\n"),
      )
      .setFooter({
        text: "Kator6 • Activity days follow Asia/Manila time",
      })
      .setTimestamp();
  }

  /* ---------- SLASH COMMAND HANDLER ---------- */

  async function handleSlashCommand(interaction) {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== "giveaway"
    ) {
      return false;
    }

    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!guild) {
      await replyPrivately(interaction, "Use giveaways inside a server.");

      return true;
    }

    if (sub === "create") {
      const prize = interaction.options.getString("prize");
      const channel = interaction.options.getChannel("channel");
      const duration = parseDuration(interaction.options.getString("duration"));

      const winnerCount = interaction.options.getInteger("winners");

      const requiredRole = interaction.options.getRole("required_role");

      if (!duration) {
        await replyPrivately(
          interaction,
          "Invalid duration. Use `30m`, `2h`, `3d`, or `1w`.",
        );

        return true;
      }

      if (!channel?.isTextBased()) {
        await replyPrivately(interaction, "Please select a text channel.");

        return true;
      }

      const current = await getGiveaway(db, guild.id);

      if (current?.status === "active" || current?.status === "draft") {
        await replyPrivately(
          interaction,
          "There is already a draft or active giveaway. Publish or cancel the draft, or end the active giveaway first.",
        );

        return true;
      }

      const giveaway = {
        prize,
        channelId: channel.id,
        hostId: interaction.user.id,
        winnerCount,
        requiredRoleId: requiredRole?.id || null,
        requiredMessages: 0,
        messageDays: 1,
        requiredActiveDays: 0,
        activeDaysWithin: 7,
        entries: [],
        winners: [],
        status: "draft",
        createdAt: Date.now(),
        endsAt: Date.now() + duration,
        messageId: null,
        endedWithoutWinner: false,
      };

      await saveGiveaway(db, guild.id, giveaway);

      const settings = await getSettings(db, guild.id);
      const activitySettings = await getActivitySettings(db, guild.id);

      await interaction.reply({
        embeds: [makePreviewEmbed(giveaway, settings, activitySettings)],
        components: [makePreviewButtons(guild.id)],
        flags: MessageFlags.Ephemeral,
      });

      return true;
    }

    const giveaway = await getGiveaway(db, guild.id);

    if (!giveaway) {
      await replyPrivately(interaction, "No giveaway has been created yet.");

      return true;
    }

    if (sub === "status") {
      await replyPrivately(
        interaction,
        `**${giveaway.prize}** — ${giveaway.status}\n` +
          `Entries: ${(giveaway.entries || []).length}`,
      );

      return true;
    }

    if (sub === "end") {
      const selectWinners =
        interaction.options.getString("winner_mode") === "select";

      const result = await endGiveaway(
        client,
        db,
        guild.id,
        false,
        selectWinners,
      );

      await replyPrivately(
        interaction,
        result.ok
          ? selectWinners
            ? `Giveaway ended. ${result.winners.length} winner(s) selected.`
            : "Giveaway ended without selecting a winner."
          : result.reason,
      );

      return true;
    }

    if (sub === "reroll") {
      const result = await endGiveaway(client, db, guild.id, true, true);

      await replyPrivately(
        interaction,
        result.ok
          ? result.winners.length
            ? `Reroll complete. Additional winner(s): ${result.winners
                .map((id) => `<@${id}>`)
                .join(", ")}`
            : "Reroll complete, but no additional eligible winners were found."
          : result.reason,
      );

      return true;
    }

    return true;
  }

  /* ---------- PREFIX COMMAND HANDLER ---------- */

  async function handlePrefix(message) {
    if (!message.guild || message.author.bot) {
      return false;
    }

    const command = `${prefix}giveaway`;
    const content = message.content.trim();

    if (!content.toLowerCase().startsWith(command.toLowerCase())) {
      return false;
    }

    const args = content
      .slice(command.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const group = (args.shift() || "").toLowerCase();

    const isOwner = message.guild.ownerId === message.author.id;

    if (
      !isOwner &&
      !message.member.permissions.has(PermissionFlagsBits.ManageGuild)
    ) {
      await message.reply(
        "Only the server owner or someone with Manage Server permission can manage giveaways.",
      );

      return true;
    }

    /* REQUIRED ROLE */

    if (group === "role") {
      const action = (args.shift() || "").toLowerCase();

      const giveaway = await getGiveaway(db, message.guild.id);

      if (!giveaway || !["draft", "active"].includes(giveaway.status)) {
        await message.reply(
          "There is no draft or active giveaway to configure. Create a giveaway first.",
        );

        return true;
      }

      if (action === "status") {
        await message.reply(
          giveaway.requiredRoleId
            ? `🔒 Required role: <@&${giveaway.requiredRoleId}>`
            : "🔓 No specific role is required to enter the current giveaway.",
        );

        return true;
      }

      if (action === "off") {
        giveaway.requiredRoleId = null;

        await saveGiveaway(db, message.guild.id, giveaway);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply("✅ The required role has been removed.");

        return true;
      }

      const roleId =
        message.mentions.roles.first()?.id || action.replace(/[<@&>]/g, "");

      if (!/^\d{17,20}$/.test(roleId)) {
        await message.reply(
          [
            "**Required Role Commands**",
            `\`${prefix}giveaway role @Role\` — Require a role to enter`,
            `\`${prefix}giveaway role off\` — Remove the role requirement`,
            `\`${prefix}giveaway role status\` — Check the current requirement`,
          ].join("\n"),
        );

        return true;
      }

      const role = await message.guild.roles.fetch(roleId).catch(() => null);

      if (!role || role.id === message.guild.id) {
        await message.reply("❌ I couldn't find that role.");

        return true;
      }

      giveaway.requiredRoleId = role.id;

      await saveGiveaway(db, message.guild.id, giveaway);

      await refreshGiveawayMessage(client, db, message.guild.id);

      await message.reply(
        `✅ **${role.name}** is now required to enter the giveaway.`,
      );

      return true;
    }

    /* ACTIVITY REQUIREMENTS */

    if (group === "activity") {
      const action = (args.shift() || "help").toLowerCase();

      const settings = await getActivitySettings(db, message.guild.id);

      if (action === "messages") {
        const count = Number(args[0]);

        if (!Number.isInteger(count) || count < 1 || count > 10000) {
          await message.reply(
            `Usage: \`${prefix}giveaway activity messages 10\` (1–10000)`,
          );

          return true;
        }

        settings.messages = count;

        await saveActivitySettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Required message count set to **${count}**.\n` +
            `Rule: ${describeActivitySettings(settings)}.`,
        );

        return true;
      }

      if (action === "period") {
        const duration = parseDuration(args[0]);

        if (!duration || duration < DAY || duration > MAX_ACTIVITY_PERIOD) {
          await message.reply(
            `Usage: \`${prefix}giveaway activity period 24h\` or ` +
              `\`${prefix}giveaway activity period 3d\`.\n` +
              "Choose a period from **1 day to 30 days**.",
          );

          return true;
        }

        settings.periodMs = duration;

        await saveActivitySettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Activity period set to **${formatDuration(duration)}**.\n` +
            `Rule: ${describeActivitySettings(settings)}.`,
        );

        return true;
      }

      if (action === "mode") {
        const mode = (args[0] || "").toLowerCase();

        if (!["total", "daily"].includes(mode)) {
          await message.reply(
            `Usage: \`${prefix}giveaway activity mode total\` or ` +
              `\`${prefix}giveaway activity mode daily\``,
          );

          return true;
        }

        settings.mode = mode;

        await saveActivitySettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Activity mode set to **${mode}**.\n` +
            `Rule: ${describeActivitySettings(settings)}.`,
        );

        return true;
      }

      if (action === "on" || action === "off") {
        settings.enabled = action === "on";

        await saveActivitySettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          settings.enabled
            ? `Activity requirement enabled.\nRule: ${describeActivitySettings(settings)}.`
            : "Giveaway activity requirement disabled.",
        );

        return true;
      }

      if (action === "status") {
        await message.reply(
          `**Giveaway Activity Settings**\n` +
            `Enabled: ${settings.enabled ? "Yes" : "No"}\n` +
            `Messages: ${settings.messages}\n` +
            `Mode: ${settings.mode}\n` +
            `Period: ${formatDuration(settings.periodMs)}\n` +
            `Rule: ${describeActivitySettings(settings)}`,
        );

        return true;
      }

      await message.reply(
        [
          "**Giveaway Activity Commands**",
          `\`${prefix}giveaway activity messages 10\` — Set message count`,
          `\`${prefix}giveaway activity period 24h\` — Set a 24-hour period`,
          `\`${prefix}giveaway activity period 3d\` — Set a 3-day period`,
          `\`${prefix}giveaway activity mode total\` — Count messages across the period`,
          `\`${prefix}giveaway activity mode daily\` — Require the count each calendar day`,
          `\`${prefix}giveaway activity on\` — Enable the requirement`,
          `\`${prefix}giveaway activity off\` — Disable the requirement`,
          `\`${prefix}giveaway activity status\` — Show settings`,
        ].join("\n"),
      );

      return true;
    }

    /* KEYWORD PROGRESS SETTINGS */

    if (group === "keyword") {
      const action = (args.shift() || "").toLowerCase();

      const settings = await getSettings(db, message.guild.id);

      if (action === "window") {
        const start = parseClockTime(args[0]);
        const end = parseClockTime(args[1]);

        if (start === null || end === null || start === end) {
          await message.reply(
            [
              "**Keyword Credit Window**",
              `Usage: \`${prefix}giveaway keyword window <start> <end>\``,
              "",
              "Examples:",
              `\`${prefix}giveaway keyword window 12AM 12PM\``,
              `\`${prefix}giveaway keyword window 6AM 10AM\``,
              `\`${prefix}giveaway keyword window 8PM 2AM\``,
              "",
              "Times use Asia/Manila (UTC+8). Start is included; end is excluded.",
            ].join("\n"),
          );

          return true;
        }

        settings.creditStartMinute = start;
        settings.creditEndMinute = end;

        await saveSettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `✅ Keyword credit window set to **${formatClockTime(start)} – ${formatClockTime(end)}** Manila time.\n` +
            "Messages outside this window will not receive keyword credit.",
        );

        return true;
      }

      if (action === "set") {
        const keyword = args.join(" ").trim();

        if (!keyword) {
          await message.reply(
            `Usage: \`${prefix}giveaway keyword set good morning\``,
          );

          return true;
        }

        settings.keyword = keyword;
        settings.enabled = true;

        await saveSettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Keyword set to **${keyword}**. It is tracked for progress only.`,
        );

        return true;
      }

      if (action === "target") {
        const userId =
          message.mentions.users.first()?.id || args[0]?.replace(/[<@!>]/g, "");

        if (!userId || !/^\d{17,20}$/.test(userId)) {
          await message.reply(
            `Usage: \`${prefix}giveaway keyword target @User\``,
          );

          return true;
        }

        settings.targetUserId = userId;
        settings.enabled = true;

        await saveSettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Members can earn keyword progress by mentioning <@${userId}> or replying to their message.`,
        );

        return true;
      }

      if (action === "days") {
        const days = Number(args[0]);

        if (!Number.isInteger(days) || days < 1 || days > 365) {
          await message.reply(
            `Usage: \`${prefix}giveaway keyword days 3\` (1–365)`,
          );

          return true;
        }

        settings.requiredDays = days;
        settings.enabled = true;

        await saveSettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Keyword progress target set to **${days} consecutive days**. This does not affect entry eligibility.`,
        );

        return true;
      }

      if (action === "status") {
        await message.reply(
          `**Keyword Progress Settings**\n` +
            `Enabled: ${settings.enabled ? "Yes" : "No"}\n` +
            `Keyword: ${settings.keyword}\n` +
            `Consecutive days target: ${settings.requiredDays}\n` +
            `Target: ${settings.targetUserId ? `<@${settings.targetUserId}>` : "Not configured"}\n` +
            `Credit window: ${formatClockTime(settings.creditStartMinute)} – ${formatClockTime(settings.creditEndMinute)} Manila time\n` +
            `Entry requirement: No — progress only`,
        );

        return true;
      }

      if (action === "off") {
        settings.enabled = false;

        await saveSettings(db, message.guild.id, settings);

        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply("Keyword progress tracking disabled.");

        return true;
      }

      await message.reply(
        [
          "**Keyword Progress Commands**",
          `\`${prefix}giveaway keyword set good morning\` — Set the keyword`,
          `\`${prefix}giveaway keyword target @User\` — Set the target`,
          `\`${prefix}giveaway keyword days 3\` — Set the streak target`,
          `\`${prefix}giveaway keyword window 12AM 12PM\` — Set allowed credit hours`,
          `\`${prefix}giveaway keyword status\` — Show settings`,
          `\`${prefix}giveaway keyword off\` — Disable tracking`,
          "",
          "Keyword progress is informational and does not block giveaway entries.",
        ].join("\n"),
      );

      return true;
    }

    /* END GIVEAWAY */

    if (group === "end") {
      const mode = (args[0] || "select").toLowerCase();

      const selectWinners = !["none", "no-winner", "nowinner"].includes(mode);

      const result = await endGiveaway(
        client,
        db,
        message.guild.id,
        false,
        selectWinners,
      );

      await message.reply(
        result.ok
          ? selectWinners
            ? `Giveaway ended. ${result.winners.length} winner(s) selected.`
            : "Giveaway ended without selecting winners."
          : result.reason,
      );

      return true;
    }

    /* GIVEAWAY STATUS */

    if (group === "status") {
      const giveaway = await getGiveaway(db, message.guild.id);

      await message.reply(
        giveaway
          ? `**${giveaway.prize}** — ${giveaway.status}\nEntries: ${(giveaway.entries || []).length}`
          : "No giveaway has been created yet.",
      );

      return true;
    }

    /* GENERAL HELP */

    await message.reply(
      [
        "**Giveaway Commands**",
        `\`${prefix}giveaway activity\` — Activity settings`,
        `\`${prefix}giveaway keyword\` — Keyword progress settings`,
        `\`${prefix}giveaway role\` — Required role settings`,
        `\`${prefix}giveaway status\` — Current giveaway status`,
        `\`${prefix}giveaway end\` — End and select winners`,
        `\`${prefix}giveaway end none\` — End without selecting winners`,
      ].join("\n"),
    );

    return true;
  }

  /* -------------------- BUTTON INTERACTIONS -------------------- */

  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction.isButton()) return;

      const parts = interaction.customId.split(":");

      if (parts[0] !== "giveaway") return;

      const action = parts[1];
      const guildId = parts[2];

      if (!interaction.guild || interaction.guild.id !== guildId) {
        await replyPrivately(
          interaction,
          "This button belongs to another server.",
        );

        return;
      }

      const guild = interaction.guild;
      const giveaway = await getGiveaway(db, guildId);

      /* PUBLISH OR CANCEL PREVIEW */

      if (action === "publish" || action === "cancel") {
        const canManage =
          interaction.user.id === guild.ownerId ||
          interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

        if (!canManage) {
          await replyPrivately(
            interaction,
            "Only the server owner or a member with Manage Server permission can do this.",
          );

          return;
        }

        if (!giveaway || giveaway.status !== "draft") {
          await replyPrivately(
            interaction,
            "This giveaway preview is no longer available.",
          );

          return;
        }

        if (action === "cancel") {
          giveaway.status = "cancelled";

          await saveGiveaway(db, guildId, giveaway);

          await interaction.update({
            content: "Giveaway cancelled. Nothing was published.",
            embeds: [],
            components: [],
          });

          return;
        }

        await interaction.deferUpdate();

        try {
          await publishGiveaway(client, db, guild, giveaway);

          await interaction.editReply({
            content: `✅ Giveaway published in <#${giveaway.channelId}>.`,
            embeds: [],
            components: [],
          });
        } catch (error) {
          console.error("[Giveaway publish button]", error);

          await interaction
            .editReply({
              content: `❌ Could not publish the giveaway: ${error.message}`,
              embeds: [],
              components: [],
            })
            .catch(() => {});
        }

        return;
      }

      /* CHECK MEMBER PROGRESS */

      if (action === "progress") {
        if (!giveaway || giveaway.status !== "active") {
          await replyPrivately(
            interaction,
            "This giveaway is no longer active.",
          );

          return;
        }

        if (Number(giveaway.endsAt) <= Date.now()) {
          await replyPrivately(
            interaction,
            "This giveaway has reached its end time. Please wait for the result.",
          );

          return;
        }

        const progressEmbed = await buildMemberProgressEmbed(
          guild,
          giveaway,
          interaction.user.id,
        );

        await interaction.reply({
          embeds: [progressEmbed],
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      /* ENTER GIVEAWAY */

      if (action === "enter") {
        if (!giveaway || giveaway.status !== "active") {
          await replyPrivately(
            interaction,
            "This giveaway is no longer active.",
          );

          return;
        }

        if (Number(giveaway.endsAt) <= Date.now()) {
          await replyPrivately(
            interaction,
            "This giveaway has reached its end time. Please wait for the winner announcement.",
          );

          return;
        }

        if ((giveaway.entries || []).includes(interaction.user.id)) {
          await replyPrivately(
            interaction,
            "You have already entered this giveaway.",
          );

          return;
        }

        const check = await checkEntryRequirements(
          db,
          guild,
          giveaway,
          interaction.user.id,
        );

        if (!check.ok) {
          await replyPrivately(
            interaction,
            `❌ You cannot enter **${giveaway.prize}** yet.\n\n${check.reason}`,
          );

          return;
        }

        giveaway.entries = [
          ...new Set([...(giveaway.entries || []), interaction.user.id]),
        ];

        await saveGiveaway(db, guildId, giveaway);

        await refreshGiveawayMessage(client, db, guildId);

        await replyPrivately(
          interaction,
          `🎉 You have successfully entered **${giveaway.prize}**. Good luck!`,
        );
      }
    } catch (error) {
      console.error("[Giveaway button handler]", error);

      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        await replyPrivately(
          interaction,
          "Something went wrong. Please try again.",
        ).catch(() => {});
      }
    }
  });

  /* -------------------- MESSAGE ACTIVITY / KEYWORD TRACKER -------------------- */

  client.on("messageCreate", async (message) => {
    try {
      if (!message.guild || message.author.bot) {
        return;
      }

      const timestamp = Number(message.createdTimestamp) || Date.now();

      // Record activity messages.
      const key = activityKey(message.guild.id, message.author.id);

      const activity = (await db.get(key)) || {};

      if (!Array.isArray(activity.messages)) {
        activity.messages = [];
      }

      activity.messages.push(timestamp);

      activity.messages = activity.messages
        .map(Number)
        .filter(
          (time) =>
            Number.isFinite(time) &&
            time > 0 &&
            time >= timestamp - MAX_ACTIVITY_PERIOD,
        );

      await db.set(key, activity);

      // Track users who have activity data.
      const usersKey = activityUsersKey(message.guild.id);

      const userIds = (await db.get(usersKey)) || [];

      if (!userIds.includes(message.author.id)) {
        userIds.push(message.author.id);

        await db.set(usersKey, userIds);
      }

      // Keyword tracking is optional and does not affect entry eligibility.
      const settings = await getSettings(db, message.guild.id);

      if (!settings.enabled || !settings.targetUserId) {
        return;
      }

      if (!isWithinKeywordWindow(settings, timestamp)) {
        return;
      }

      if (!containsGiveawayKeyword(message.content, settings.keyword)) {
        return;
      }

      const mentionsTarget = message.mentions.users.has(settings.targetUserId);

      let repliesToTarget = false;

      if (message.reference?.messageId) {
        const referenced = await message.channel.messages
          .fetch(message.reference.messageId)
          .catch(() => null);

        repliesToTarget = referenced?.author?.id === settings.targetUserId;
      }

      if (!mentionsTarget && !repliesToTarget) {
        return;
      }

      const result = await creditKeywordMessage(
        db,
        message.guild.id,
        message.author.id,
        timestamp,
      );

      if (result.credited) {
        await message.react("✅").catch(() => {});

        await message.author
          .send(
            `Your **${settings.keyword}** message was credited!\n` +
              `Progress: **${result.streak}/${settings.requiredDays || 3} days**.\n` +
              "Complete the required consecutive daily credits to enter the giveaway.",
          )
          .catch(() => {});
      }
    } catch (error) {
      console.error("[Giveaway activity tracker]", error);
    }
  });

  /* -------------------- AUTOMATIC GIVEAWAY END -------------------- */

  const timer = setInterval(async () => {
    try {
      for (const [guildId] of client.guilds.cache) {
        const giveaway = await getGiveaway(db, guildId);

        if (
          giveaway?.status === "active" &&
          Number(giveaway.endsAt) > 0 &&
          Number(giveaway.endsAt) <= Date.now()
        ) {
          const result = await endGiveaway(client, db, guildId, false, true);

          if (!result.ok) {
            console.error(`[Giveaway auto-end] ${guildId}: ${result.reason}`);
          }
        }
      }
    } catch (error) {
      console.error("[Giveaway auto-end]", error);
    }
  }, 30_000);

  timer.unref?.();

  return {
    slashCommand: buildGiveawaySlashCommand(),
    handleSlashCommand,
    handlePrefix,
  };
}

/* -------------------- EXPORTS -------------------- */

module.exports = createGiveawayModule;
module.exports.createGiveawayModule = createGiveawayModule;
module.exports.buildGiveawaySlashCommand = buildGiveawaySlashCommand;
