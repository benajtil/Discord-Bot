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

const giveawayKey = (guildId) => `giveaway:${guildId}:current`;
const settingsKey = (guildId) => `giveaway:${guildId}:keywordSettings`;
const activitySettingsKey = (guildId) => `giveaway:${guildId}:activitySettings`;
const activityKey = (guildId, userId) =>
  `giveawayActivity:${guildId}:${userId}`;
const streakKey = (guildId, userId) =>
  `giveaway:${guildId}:keywordStreak:${userId}`;

function localDayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function previousDayKey(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return localDayKey(date.getTime());
}

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
  return (
    (await db.get(settingsKey(guildId))) || {
      enabled: false,
      keyword: "good morning",
      targetUserId: null,
      requiredDays: 3,
    }
  );
}

async function saveSettings(db, guildId, settings) {
  await db.set(settingsKey(guildId), settings);
}

async function getActivitySettings(db, guildId) {
  const saved = await db.get(activitySettingsKey(guildId));

  return {
    enabled: saved?.enabled ?? false,
    messages: Math.max(1, Number(saved?.messages) || 10),
    mode: saved?.mode === "daily" ? "daily" : "total",
    periodMs: Math.min(
      MAX_ACTIVITY_PERIOD,
      Math.max(60_000, Number(saved?.periodMs) || DAY),
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

async function getStreak(db, guildId, userId) {
  const streak = await db.get(streakKey(guildId, userId));

  if (!streak || typeof streak !== "object") {
    return { lastDay: null, count: 0, creditedDays: [] };
  }

  return {
    lastDay: streak.lastDay || null,
    count: Number(streak.count) || 0,
    creditedDays: Array.isArray(streak.creditedDays) ? streak.creditedDays : [],
  };
}

async function creditKeywordMessage(db, guildId, userId) {
  const today = localDayKey();
  const streak = await getStreak(db, guildId, userId);

  if (streak.lastDay === today) {
    return { credited: false, streak: streak.count };
  }

  streak.count =
    streak.lastDay === previousDayKey(today) ? streak.count + 1 : 1;

  streak.lastDay = today;
  streak.creditedDays = [...streak.creditedDays, today].slice(-60);

  await db.set(streakKey(guildId, userId), streak);

  return { credited: true, streak: streak.count };
}

async function isKeywordEligible(db, guildId, userId, settings) {
  if (!settings.enabled) return true;
  if (!settings.targetUserId) return false;

  const streak = await getStreak(db, guildId, userId);

  return (
    streak.lastDay === localDayKey() &&
    streak.count >= Number(settings.requiredDays || 3)
  );
}

/* -------------------- ACTIVITY REQUIREMENTS -------------------- */

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

function describeActivitySettings(settings) {
  if (!settings.enabled) return "Disabled";

  if (settings.mode === "daily") {
    const days = Math.round(settings.periodMs / DAY);

    return `${settings.messages} messages per calendar day for ${days} consecutive calendar day(s)`;
  }

  return `${settings.messages} messages within ${formatDuration(settings.periodMs)}`;
}

function checkActivityEligibility(messages, settings, now = Date.now()) {
  if (!settings.enabled) {
    return { ok: true };
  }

  const validMessages = messages
    .map(Number)
    .filter(
      (time) =>
        Number.isFinite(time) &&
        time > 0 &&
        time <= now &&
        time >= now - MAX_ACTIVITY_PERIOD,
    );

  if (settings.mode === "daily") {
    const daysRequired = Math.max(1, Math.round(settings.periodMs / DAY));
    const countsByDay = new Map();

    for (const timestamp of validMessages) {
      const day = localDayKey(timestamp);
      countsByDay.set(day, (countsByDay.get(day) || 0) + 1);
    }

    let missingDay = null;

    // Check today and each preceding calendar day.
    for (let offset = 0; offset < daysRequired; offset++) {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);

      const day = localDayKey(date.getTime());
      const count = countsByDay.get(day) || 0;

      if (count < settings.messages) {
        missingDay = { day, count };
        break;
      }
    }

    if (missingDay) {
      return {
        ok: false,
        reason:
          `You need at least **${settings.messages} messages per day** ` +
          `for **${daysRequired} consecutive calendar day(s)**. ` +
          `For ${missingDay.day}, you have ${missingDay.count}/${settings.messages} messages.`,
      };
    }

    return { ok: true };
  }

  const cutoff = now - settings.periodMs;
  const count = validMessages.filter((time) => time >= cutoff).length;

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

  // Retain compatibility with older giveaway records.
  if (Number(giveaway.requiredMessages) > 0) {
    requirements.push(
      `• ${giveaway.requiredMessages} messages within ${giveaway.messageDays || 1} day(s)`,
    );
  }

  if (Number(giveaway.requiredActiveDays) > 0) {
    requirements.push(
      `• Active on ${giveaway.requiredActiveDays} day(s) within ${giveaway.activeDaysWithin || 7} day(s)`,
    );
  }

  if (settings?.enabled) {
    requirements.push(
      `• Send **"${settings.keyword}"** for ${settings.requiredDays || 3} consecutive days`,
    );
    requirements.push(
      settings.targetUserId
        ? `• Mention or reply to <@${settings.targetUserId}>`
        : "• Keyword target is not configured",
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
      ? `<t:${Math.floor(endTime / 1000)}:R> (<t:${Math.floor(endTime / 1000)}:f>)`
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
        `**📋 Requirements**\n${requirements.length ? requirements.join("\n") : "No additional requirements."}`,
        "",
        "━━━━━━━━━━━━━━━━━━",
        ended
          ? "This giveaway has ended."
          : "Press **Enter Giveaway** below to check your eligibility.",
      ].join("\n"),
    )
    .setFooter({ text: "Kator6 • Good luck!" });

  if (validEndTime) embed.setTimestamp(new Date(endTime));

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

/* -------------------- REQUIREMENTS -------------------- */

async function checkEntryRequirements(db, guild, giveaway, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);

  if (!member || member.user.bot) {
    return { ok: false, reason: "Bots cannot enter this giveaway." };
  }

  if (
    giveaway.requiredRoleId &&
    !member.roles.cache.has(giveaway.requiredRoleId)
  ) {
    return {
      ok: false,
      reason: `You need the <@&${giveaway.requiredRoleId}> role.`,
    };
  }

  const messages = await getActivityMessages(db, guild.id, userId);
  const activitySettings = await getActivitySettings(db, guild.id);

  const activityCheck = checkActivityEligibility(messages, activitySettings);

  if (!activityCheck.ok) return activityCheck;

  // Legacy requirements remain supported for existing giveaway records.
  if (Number(giveaway.requiredMessages) > 0) {
    const cutoff = Date.now() - Number(giveaway.messageDays || 1) * DAY;
    const count = messages.filter((time) => Number(time) >= cutoff).length;

    if (count < Number(giveaway.requiredMessages)) {
      return {
        ok: false,
        reason:
          `You need ${giveaway.requiredMessages} messages within ` +
          `${giveaway.messageDays || 1} day(s). You currently have ${count}.`,
      };
    }
  }

  if (Number(giveaway.requiredActiveDays) > 0) {
    const cutoff = Date.now() - Number(giveaway.activeDaysWithin || 7) * DAY;

    const activeDays = new Set(
      messages
        .filter((time) => Number(time) >= cutoff)
        .map((time) => localDayKey(Number(time))),
    ).size;

    if (activeDays < Number(giveaway.requiredActiveDays)) {
      return {
        ok: false,
        reason:
          `You need to be active on ${giveaway.requiredActiveDays} different day(s) ` +
          `within ${giveaway.activeDaysWithin || 7} days. You currently have ${activeDays}.`,
      };
    }
  }

  const settings = await getSettings(db, guild.id);

  if (!(await isKeywordEligible(db, guild.id, userId, settings))) {
    const streak = await getStreak(db, guild.id, userId);

    return {
      ok: false,
      reason:
        `You need a ${settings.requiredDays || 3}-day consecutive ` +
        `"${settings.keyword}" streak and today's credit. Your current streak is ${streak.count}.`,
    };
  }

  return { ok: true };
}

async function replyPrivately(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

/* -------------------- PUBLISH / REFRESH -------------------- */

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
  const giveaway = await getGiveaway(db, guildId);

  if (!giveaway || (giveaway.status !== "active" && !reroll)) {
    return { ok: false, reason: "There is no active giveaway to end." };
  }

  if (reroll && giveaway.status !== "ended") {
    return { ok: false, reason: "End the giveaway before rerolling." };
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);

  if (!guild) return { ok: false, reason: "Server not found." };

  const previousWinners = Array.isArray(giveaway.winners)
    ? giveaway.winners
    : [];

  const candidates = [];

  if (selectWinners) {
    for (const userId of giveaway.entries || []) {
      if (previousWinners.includes(userId)) continue;

      const check = await checkEntryRequirements(db, guild, giveaway, userId);
      if (check.ok) candidates.push(userId);
    }
  }

  const selected = [];
  const winnerCount = Math.max(1, Number(giveaway.winnerCount) || 1);

  while (candidates.length && selected.length < winnerCount) {
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
            `🎉 Congratulations ${selected.map((id) => `<@${id}>`).join(", ")}! ` +
            `You won **${giveaway.prize}**!`,
          allowedMentions: { users: selected },
        })
        .catch(() => {});
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

  return { ok: true, winners: selected };
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
              { name: "🎉 Select winner(s)", value: "select" },
              { name: "⏹️ End without a winner", value: "none" },
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

      if (current?.status === "active") {
        await replyPrivately(
          interaction,
          "There is already an active giveaway. End it first.",
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
        `**${giveaway.prize}** — ${giveaway.status}\nEntries: ${(giveaway.entries || []).length}`,
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
            ? `Reroll complete. Additional winner(s): ${result.winners.map((id) => `<@${id}>`).join(", ")}`
            : "Reroll complete, but no additional eligible winners were found."
          : result.reason,
      );
      return true;
    }

    return true;
  }

  async function handlePrefix(message) {
    if (!message.guild || message.author.bot) return false;

    const command = `${prefix}giveaway`;
    const content = message.content.trim();

    if (!content.toLowerCase().startsWith(command.toLowerCase())) return false;

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
    /* ---------- REQUIRED ROLE COMMANDS ---------- */

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

        await message.reply(
          "✅ The required role has been removed. Any member who meets the other requirements can enter.",
        );
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
            "",
            "Example:",
            `\`${prefix}giveaway role @VIP\``,
          ].join("\n"),
        );
        return true;
      }

      const role = await message.guild.roles.fetch(roleId).catch(() => null);

      if (!role || role.id === message.guild.id) {
        await message.reply(
          "❌ I couldn't find that role. Please mention a valid server role.",
        );
        return true;
      }

      giveaway.requiredRoleId = role.id;

      await saveGiveaway(db, message.guild.id, giveaway);
      await refreshGiveawayMessage(client, db, message.guild.id);

      await message.reply(
        `✅ **${role.name}** is now required to enter the giveaway.\n` +
          `Members without <@&${role.id}> cannot enter.`,
      );

      return true;
    }

    /* ---------- ACTIVITY COMMANDS ---------- */

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
          `Required message count set to **${count}**.\nCurrent rule: ${describeActivitySettings(settings)}.`,
        );
        return true;
      }

      if (action === "period") {
        const duration = parseDuration(args[0]);

        if (!duration || duration < DAY || duration > MAX_ACTIVITY_PERIOD) {
          await message.reply(
            `Usage: \`${prefix}giveaway activity period 24h\` or \`${prefix}giveaway activity period 3d\`.\nChoose a period from **1 day to 30 days**.`,
          );
          return true;
        }

        settings.periodMs = duration;
        await saveActivitySettings(db, message.guild.id, settings);
        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Activity period set to **${formatDuration(duration)}**.\nCurrent rule: ${describeActivitySettings(settings)}.`,
        );
        return true;
      }

      if (action === "mode") {
        const mode = (args[0] || "").toLowerCase();

        if (!["total", "daily"].includes(mode)) {
          await message.reply(
            `Usage: \`${prefix}giveaway activity mode total\` or \`${prefix}giveaway activity mode daily\``,
          );
          return true;
        }

        settings.mode = mode;
        await saveActivitySettings(db, message.guild.id, settings);
        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Activity mode set to **${mode}**.\nCurrent rule: ${describeActivitySettings(settings)}.`,
        );
        return true;
      }

      if (action === "on") {
        settings.enabled = true;
        await saveActivitySettings(db, message.guild.id, settings);
        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply(
          `Activity requirement enabled.\nCurrent rule: ${describeActivitySettings(settings)}.`,
        );
        return true;
      }

      if (action === "off") {
        settings.enabled = false;
        await saveActivitySettings(db, message.guild.id, settings);
        await refreshGiveawayMessage(client, db, message.guild.id);

        await message.reply("Giveaway activity requirement disabled.");
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
          `\`${prefix}giveaway activity messages 10\` — Set the message count`,
          `\`${prefix}giveaway activity period 24h\` — Set a 24-hour period`,
          `\`${prefix}giveaway activity period 3d\` — Set a 3-day period`,
          `\`${prefix}giveaway activity mode total\` — Count messages across the period`,
          `\`${prefix}giveaway activity mode daily\` — Require the count each calendar day`,
          `\`${prefix}giveaway activity on\` — Enable the requirement`,
          `\`${prefix}giveaway activity off\` — Disable the requirement`,
          `\`${prefix}giveaway activity status\` — Show settings`,
          "",
          "**Examples**",
          `Total: \`${prefix}giveaway activity messages 10\`, \`${prefix}giveaway activity period 24h\`, \`${prefix}giveaway activity mode total\`, \`${prefix}giveaway activity on\``,
          `Daily: \`${prefix}giveaway activity messages 10\`, \`${prefix}giveaway activity period 3d\`, \`${prefix}giveaway activity mode daily\`, \`${prefix}giveaway activity on\``,
        ].join("\n"),
      );
      return true;
    }

    /* ---------- KEYWORD COMMANDS ---------- */

    if (group === "keyword") {
      const action = (args.shift() || "").toLowerCase();
      const settings = await getSettings(db, message.guild.id);

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
        await message.reply(`Keyword set to **${keyword}**.`);
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
          `Members must mention <@${userId}> or reply to their message.`,
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
          `Required streak set to **${days} consecutive days**.`,
        );
        return true;
      }

      if (action === "status") {
        await message.reply(
          `**Keyword requirement**\nEnabled: ${settings.enabled ? "Yes" : "No"}\n` +
            `Keyword: ${settings.keyword}\nConsecutive days: ${settings.requiredDays}\n` +
            `Target: ${settings.targetUserId ? `<@${settings.targetUserId}>` : "Not configured"}`,
        );
        return true;
      }

      if (action === "off") {
        settings.enabled = false;
        await saveSettings(db, message.guild.id, settings);
        await refreshGiveawayMessage(client, db, message.guild.id);
        await message.reply("Keyword requirement disabled.");
        return true;
      }

      await message.reply(
        `**Keyword commands**\n\`${prefix}giveaway keyword set good morning\`\n` +
          `\`${prefix}giveaway keyword target @User\`\n` +
          `\`${prefix}giveaway keyword days 3\`\n` +
          `\`${prefix}giveaway keyword status\`\n\`${prefix}giveaway keyword off\``,
      );
      return true;
    }

    /* ---------- END / STATUS ---------- */

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
            : "Giveaway ended without selecting a winner."
          : result.reason,
      );
      return true;
    }

    if (group === "status") {
      const giveaway = await getGiveaway(db, message.guild.id);

      await message.reply(
        giveaway
          ? `**${giveaway.prize}** — ${giveaway.status}\nEntries: ${(giveaway.entries || []).length}`
          : "No giveaway has been created yet.",
      );
      return true;
    }

    await message.reply(
      `**Giveaway commands**\n` +
        `\`${prefix}giveaway activity\`\n` +
        `\`${prefix}giveaway keyword\`\n` +
        `\`${prefix}giveaway status\`\n` +
        `\`${prefix}giveaway end\` or \`${prefix}giveaway end none\``,
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
            "This giveaway has ended. Please wait for the winner announcement.",
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
      if (!message.guild || message.author.bot) return;

      const now = Date.now();
      const key = activityKey(message.guild.id, message.author.id);
      const activity = (await db.get(key)) || {};

      if (!Array.isArray(activity.messages)) activity.messages = [];

      activity.messages.push(now);
      activity.messages = activity.messages.filter(
        (time) => Number(time) >= now - MAX_ACTIVITY_PERIOD,
      );

      await db.set(key, activity);

      const settings = await getSettings(db, message.guild.id);

      if (!settings.enabled || !settings.targetUserId) return;
      if (!containsGiveawayKeyword(message.content, settings.keyword)) return;

      const mentionsTarget = message.mentions.users.has(settings.targetUserId);
      let repliesToTarget = false;

      if (message.reference?.messageId) {
        const referenced = await message.channel.messages
          .fetch(message.reference.messageId)
          .catch(() => null);

        repliesToTarget = referenced?.author?.id === settings.targetUserId;
      }

      if (!mentionsTarget && !repliesToTarget) return;

      const result = await creditKeywordMessage(
        db,
        message.guild.id,
        message.author.id,
      );

      if (result.credited) {
        await message.react("✅").catch(() => {});

        await message.author
          .send(
            `Your **${settings.keyword}** message was credited!\n` +
              `Streak: **${result.streak}/${settings.requiredDays || 3} days**.`,
          )
          .catch(() => {});
      }
    } catch (error) {
      console.error("[Giveaway activity tracker]", error);
    }
  });

  /* -------------------- AUTO-END -------------------- */

  const timer = setInterval(async () => {
    try {
      for (const [guildId] of client.guilds.cache) {
        const giveaway = await getGiveaway(db, guildId);

        if (
          giveaway?.status === "active" &&
          Number(giveaway.endsAt) <= Date.now()
        ) {
          // Preserve your existing behavior: auto-end without selecting winners.
          await endGiveaway(client, db, guildId, false, false);
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

module.exports = {
  createGiveawayModule,
  buildGiveawaySlashCommand,
};
