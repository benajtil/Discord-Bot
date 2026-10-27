const {
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const DAY = 24 * 60 * 60 * 1000;
const ENTRY_EMOJI = "🎉";
const EMBED_COLOR = 0x8b5cf6;

const giveawayKey = (guildId) => `giveaway:${guildId}:current`;
const settingsKey = (guildId) => `giveaway:${guildId}:keywordSettings`;
const streakKey = (guildId, userId) =>
  `giveaway:${guildId}:keywordStreak:${userId}`;

function localDayKey(timestamp = Date.now()) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function previousDayKey(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() - 1);
  return localDayKey(d.getTime());
}

function parseDuration(value) {
  const match = String(value)
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

function containsGiveawayKeyword(messageContent, keyword) {
  const normalizedKeyword = normalizeKeyword(keyword);
  return (
    normalizedKeyword.length > 0 &&
    normalizeKeyword(messageContent).includes(normalizedKeyword)
  );
}

function durationText(ms) {
  if (ms >= DAY) return `${Math.floor(ms / DAY)} day(s)`;
  if (ms >= 3_600_000) return `${Math.floor(ms / 3_600_000)} hour(s)`;
  return `${Math.max(1, Math.floor(ms / 60_000))} minute(s)`;
}

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

async function getGiveaway(db, guildId) {
  return db.get(giveawayKey(guildId));
}

async function saveGiveaway(db, guildId, giveaway) {
  await db.set(giveawayKey(guildId), giveaway);
}

async function getStreak(db, guildId, userId) {
  return (
    (await db.get(streakKey(guildId, userId))) || {
      lastDay: null,
      count: 0,
      creditedDays: [],
    }
  );
}

async function creditKeywordMessage(db, guildId, userId) {
  const today = localDayKey();
  const streak = await getStreak(db, guildId, userId);

  // Only one credit is allowed per user per calendar day.
  if (streak.lastDay === today) {
    return {
      credited: false,
      streak: streak.count,
      reason: "already-counted",
    };
  }

  streak.count =
    streak.lastDay === previousDayKey(today) ? streak.count + 1 : 1;

  streak.lastDay = today;
  streak.creditedDays = [...(streak.creditedDays || []), today].slice(-60);

  await db.set(streakKey(guildId, userId), streak);
  return { credited: true, streak: streak.count };
}

async function isKeywordEligible(db, guildId, userId, settings) {
  if (!settings.enabled) return true;
  if (!settings.targetUserId) return false;

  const streak = await getStreak(db, guildId, userId);

  // Require today's credit and the configured consecutive-day count.
  return (
    streak.lastDay === localDayKey() &&
    streak.count >= Number(settings.requiredDays || 3)
  );
}

function makeGiveawayEmbed(giveaway, guild, settings = {}) {
  const ended = giveaway.status !== "active";
  const endTimestamp = Math.floor(giveaway.endsAt / 1000);
  const entryCount = (giveaway.entries || []).length;

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x64748b : EMBED_COLOR)
    .setAuthor({
      name: `${guild.name} • COMMUNITY GIVEAWAY`,
      iconURL: guild.iconURL({ size: 128 }) || undefined,
    })
    .setTitle(`${ended ? "🏁" : "🎁"} ${giveaway.prize || "Mystery Prize"}`)
    .setDescription(
      ended
        ? "This giveaway has ended. Thank you for participating!"
        : [
            "### ✨ Your next win could start here",
            "React with 🎉 below to enter.",
            "",
            `**🏆 Winners:** ${giveaway.winnerCount}`,
            `**⏳ Time remaining:** <t:${endTimestamp}:R>`,
          ].join("\n"),
    )
    .addFields(
      {
        name: "👑 HOST",
        value: `<@${giveaway.hostId}>`,
        inline: true,
      },
      {
        name: "🎟️ ENTRIES",
        value: String(entryCount),
        inline: true,
      },
      {
        name: "📌 STATUS",
        value: ended ? "Ended" : "Accepting entries",
        inline: true,
      },
      {
        name: "📍 CHANNEL",
        value: `<#${giveaway.channelId}>`,
        inline: true,
      },
      {
        name: "🗓️ ENDS",
        value: `<t:${endTimestamp}:F>`,
        inline: true,
      },
      {
        name: "🏅 WINNERS",
        value: (giveaway.winners || []).length
          ? giveaway.winners.map((id) => `<@${id}>`).join(", ")
          : `${giveaway.winnerCount} winner(s) will be selected`,
        inline: true,
      },
    );

  const requirements = [];

  if (giveaway.requiredRoleId) {
    requirements.push(`• Have the <@&${giveaway.requiredRoleId}> role`);
  }

  if (Number(giveaway.requiredMessages) > 0) {
    requirements.push(
      `• Send ${giveaway.requiredMessages} messages within ${giveaway.messageDays || 1} day(s)`,
    );
  }

  if (Number(giveaway.requiredActiveDays) > 0) {
    requirements.push(
      `• Be active on ${giveaway.requiredActiveDays} day(s) within ${giveaway.activeDaysWithin || 7} day(s)`,
    );
  }

  if (settings.enabled) {
    requirements.push(
      `• Send **${settings.keyword}** for ${settings.requiredDays} consecutive day(s)`,
      `• Mention <@${settings.targetUserId}> or reply to their message`,
      "• Only one keyword credit per day",
    );
  }

  embed.addFields({
    name: "🔐 HOW TO QUALIFY",
    value: requirements.length
      ? requirements.join("\n")
      : "No extra requirements. Everyone can join!",
    inline: false,
  });

  embed.setFooter({
    text: "Kator6 • Fair entries • Powered by Ysabelle",
  });
  embed.setTimestamp(giveaway.createdAt || Date.now());

  return embed;
}

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

  const activityKey = `giveawayActivity:${guild.id}:${userId}`;
  const activity = await db.get(activityKey);
  const messages = activity?.messages || [];

  if (Number(giveaway.requiredMessages) > 0) {
    const cutoff = Date.now() - Number(giveaway.messageDays || 1) * DAY;
    const count = messages.filter((time) => time >= cutoff).length;

    if (count < giveaway.requiredMessages) {
      return {
        ok: false,
        reason: `You need ${giveaway.requiredMessages} messages within ${giveaway.messageDays || 1} day(s).`,
      };
    }
  }

  if (Number(giveaway.requiredActiveDays) > 0) {
    const cutoff = Date.now() - Number(giveaway.activeDaysWithin || 7) * DAY;
    const activeDays = new Set(
      messages
        .filter((time) => time >= cutoff)
        .map((time) => localDayKey(time)),
    ).size;

    if (activeDays < giveaway.requiredActiveDays) {
      return {
        ok: false,
        reason: `You need ${giveaway.requiredActiveDays} active day(s) within ${giveaway.activeDaysWithin || 7} day(s).`,
      };
    }
  }

  const settings = await getSettings(db, guild.id);

  if (!(await isKeywordEligible(db, guild.id, userId, settings))) {
    const streak = await getStreak(db, guild.id, userId);
    return {
      ok: false,
      reason: `You need ${settings.requiredDays} consecutive days of "${settings.keyword}" and must earn today's credit. Current streak: ${streak.count || 0}.`,
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

  await message
    .edit({
      embeds: [makeGiveawayEmbed(giveaway, guild, settings)],
    })
    .catch(() => {});
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
  const message = await channel.send({
    embeds: [makeGiveawayEmbed(giveaway, guild, settings)],
  });

  giveaway.messageId = message.id;
  giveaway.status = "active";
  await saveGiveaway(db, guild.id, giveaway);
  await message.react(ENTRY_EMOJI);

  return message;
}

async function endGiveaway(client, db, guildId, reroll = false) {
  const giveaway = await getGiveaway(db, guildId);

  if (!giveaway || (giveaway.status !== "active" && !reroll)) {
    return { ok: false, reason: "There is no active giveaway to end." };
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, reason: "Server not found." };

  const candidates = [];

  for (const userId of giveaway.entries || []) {
    if ((giveaway.winners || []).includes(userId)) continue;

    const check = await checkEntryRequirements(db, guild, giveaway, userId);
    if (check.ok) candidates.push(userId);
  }

  const selected = [];

  while (candidates.length && selected.length < giveaway.winnerCount) {
    const index = Math.floor(Math.random() * candidates.length);
    selected.push(candidates.splice(index, 1)[0]);
  }

  giveaway.winners = reroll
    ? [...(giveaway.winners || []), ...selected]
    : selected;

  if (!reroll) {
    giveaway.status = "ended";
    giveaway.endedAt = Date.now();
  }

  await saveGiveaway(db, guildId, giveaway);
  await refreshGiveawayMessage(client, db, guildId);

  const channel = await guild.channels
    .fetch(giveaway.channelId)
    .catch(() => null);

  if (channel?.isTextBased() && selected.length) {
    await channel
      .send({
        content: `🎉 Congratulations ${selected.map((id) => `<@${id}>`).join(", ")}! You won **${giveaway.prize}**!`,
        allowedMentions: { users: selected },
      })
      .catch(() => {});
  } else if (channel?.isTextBased()) {
    await channel
      .send("No eligible winners could be selected.")
      .catch(() => {});
  }

  return { ok: true, winners: selected };
}

function buildGiveawaySlashCommand() {
  return new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a giveaway")
        .addStringOption((o) =>
          o.setName("prize").setDescription("Prize").setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Posting channel")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("duration")
            .setDescription("Example: 30m, 2h, 3d")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("winners")
            .setDescription("Number of winners")
            .setMinValue(1)
            .setMaxValue(20)
            .setRequired(true),
        )
        .addRoleOption((o) =>
          o.setName("required_role").setDescription("Role required to enter"),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show the current giveaway"),
    )
    .addSubcommand((sub) =>
      sub.setName("end").setDescription("End the current giveaway"),
    )
    .addSubcommand((sub) =>
      sub.setName("reroll").setDescription("Select additional winner(s)"),
    );
}

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
    )
      return false;

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
      };

      await saveGiveaway(db, guild.id, giveaway);

      try {
        await publishGiveaway(client, db, guild, giveaway);
        await replyPrivately(
          interaction,
          `Giveaway published in <#${channel.id}>.`,
        );
      } catch (error) {
        giveaway.status = "draft";
        await saveGiveaway(db, guild.id, giveaway);
        await replyPrivately(
          interaction,
          `Could not publish: ${error.message}`,
        );
      }

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
      const result = await endGiveaway(client, db, guild.id);
      await replyPrivately(
        interaction,
        result.ok ? "Giveaway ended." : result.reason,
      );
      return true;
    }

    if (sub === "reroll") {
      const result = await endGiveaway(client, db, guild.id, true);
      await replyPrivately(
        interaction,
        result.ok ? "Reroll complete." : result.reason,
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

    const remainder = content.slice(command.length).trim();
    const args = remainder ? remainder.split(/\s+/) : [];
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
        await message.reply(
          `✅ Keyword set to **${keyword}**. Capitalization and spacing variations are accepted.`,
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
          `✅ Members must mention <@${userId}> or reply to their message.`,
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
          `✅ Required streak set to **${days} consecutive days**.`,
        );
        return true;
      }

      if (action === "status") {
        await message.reply(
          `**Keyword requirement**\n` +
            `Enabled: ${settings.enabled ? "Yes" : "No"}\n` +
            `Keyword: ${settings.keyword}\n` +
            `Consecutive days: ${settings.requiredDays}\n` +
            `Target: ${settings.targetUserId ? `<@${settings.targetUserId}>` : "Not configured"}`,
        );
        return true;
      }

      if (action === "off") {
        settings.enabled = false;
        await saveSettings(db, message.guild.id, settings);
        await refreshGiveawayMessage(client, db, message.guild.id);
        await message.reply("✅ Keyword requirement disabled.");
        return true;
      }

      await message.reply(
        `**Keyword commands**\n` +
          `\`${prefix}giveaway keyword set good morning\` — set keyword\n` +
          `\`${prefix}giveaway keyword target @User\` — set who to mention/reply to\n` +
          `\`${prefix}giveaway keyword days 3\` — set required streak\n` +
          `\`${prefix}giveaway keyword status\` — view settings\n` +
          `\`${prefix}giveaway keyword off\` — disable requirement`,
      );
      return true;
    }

    if (group === "end") {
      const result = await endGiveaway(client, db, message.guild.id);
      await message.reply(result.ok ? "Giveaway ended." : result.reason);
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
        `\`${prefix}giveaway keyword\` — configure keyword requirement\n` +
        `\`${prefix}giveaway status\`\n` +
        `\`${prefix}giveaway end\``,
    );
    return true;
  }

  // Keyword streak tracker and message activity tracker.
  client.on("messageCreate", async (message) => {
    try {
      if (!message.guild || message.author.bot) return;

      const now = Date.now();
      const activityKey = `giveawayActivity:${message.guild.id}:${message.author.id}`;
      const activity = (await db.get(activityKey)) || { messages: [] };

      activity.messages.push(now);
      activity.messages = activity.messages.filter(
        (time) => time >= now - 30 * DAY,
      );

      await db.set(activityKey, activity);

      const settings = await getSettings(db, message.guild.id);

      if (!settings.enabled || !settings.targetUserId) return;

      // Fixed bug: use settings.keyword, not the undefined giveaway.keyword.
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
            `🌤️ Your **${settings.keyword}** message was credited!\n` +
              `Streak: **${result.streak}/${settings.requiredDays} days**.`,
          )
          .catch(() => {});
      }
    } catch (error) {
      console.error("[Giveaway keyword tracker]", error);
    }
  });

  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      const guild = reaction.message.guild;
      if (!guild || reaction.emoji.name !== ENTRY_EMOJI) return;

      const giveaway = await getGiveaway(db, guild.id);

      if (
        !giveaway ||
        giveaway.status !== "active" ||
        giveaway.messageId !== reaction.message.id
      )
        return;

      const check = await checkEntryRequirements(db, guild, giveaway, user.id);

      if (!check.ok) {
        await reaction.users.remove(user.id).catch(() => {});

        await user
          .send(
            `You are not eligible for **${giveaway.prize}** yet.\n${check.reason}`,
          )
          .catch(async () => {
            const warning = await reaction.message.channel
              .send(`<@${user.id}> You cannot enter yet: ${check.reason}`)
              .catch(() => null);

            if (warning)
              setTimeout(() => warning.delete().catch(() => {}), 10_000);
          });

        return;
      }

      giveaway.entries = [...new Set([...(giveaway.entries || []), user.id])];
      await saveGiveaway(db, guild.id, giveaway);
      await refreshGiveawayMessage(client, db, guild.id);
    } catch (error) {
      console.error("[Giveaway reaction add]", error);
    }
  });

  client.on("messageReactionRemove", async (reaction, user) => {
    try {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();

      const guild = reaction.message.guild;
      if (!guild || reaction.emoji.name !== ENTRY_EMOJI) return;

      const giveaway = await getGiveaway(db, guild.id);

      if (!giveaway || giveaway.messageId !== reaction.message.id) return;

      giveaway.entries = (giveaway.entries || []).filter(
        (id) => id !== user.id,
      );
      await saveGiveaway(db, guild.id, giveaway);
      await refreshGiveawayMessage(client, db, guild.id);
    } catch (error) {
      console.error("[Giveaway reaction remove]", error);
    }
  });

  const timer = setInterval(async () => {
    try {
      for (const [guildId] of client.guilds.cache) {
        const giveaway = await getGiveaway(db, guildId);

        if (giveaway?.status === "active" && giveaway.endsAt <= Date.now()) {
          await endGiveaway(client, db, guildId);
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
