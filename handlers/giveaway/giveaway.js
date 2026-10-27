const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const EMOJI = "🎉";
const DAY = 24 * 60 * 60 * 1000;

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
      s.setName("reset").setDescription("Delete giveaway settings and data"),
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

  // Avoid registering the same module twice on one client.
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

  // Track messages and distinct active calendar days.
  async function recordActivity(message) {
    if (!message.guild || message.author.bot) return;

    const k = activityKey(message.guild.id, message.author.id);

    const data = (await db.get(k)) || {
      total: 0,
      days: {},
    };

    const today = new Date().toISOString().slice(0, 10);

    data.total += 1;
    data.days[today] = (data.days[today] || 0) + 1;

    const cutoff = new Date(Date.now() - 366 * DAY).toISOString().slice(0, 10);

    for (const date of Object.keys(data.days)) {
      if (date < cutoff) delete data.days[date];
    }

    await db.set(k, data);
  }

  // Check whether a member is allowed to enter.
  async function eligibility(guild, userId, giveaway) {
    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member || member.user.bot) {
      return {
        ok: false,
        reason: "Only current server members can enter.",
      };
    }

    const req = giveaway.requirements;
    const data = (await db.get(activityKey(guild.id, userId))) || {
      total: 0,
      days: {},
    };

    const now = Date.now();

    if (req.roleId && !member.roles.cache.has(req.roleId)) {
      return {
        ok: false,
        reason: `You need the required role <@&${req.roleId}> to enter.`,
      };
    }

    if (req.messages.count > 0) {
      const cutoff = new Date(now - req.messages.days * DAY)
        .toISOString()
        .slice(0, 10);

      const count = Object.entries(data.days)
        .filter(([date]) => date >= cutoff)
        .reduce((sum, [, value]) => sum + value, 0);

      if (count < req.messages.count) {
        return {
          ok: false,
          reason: `You need **${req.messages.count} messages** within ${req.messages.days} day(s). Your recorded count is **${count}**.`,
        };
      }
    }

    if (req.activeDays.count > 0) {
      const cutoff = new Date(now - req.activeDays.within * DAY)
        .toISOString()
        .slice(0, 10);

      const count = Object.entries(data.days).filter(
        ([date, value]) => date >= cutoff && value > 0,
      ).length;

      if (count < req.activeDays.count) {
        return {
          ok: false,
          reason: `You need to be active on **${req.activeDays.count} different days** within ${req.activeDays.within} day(s). Your recorded active days: **${count}**.`,
        };
      }
    }

    return { ok: true };
  }

  // Post the giveaway, or update its existing embed.
  async function postOrEdit(guild, giveaway) {
    const channel = await guild.channels
      .fetch(giveaway.channelId)
      .catch(() => null);

    if (!channel?.isTextBased()) {
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
    giveaway.hostId = giveaway.hostId || guild.client.user.id;

    await saveGiveaway(guild.id, giveaway);
    await postOrEdit(guild, giveaway);
  }

  // Select winners from eligible entries only.
  async function finish(guild, giveaway, reroll = false) {
    const candidates = [];

    for (const userId of giveaway.entries || []) {
      const result = await eligibility(guild, userId, giveaway);

      if (result.ok) candidates.push(userId);
    }

    if (!candidates.length) {
      giveaway.status = "ended";
      giveaway.winners = [];
      await saveGiveaway(guild.id, giveaway);

      const emptyChannel = await guild.channels
        .fetch(giveaway.channelId)
        .catch(() => null);

      if (emptyChannel?.isTextBased()) {
        await emptyChannel.send(
          `The giveaway for **${safeText(giveaway.prize)}** ended, but no eligible entries remained.`,
        );
        await postOrEdit(guild, giveaway).catch(() => {});
      }

      return { winners: [], channel: emptyChannel };
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
    giveaway.winners = winners;

    await saveGiveaway(guild.id, giveaway);

    const channel = await guild.channels
      .fetch(giveaway.channelId)
      .catch(() => null);

    if (channel?.isTextBased()) {
      await channel.send(
        `🎉 Giveaway ended! Congratulations ${winners
          .map((id) => `<@${id}>`)
          .join(", ")}! Prize: **${safeText(giveaway.prize)}**.`,
      );

      await postOrEdit(guild, giveaway).catch(() => {});
    }

    return { winners, channel };
  }

  async function respond(interaction, content, ephemeral = true) {
    const payload = {
      content,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    };

    if (interaction.deferred || interaction.replied) {
      return interaction.followUp(payload);
    }

    return interaction.reply(payload);
  }

  // Shared logic for slash and prefix commands.
  async function runAction(guild, userId, action, args, reply) {
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

    if (action === "prize") giveaway.prize = args.text;
    else if (action === "channel") giveaway.channelId = args.channelId;
    else if (action === "ends") giveaway.endsAt = args.endsAt;
    else if (action === "winners") giveaway.winnerCount = args.count;
    else if (action === "requirement-messages") {
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
      return reply({ embeds: [createEmbed(giveaway, guild)] });
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

      const result = await finish(
        guild,
        { ...giveaway, status: "active" },
        true,
      );

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

  // Slash-command handler.
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
      const raw = interaction.options.getString("datetime");
      args.endsAt = parseDate(raw);

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

    await runAction(
      interaction.guild,
      interaction.user.id,
      sub,
      args,
      async (value) => {
        if (value && typeof value === "object" && value.embeds) {
          return interaction.reply({
            ...value,
            flags: MessageFlags.Ephemeral,
          });
        }

        return respond(interaction, value);
      },
    );
  }

  // Prefix-command handler.
  async function handlePrefixCommand(message) {
    if (
      message.author.bot ||
      !message.guild ||
      !message.content.startsWith(prefix)
    ) {
      return false;
    }

    const input = message.content.slice(prefix.length).trim();
    const [root, action, ...rest] = input.split(/\s+/);

    if (root?.toLowerCase() !== "giveaway") return false;

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
        `Giveaway commands:
\`${prefix}giveaway create\`
\`${prefix}giveaway prize <text>\`
\`${prefix}giveaway channel #channel\`
\`${prefix}giveaway ends <ISO date/time>\`
\`${prefix}giveaway winners <number>\`
\`${prefix}giveaway requirement-messages <count> <days>\`
\`${prefix}giveaway requirement-days <count> <within-days>\`
\`${prefix}giveaway requirement-role @role\`
\`${prefix}giveaway preview\`
\`${prefix}giveaway publish\`
\`${prefix}giveaway status\`
\`${prefix}giveaway end\`
\`${prefix}giveaway reroll\`
\`${prefix}giveaway reset\``,
      );

      return true;
    }

    if (
      ["winners", "requirement-messages", "requirement-days"].includes(
        action,
      ) &&
      Object.values(args).some((v) => !Number.isFinite(v) || v < 0)
    ) {
      await message.reply("Please provide valid non-negative numbers.");
      return true;
    }

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

    return true;
  }

  // Record activity and register handlers.
  client.on("messageCreate", recordActivity);
  client.on("interactionCreate", handleSlash);
  client.on("messageCreate", handlePrefixCommand);

  // Check reaction entries.
  client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== EMOJI) return;

    if (reaction.partial) {
      await reaction.fetch().catch(() => null);
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

    giveaway.entries = [...new Set([...(giveaway.entries || []), user.id])];

    await saveGiveaway(message.guild.id, giveaway);
    await postOrEdit(message.guild, giveaway).catch(() => {});
  });

  // Remove entries when members remove their reaction.
  client.on("messageReactionRemove", async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== EMOJI) return;

    if (reaction.partial) {
      await reaction.fetch().catch(() => null);
    }

    const message = reaction.message;
    if (!message.guild) return;

    const giveaway = await getGiveaway(message.guild.id);

    if (!giveaway || giveaway.messageId !== message.id) return;

    giveaway.entries = (giveaway.entries || []).filter((id) => id !== user.id);

    await saveGiveaway(message.guild.id, giveaway);
  });

  // Automatically end giveaways when their deadlines pass.
  const timer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const giveaway = await getGiveaway(guild.id);

      if (
        giveaway?.status === "active" &&
        giveaway.endsAt &&
        giveaway.endsAt <= Date.now()
      ) {
        await finish(guild, giveaway).catch((error) =>
          console.error("[Giveaway] Auto-end failed:", error),
        );
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
