const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const EMOJI = "🎉";
const DAY = 24 * 60 * 60 * 1000;
const TIME_ZONE = "Asia/Manila";

const activityUsersKey = (guildId) => `giveawayActivityUsers:${guildId}`;

function manilaParts(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function manilaDay(timestamp = Date.now()) {
  const p = manilaParts(timestamp);
  return `${p.year}-${p.month}-${p.day}`;
}

function manilaDayOffset(daysAgo = 0) {
  return manilaDay(Date.now() - daysAgo * DAY);
}

function progressBar(current, target, size = 10) {
  const filled = Math.max(
    0,
    Math.min(
      size,
      Math.floor(
        ((Number(current) || 0) / Math.max(1, Number(target) || 1)) * size,
      ),
    ),
  );

  return `${"█".repeat(filled)}${"░".repeat(size - filled)}`;
}

function hourLabel(hour) {
  if (hour === 24) return "12:00 AM (midnight)";
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

function buildGiveawaySlashCommand() {
  return new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("create").setDescription("Create a giveaway draft"),
    )
    .addSubcommand((s) =>
      s
        .setName("prize")
        .setDescription("Set the giveaway prize")
        .addStringOption((o) =>
          o
            .setName("text")
            .setDescription("Prize description")
            .setRequired(true)
            .setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Choose where to post the giveaway")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Text channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("ends")
        .setDescription("Set the ending date and time")
        .addStringOption((o) =>
          o
            .setName("datetime")
            .setDescription("ISO date/time, e.g. 2026-12-31T20:00:00+08:00")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("winners")
        .setDescription("Set the number of winners")
        .addIntegerOption((o) =>
          o
            .setName("count")
            .setDescription("Number of winners")
            .setMinValue(1)
            .setMaxValue(20)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("requirement-messages")
        .setDescription("Set minimum messages within a number of days")
        .addIntegerOption((o) =>
          o
            .setName("count")
            .setDescription("Minimum messages; 0 disables")
            .setMinValue(0)
            .setMaxValue(100000)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("days")
            .setDescription("Lookback period in days")
            .setMinValue(1)
            .setMaxValue(365)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("requirement-days")
        .setDescription("Set minimum distinct active days")
        .addIntegerOption((o) =>
          o
            .setName("count")
            .setDescription("Active days; 0 disables")
            .setMinValue(0)
            .setMaxValue(365)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("within")
            .setDescription("Days to check")
            .setMinValue(1)
            .setMaxValue(365)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("requirement-role")
        .setDescription("Require a role; omit to clear")
        .addRoleOption((o) =>
          o.setName("role").setDescription("Required role").setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s.setName("preview").setDescription("Preview the giveaway draft"),
    )
    .addSubcommand((s) =>
      s
        .setName("publish")
        .setDescription("Publish the giveaway and open entries"),
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("Show giveaway status"),
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("End the active giveaway now"),
    )
    .addSubcommand((s) =>
      s.setName("reroll").setDescription("Choose a replacement winner"),
    )
    .addSubcommand((s) =>
      s
        .setName("reset")
        .setDescription("Delete the giveaway draft and settings"),
    );
}

function parseDate(input) {
  const time = Date.parse(input);
  return Number.isFinite(time) ? time : null;
}

function hasManagePermission(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

function safeText(text) {
  return String(text ?? "")
    .replace(/@everyone/g, "@\u200beveryone")
    .replace(/@here/g, "@\u200bhere");
}

function createEmbed(giveaway, guild) {
  const end = giveaway.endsAt
    ? `<t:${Math.floor(giveaway.endsAt / 1000)}:F> (<t:${Math.floor(giveaway.endsAt / 1000)}:R>)`
    : "Not set";

  const role = giveaway.requirements.roleId
    ? `<@&${giveaway.requirements.roleId}>`
    : "None";

  const messages = giveaway.requirements.messages.count
    ? `${giveaway.requirements.messages.count} messages in ${giveaway.requirements.messages.days} day(s)`
    : "Disabled";

  const activeDays = giveaway.requirements.activeDays.count
    ? `${giveaway.requirements.activeDays.count} active day(s) in ${giveaway.requirements.activeDays.within} day(s)`
    : "Disabled";

  return new EmbedBuilder()
    .setColor(giveaway.status === "active" ? 0x57f287 : 0x8b5cf6)
    .setTitle(`🎉 Giveaway: ${safeText(giveaway.prize || "Prize not set")}`)
    .setDescription(
      "React with 🎉 below to enter. Your eligibility will be checked automatically.",
    )
    .addFields(
      {
        name: "Hosted by",
        value: `<@${giveaway.hostId}>`,
        inline: true,
      },
      {
        name: "Winners",
        value: String(giveaway.winnerCount || 1),
        inline: true,
      },
      {
        name: "Status",
        value: giveaway.status,
        inline: true,
      },
      { name: "Ends", value: end },
      { name: "Required role", value: role, inline: true },
      { name: "Message activity", value: messages, inline: true },
      { name: "Active days", value: activeDays, inline: true },
      {
        name: "Entries",
        value: String(giveaway.entries?.length || 0),
        inline: true,
      },
    )
    .setFooter({
      text: `${guild.name} • Ineligible reactions are removed`,
    })
    .setTimestamp();
}

module.exports = function createGiveawayModule(client, db, prefix = "!") {
  const key = (guildId) => `giveaway:${guildId}:current`;

  const activityKey = (guildId, userId) =>
    `giveawayActivity:${guildId}:${userId}`;

  const keywordSettingsKey = (guildId) => `giveawayKeywordSettings:${guildId}`;

  const keywordKey = (guildId, userId) =>
    `giveawayKeyword:${guildId}:${userId}`;

  async function getKeywordSettings(guildId) {
    return (
      (await db.get(keywordSettingsKey(guildId))) || {
        phrase: "good morning",
        startHour: 1,
        endHour: 12,
        enabled: true,
      }
    );
  }

  async function getKeywordData(guildId, userId) {
    return (
      (await db.get(keywordKey(guildId, userId))) || {
        streak: 0,
        lastDay: null,
        lastCreditedAt: null,
        creditedDays: [],
      }
    );
  }

  // Prevent duplicate event listeners if the module is initialized more than once.
  const seenClients =
    createGiveawayModule._clients ||
    (createGiveawayModule._clients = new WeakSet());

  if (seenClients.has(client)) {
    return {
      slashCommand: buildGiveawaySlashCommand(),
      handlePrefixCommand: async () => false,
    };
  }

  seenClients.add(client);

  async function getGiveaway(guildId) {
    return (await db.get(key(guildId))) || null;
  }

  async function saveGiveaway(guildId, giveaway) {
    await db.set(key(guildId), giveaway);
  }

  // Record messages by Manila calendar day and retain recent history.
  async function recordActivity(message) {
    if (!message.guild || message.author.bot) return;

    const guildId = message.guild.id;
    const userId = message.author.id;
    const k = activityKey(guildId, userId);

    const data = (await db.get(k)) || {
      total: 0,
      days: {},
    };

    const today = manilaDay();

    data.total = (Number(data.total) || 0) + 1;

    if (!data.days || typeof data.days !== "object") {
      data.days = {};
    }

    data.days[today] = (Number(data.days[today]) || 0) + 1;

    const cutoff = manilaDayOffset(366);

    for (const date of Object.keys(data.days)) {
      if (date < cutoff) delete data.days[date];
    }

    await db.set(k, data);

    const usersKey = activityUsersKey(guildId);
    const users = (await db.get(usersKey)) || [];

    if (!users.includes(userId)) {
      users.push(userId);
      await db.set(usersKey, users);
    }

    // Keyword credit is optional and never part of giveaway eligibility.
    const settings = await getKeywordSettings(guildId);
    const parts = manilaParts();
    const currentHour = Number(parts.hour);
    const content = String(message.content || "").toLowerCase();
    const phrase = String(settings.phrase || "")
      .trim()
      .toLowerCase();

    const withinWindow =
      currentHour >= settings.startHour && currentHour < settings.endHour;

    if (
      settings.enabled &&
      phrase &&
      withinWindow &&
      content.includes(phrase)
    ) {
      const keywordData = await getKeywordData(guildId, userId);

      // Do not credit the same member twice on the same day.
      if (keywordData.lastDay !== today) {
        const yesterday = manilaDayOffset(1);

        keywordData.streak =
          keywordData.lastDay === yesterday
            ? (Number(keywordData.streak) || 0) + 1
            : 1;

        keywordData.lastDay = today;
        keywordData.lastCreditedAt = Date.now();

        keywordData.creditedDays = [
          ...(keywordData.creditedDays || []).filter((date) => date !== today),
          today,
        ].slice(-366);

        await db.set(keywordKey(guildId, userId), keywordData);
      }
    }
  }

  async function eligibility(guild, userId, giveaway) {
    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member || member.user.bot) {
      return {
        ok: false,
        reason: "Only current server members can enter.",
      };
    }

    const req = giveaway.requirements || {};
    const messageReq = req.messages || { count: 0, days: 7 };
    const activeDaysReq = req.activeDays || { count: 0, within: 7 };

    if (req.roleId && !member.roles.cache.has(req.roleId)) {
      return {
        ok: false,
        reason: `You need the <@&${req.roleId}> role.`,
      };
    }

    const data = (await db.get(activityKey(guild.id, userId))) || {
      total: 0,
      days: {},
    };

    if (Number(messageReq.count) > 0) {
      const cutoff = manilaDayOffset(messageReq.days);

      const count = Object.entries(data.days || {}).reduce(
        (sum, [date, value]) =>
          date >= cutoff ? sum + Number(value || 0) : sum,
        0,
      );

      if (count < messageReq.count) {
        return {
          ok: false,
          reason: `You need **${messageReq.count} messages** within the last ${messageReq.days} day(s). Your recorded count is **${count}**.`,
        };
      }
    }

    if (Number(activeDaysReq.count) > 0) {
      const cutoff = manilaDayOffset(activeDaysReq.within);

      const count = Object.entries(data.days || {}).filter(
        ([date, value]) => date >= cutoff && Number(value) > 0,
      ).length;

      if (count < activeDaysReq.count) {
        return {
          ok: false,
          reason: `You need to be active on **${activeDaysReq.count} different days** within ${activeDaysReq.within} day(s). Your recorded active days: **${count}**.`,
        };
      }
    }

    // Intentionally no keyword check here.
    // Members do not need keyword credit to enter or win.
    return { ok: true };
  }

  async function sendProgress(message) {
    const guildId = message.guild.id;
    const userId = message.author.id;
    const today = manilaDay();

    const activity = (await db.get(activityKey(guildId, userId))) || {
      total: 0,
      days: {},
    };

    const daily = Number(activity.days?.[today]) || 0;
    const settings = await getKeywordSettings(guildId);
    const keyword = await getKeywordData(guildId, userId);
    const giveaway = await getGiveaway(guildId);

    const messageReq = giveaway?.requirements?.messages || {
      count: 0,
      days: 7,
    };

    const requiredMessages = Number(messageReq.count) || 0;
    const lookbackDays = Number(messageReq.days) || 7;
    const cutoff = manilaDayOffset(lookbackDays);

    const recentMessages = Object.entries(activity.days || {})
      .filter(([date]) => date >= cutoff)
      .reduce((sum, [, count]) => sum + Number(count || 0), 0);

    const activityOk = !requiredMessages || recentMessages >= requiredMessages;

    const activeDaysReq = giveaway?.requirements?.activeDays || {
      count: 0,
      within: 7,
    };

    const requiredActiveDays = Number(activeDaysReq.count) || 0;
    const activeDaysWindow = Number(activeDaysReq.within) || 7;
    const activeCutoff = manilaDayOffset(activeDaysWindow);

    const recentActiveDays = Object.entries(activity.days || {}).filter(
      ([date, count]) => date >= activeCutoff && Number(count) > 0,
    ).length;

    const activeDaysOk =
      !requiredActiveDays || recentActiveDays >= requiredActiveDays;

    const roleId = giveaway?.requirements?.roleId;

    const member = await message.guild.members.fetch(userId).catch(() => null);

    const roleOk = !roleId || Boolean(member?.roles.cache.has(roleId));
    const keywordCreditedToday = keyword.lastDay === today;

    const lastCredited = keyword.lastCreditedAt
      ? `<t:${Math.floor(keyword.lastCreditedAt / 1000)}:t> on ${new Date(
          keyword.lastCreditedAt,
        ).toLocaleDateString("en-PH", {
          timeZone: TIME_ZONE,
        })}`
      : "Never";

    const overall = roleOk && activityOk && activeDaysOk;

    const lines = [
      `**Daily Activity — ${today} (Philippine time)**`,
      `${
        requiredMessages
          ? progressBar(recentMessages, requiredMessages)
          : progressBar(daily, Math.max(daily, 1))
      } **${
        requiredMessages
          ? `${recentMessages}/${requiredMessages} messages in the last ${lookbackDays} day(s)`
          : `${daily} messages today (no message requirement configured)`
      }**`,
      "",
      `**Required Role:** ${roleOk ? "✅" : "❌"} ${
        roleId ? `<@&${roleId}>` : "No role required"
      }`,
      `**Active days:** ${activeDaysOk ? "✅" : "❌"} ${
        requiredActiveDays
          ? `${recentActiveDays}/${requiredActiveDays} in the last ${activeDaysWindow} day(s)`
          : "No active-day requirement configured"
      }`,
      "",
      `**Keyword:** \`${safeText(settings.phrase)}\``,
      `${progressBar(keywordCreditedToday ? 1 : 0, 1)} ${
        keywordCreditedToday ? "✅ Credited today" : "❌ Not credited today"
      }`,
      `**Current streak:** ${keyword.streak || 0} day(s)`,
      `**Last credited:** ${lastCredited}`,
      `**Credit window:** ${hourLabel(
        settings.startHour,
      )} to just before ${hourLabel(settings.endHour)}, Manila time`,
      "",
      "**Giveaway eligibility checks:**",
      `Message activity: ${activityOk ? "✅" : "❌"}`,
      `Required role: ${roleOk ? "✅" : "❌"}`,
      `Active days: ${activeDaysOk ? "✅" : "❌"}`,
      `**Overall eligibility checks: ${
        overall ? "✅ Passed" : "❌ Not yet eligible"
      }**`,
      "_Keyword credit is optional. You can enter the giveaway without it if you meet the configured role and activity requirements._",
      "_If no giveaway exists, activity requirements are treated as disabled._",
    ];

    return message.reply(lines.join("\n"));
  }

  async function sendLeaderboard(message) {
    const userIds = (await db.get(activityUsersKey(message.guild.id))) || [];

    const today = manilaDay();
    const rows = [];

    for (const userId of userIds) {
      const data = (await db.get(activityKey(message.guild.id, userId))) || {
        days: {},
      };

      rows.push({
        userId,
        count: Number(data.days?.[today]) || 0,
      });
    }

    rows.sort((a, b) => b.count - a.count);

    const top = rows.filter((row) => row.count > 0).slice(0, 10);

    if (!top.length) {
      return message.reply(
        `No messages have been recorded today (${today}, Manila time).`,
      );
    }

    return message.reply(
      `**Daily Activity Leaderboard — ${today} (Manila time)**\n` +
        top
          .map(
            (row, index) =>
              `**${index + 1}.** <@${row.userId}> — **${row.count}** message(s)`,
          )
          .join("\n"),
    );
  }

  async function postOrEdit(guild, giveaway) {
    const channel = await guild.channels
      .fetch(giveaway.channelId)
      .catch(() => null);

    if (!channel?.isTextBased() || !channel.messages) {
      throw new Error("Giveaway channel is missing or is not a text channel.");
    }

    const embed = createEmbed(giveaway, guild);

    if (giveaway.messageId) {
      const old = await channel.messages
        .fetch(giveaway.messageId)
        .catch(() => null);

      if (old) {
        await old.edit({ embeds: [embed] });
        return old;
      }
    }

    const message = await channel.send({ embeds: [embed] });

    giveaway.messageId = message.id;
    giveaway.channelId = channel.id;

    await message.react(EMOJI);
    await saveGiveaway(guild.id, giveaway);

    return message;
  }

  async function publish(guild, giveaway) {
    if (!giveaway.prize?.trim()) {
      throw new Error("Set the prize first with `!giveaway prize <text>`.");
    }

    if (!giveaway.channelId) {
      throw new Error(
        "Choose a channel first with `!giveaway channel #channel`.",
      );
    }

    if (!giveaway.endsAt || giveaway.endsAt <= Date.now()) {
      throw new Error("Set an ending date/time in the future first.");
    }

    giveaway.status = "active";
    giveaway.entries = [];
    giveaway.winners = [];
    giveaway.hostId = giveaway.hostId || guild.client.user.id;

    await saveGiveaway(guild.id, giveaway);
    await postOrEdit(guild, giveaway);
  }

  async function finish(guild, giveaway, reroll = false) {
    const candidates = [];

    const previousWinners = new Set(reroll ? giveaway.winners || [] : []);

    for (const userId of giveaway.entries || []) {
      if (previousWinners.has(userId)) continue;

      const result = await eligibility(guild, userId, giveaway);

      if (result.ok) candidates.push(userId);
    }

    const count = reroll
      ? 1
      : Math.min(giveaway.winnerCount || 1, candidates.length);

    const winners = [];

    while (winners.length < count && candidates.length) {
      const index = Math.floor(Math.random() * candidates.length);
      winners.push(candidates.splice(index, 1)[0]);
    }

    giveaway.status = "ended";

    giveaway.winners = reroll
      ? [...(giveaway.winners || []), ...winners]
      : winners;

    await saveGiveaway(guild.id, giveaway);

    const channel = await guild.channels
      .fetch(giveaway.channelId)
      .catch(() => null);

    if (channel?.isTextBased()) {
      await channel.send(
        winners.length
          ? reroll
            ? `🎉 Replacement winner: ${winners
                .map((id) => `<@${id}>`)
                .join(", ")}! Prize: **${safeText(giveaway.prize)}**.`
            : `🎉 Giveaway ended! Congratulations ${winners
                .map((id) => `<@${id}>`)
                .join(", ")}! Prize: **${safeText(giveaway.prize)}**.`
          : `The giveaway for **${safeText(
              giveaway.prize,
            )}** ended, but no eligible entries remained.`,
      );

      await postOrEdit(guild, giveaway).catch(() => {});
    }

    return { winners, channel };
  }

  async function respond(interaction, content, ephemeral = true) {
    const payload = {
      content: String(content ?? ""),
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    };

    if (interaction.deferred || interaction.replied) {
      return interaction.followUp(payload);
    }

    return interaction.reply(payload);
  }

  async function runAction(guild, userId, action, args, reply) {
    if (!guild) {
      return reply("This command must be used inside a server.");
    }

    if (
      action !== "status" &&
      !hasManagePermission(await guild.members.fetch(userId).catch(() => null))
    ) {
      return reply(
        "You need **Manage Server** permission to manage giveaways.",
      );
    }

    let giveaway = await getGiveaway(guild.id);

    if (action === "create") {
      if (giveaway?.status === "active") {
        return reply(
          "A giveaway is already active. End it before creating another one.",
        );
      }

      giveaway = {
        status: "draft",
        prize: "",
        channelId: null,
        messageId: null,
        hostId: userId,
        endsAt: null,
        winnerCount: 1,
        requirements: {
          messages: { count: 0, days: 7 },
          activeDays: { count: 0, within: 7 },
          roleId: null,
        },
        entries: [],
        winners: [],
      };

      await saveGiveaway(guild.id, giveaway);

      return reply(
        "Giveaway draft created. Configure it with `!giveaway prize`, `channel`, `ends`, and requirements, then use `!giveaway publish`.",
      );
    }

    if (action === "status") {
      return reply(
        giveaway
          ? `Giveaway status: **${giveaway.status}** • Prize: **${safeText(
              giveaway.prize || "Not set",
            )}** • Entries: **${giveaway.entries?.length || 0}**`
          : "No giveaway draft or active giveaway exists.",
      );
    }

    if (action === "reset") {
      await db.delete(key(guild.id));
      return reply("Giveaway settings and entries have been reset.");
    }

    if (!giveaway) {
      return reply("Create a draft first with `!giveaway create`.");
    }

    if (action === "prize") {
      giveaway.prize = args.text;
    } else if (action === "channel") {
      giveaway.channelId = args.channelId;
    } else if (action === "ends") {
      giveaway.endsAt = args.endsAt;
    } else if (action === "winners") {
      giveaway.winnerCount = args.count;
    } else if (action === "requirement-messages") {
      giveaway.requirements.messages = {
        count: args.count,
        days: args.days,
      };
    } else if (action === "requirement-days") {
      giveaway.requirements.activeDays = {
        count: args.count,
        within: args.within,
      };
    } else if (action === "requirement-role") {
      giveaway.requirements.roleId = args.roleId || null;
    } else if (action === "preview") {
      return reply({
        embeds: [createEmbed(giveaway, guild)],
      });
    } else if (action === "publish") {
      try {
        await publish(guild, giveaway);
        return reply("Giveaway published! Members can react with 🎉 to enter.");
      } catch (error) {
        return reply(error.message);
      }
    } else if (action === "end") {
      if (giveaway.status !== "active") {
        return reply("There is no active giveaway to end.");
      }

      const result = await finish(guild, giveaway);

      return reply(
        `Giveaway ended. Eligible winners selected: ${result.winners.length}.`,
      );
    } else if (action === "reroll") {
      if (giveaway.status !== "ended") {
        return reply("End the giveaway before rerolling.");
      }

      const result = await finish(guild, giveaway, true);

      return reply(
        result.winners.length
          ? `Rerolled winner: ${result.winners
              .map((id) => `<@${id}>`)
              .join(", ")}`
          : "No eligible entries are available to reroll.",
      );
    }

    await saveGiveaway(guild.id, giveaway);

    if (giveaway.status === "active") {
      await postOrEdit(guild, giveaway).catch(() => {});
    }

    return reply(`Saved giveaway setting: **${action}**.`);
  }

  async function handleSlash(interaction) {
    if (
      !interaction.isChatInputCommand() ||
      interaction.commandName !== "giveaway"
    ) {
      return;
    }

    const sub = interaction.options.getSubcommand();
    const args = {};

    if (sub === "prize") {
      args.text = interaction.options.getString("text");
    }

    if (sub === "channel") {
      args.channelId = interaction.options.getChannel("channel").id;
    }

    if (sub === "ends") {
      args.endsAt = parseDate(interaction.options.getString("datetime"));

      if (!args.endsAt) {
        return respond(
          interaction,
          "Invalid date/time. Use an ISO format such as `2026-12-31T20:00:00+08:00`.",
        );
      }
    }

    if (sub === "winners") {
      args.count = interaction.options.getInteger("count");
    }

    if (sub === "requirement-messages") {
      args.count = interaction.options.getInteger("count");
      args.days = interaction.options.getInteger("days");
    }

    if (sub === "requirement-days") {
      args.count = interaction.options.getInteger("count");
      args.within = interaction.options.getInteger("within");
    }

    if (sub === "requirement-role") {
      args.roleId = interaction.options.getRole("role")?.id || null;
    }

    try {
      await runAction(
        interaction.guild,
        interaction.user.id,
        sub,
        args,
        async (value) => {
          if (value && typeof value === "object" && value.embeds) {
            if (interaction.deferred || interaction.replied) {
              return interaction.followUp({
                ...value,
                flags: MessageFlags.Ephemeral,
              });
            }

            return interaction.reply({
              ...value,
              flags: MessageFlags.Ephemeral,
            });
          }

          return respond(interaction, value);
        },
      );
    } catch (error) {
      console.error("[Giveaway] Slash command failed:", error);

      if (!interaction.replied && !interaction.deferred) {
        await respond(
          interaction,
          "The giveaway command failed. Check the bot logs.",
        );
      }
    }
  }

  async function handlePrefixCommand(message) {
    if (
      message.author.bot ||
      !message.guild ||
      !message.content.startsWith(prefix)
    ) {
      return false;
    }

    const input = message.content.slice(prefix.length).trim();

    if (!input) return false;

    const [root, action, ...rest] = input.split(/\s+/);

    if (root?.toLowerCase() !== "giveaway") return false;

    // Public member commands.
    if (action?.toLowerCase() === "progress") {
      await sendProgress(message);
      return true;
    }

    if (action?.toLowerCase() === "leaderboard") {
      await sendLeaderboard(message);
      return true;
    }

    // Keyword settings. These affect tracking only, not eligibility.
    if (action?.toLowerCase() === "keyword") {
      const sub = (rest[0] || "status").toLowerCase();

      if (sub === "status") {
        const cfg = await getKeywordSettings(message.guild.id);

        await message.reply(
          `Keyword: **${safeText(cfg.phrase)}**\n` +
            `Enabled: **${cfg.enabled ? "Yes" : "No"}**\n` +
            `Credit window: **${hourLabel(
              cfg.startHour,
            )} to just before ${hourLabel(cfg.endHour)} Manila time**\n` +
            `Keyword credit is optional and does not affect giveaway eligibility.\n` +
            `Use \`${prefix}giveaway keyword set <phrase> [startHour] [endHour]\` or \`${prefix}giveaway keyword off/on\`.`,
        );

        return true;
      }

      if (sub === "on" || sub === "off") {
        if (!hasManagePermission(message.member)) {
          await message.reply(
            "You need **Manage Server** permission to change keyword settings.",
          );
          return true;
        }

        const cfg = await getKeywordSettings(message.guild.id);
        cfg.enabled = sub === "on";

        await db.set(keywordSettingsKey(message.guild.id), cfg);

        await message.reply(
          `Keyword crediting is now **${
            cfg.enabled ? "enabled" : "disabled"
          }**. This does not change giveaway eligibility.`,
        );

        return true;
      }

      if (sub === "set") {
        if (!hasManagePermission(message.member)) {
          await message.reply(
            "You need **Manage Server** permission to change keyword settings.",
          );
          return true;
        }

        const raw = input.split(/\s+/).slice(3);
        const hasHours = raw.length >= 3;

        const startRaw = hasHours ? raw[raw.length - 2] : "1";
        const endRaw = hasHours ? raw[raw.length - 1] : "12";

        const phrase = (hasHours ? raw.slice(0, -2) : raw).join(" ");

        const startHour = Number(startRaw);
        const endHour = Number(endRaw);

        if (
          !phrase ||
          !Number.isInteger(startHour) ||
          !Number.isInteger(endHour) ||
          startHour < 0 ||
          startHour > 23 ||
          endHour < 1 ||
          endHour > 24 ||
          startHour >= endHour
        ) {
          await message.reply(
            `Usage: \`${prefix}giveaway keyword set good morning 1 12\`\n` +
              "Hours use 24-hour format. `1 12` means 1:00 AM until just before noon.",
          );

          return true;
        }

        await db.set(keywordSettingsKey(message.guild.id), {
          phrase: phrase.toLowerCase(),
          startHour,
          endHour,
          enabled: true,
        });

        await message.reply(
          `Keyword set to **${safeText(phrase)}**. It can be credited from **${hourLabel(
            startHour,
          )} until just before ${hourLabel(
            endHour,
          )}**, Manila time. Keyword credit is optional for giveaways.`,
        );

        return true;
      }

      await message.reply(
        `Usage: \`${prefix}giveaway keyword status\`, ` +
          `\`${prefix}giveaway keyword set <phrase> [startHour] [endHour]\`, ` +
          `\`${prefix}giveaway keyword on/off\``,
      );

      return true;
    }

    const tail = input.split(/\s+/).slice(2).join(" ");
    const args = {};

    if (action === "prize") {
      args.text = tail;
    } else if (action === "channel") {
      const channel =
        message.mentions.channels.first() ||
        message.guild.channels.cache.get(rest[0]);

      if (!channel || channel.type !== ChannelType.GuildText) {
        await message.reply("Usage: `!giveaway channel #channel`");
        return true;
      }

      args.channelId = channel.id;
    } else if (action === "ends") {
      args.endsAt = parseDate(tail);

      if (!args.endsAt) {
        await message.reply(
          "Use an ISO date/time, e.g. `!giveaway ends 2026-12-31T20:00:00+08:00`",
        );
        return true;
      }
    } else if (action === "winners") {
      args.count = Number(rest[0]);
    } else if (action === "requirement-messages") {
      args.count = Number(rest[0]);
      args.days = Number(rest[1]);
    } else if (action === "requirement-days") {
      args.count = Number(rest[0]);
      args.within = Number(rest[1]);
    } else if (action === "requirement-role") {
      const role =
        message.mentions.roles.first() ||
        message.guild.roles.cache.get(rest[0]);

      args.roleId = role?.id || null;
    } else if (
      ![
        "create",
        "preview",
        "publish",
        "status",
        "end",
        "reroll",
        "reset",
      ].includes(action)
    ) {
      await message.reply(
        `Giveaway commands:\n` +
          `\`${prefix}giveaway create\`\n` +
          `\`${prefix}giveaway prize <text>\`\n` +
          `\`${prefix}giveaway channel #channel\`\n` +
          `\`${prefix}giveaway ends <ISO date/time>\`\n` +
          `\`${prefix}giveaway winners <number>\`\n` +
          `\`${prefix}giveaway requirement-messages <count> <days>\`\n` +
          `\`${prefix}giveaway requirement-days <count> <within-days>\`\n` +
          `\`${prefix}giveaway requirement-role @role\`\n` +
          `\`${prefix}giveaway progress\`\n` +
          `\`${prefix}giveaway leaderboard\`\n` +
          `\`${prefix}giveaway keyword status\`\n` +
          `\`${prefix}giveaway preview\`\n` +
          `\`${prefix}giveaway publish\`\n` +
          `\`${prefix}giveaway status\`\n` +
          `\`${prefix}giveaway end\`\n` +
          `\`${prefix}giveaway reroll\`\n` +
          `\`${prefix}giveaway reset\``,
      );

      return true;
    }

    if (
      ["winners", "requirement-messages", "requirement-days"].includes(
        action,
      ) &&
      Object.values(args).some((value) => !Number.isFinite(value) || value < 0)
    ) {
      await message.reply("Please provide valid non-negative numbers.");
      return true;
    }

    try {
      await runAction(
        message.guild,
        message.author.id,
        action,
        args,
        async (value) => {
          if (value && typeof value === "object" && value.embeds) {
            return message.reply(value);
          }

          return message.reply(String(value));
        },
      );
    } catch (error) {
      console.error("[Giveaway] Prefix command failed:", error);

      await message.reply("The giveaway command failed. Check the bot logs.");
    }

    return true;
  }

  // Register handlers.
  client.on("messageCreate", recordActivity);
  client.on("interactionCreate", handleSlash);
  client.on("messageCreate", handlePrefixCommand);

  // Handle giveaway reactions.
  client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== EMOJI) return;

    if (reaction.partial) {
      const fetched = await reaction.fetch().catch(() => null);
      if (!fetched) return;
    }

    const message = reaction.message;

    if (!message.guild) return;

    const giveaway = await getGiveaway(message.guild.id);

    if (
      !giveaway ||
      giveaway.status !== "active" ||
      giveaway.messageId !== message.id
    ) {
      return;
    }

    const result = await eligibility(message.guild, user.id, giveaway);

    if (!result.ok) {
      await reaction.users.remove(user.id).catch(() => {});

      const member = await message.guild.members
        .fetch(user.id)
        .catch(() => null);

      if (member) {
        await member
          .send(
            `You could not enter the giveaway **${safeText(
              giveaway.prize,
            )}**: ${result.reason}`,
          )
          .catch(async () => {
            await message.channel
              .send({
                content: `<@${user.id}> ${result.reason}`,
                allowedMentions: { users: [user.id] },
              })
              .then((m) => setTimeout(() => m.delete().catch(() => {}), 10000))
              .catch(() => {});
          });
      }

      return;
    }

    // Eligibility checks do not include keyword credit.
    giveaway.entries = [...new Set([...(giveaway.entries || []), user.id])];

    await saveGiveaway(message.guild.id, giveaway);
    await postOrEdit(message.guild, giveaway).catch(() => {});
  });

  // Remove an entry when the user removes their reaction.
  client.on("messageReactionRemove", async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== EMOJI) return;

    if (reaction.partial) {
      const fetched = await reaction.fetch().catch(() => null);
      if (!fetched) return;
    }

    const message = reaction.message;

    if (!message.guild) return;

    const giveaway = await getGiveaway(message.guild.id);

    if (!giveaway || giveaway.messageId !== message.id) return;

    giveaway.entries = (giveaway.entries || []).filter((id) => id !== user.id);

    await saveGiveaway(message.guild.id, giveaway);
  });

  // Automatically end giveaways after their deadline.
  const timer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const giveaway = await getGiveaway(guild.id);

        if (
          giveaway?.status === "active" &&
          giveaway.endsAt &&
          giveaway.endsAt <= Date.now()
        ) {
          await finish(guild, giveaway);
        }
      } catch (error) {
        console.error("[Giveaway] Auto-end failed:", error);
      }
    }
  }, 30_000);

  timer.unref?.();

  return {
    slashCommand: buildGiveawaySlashCommand(),
    handlePrefixCommand,
  };
};

module.exports.buildGiveawaySlashCommand = buildGiveawaySlashCommand;
