const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const { createXpStaffDatabase } = require("./db");

function createXpLevelStaff(client, options = {}) {
  const db = createXpStaffDatabase(
    options.databasePath ||
      process.env.XP_STAFF_DATABASE_PATH ||
      "./data/xp-level-staff.sqlite",
  );
  const minMessageLength = Number(
    options.minMessageLength || process.env.XP_MIN_MESSAGE_LENGTH || 8,
  );
  const lastXpMessage = new Map();

  const levelCommand = new SlashCommandBuilder()
    .setName("level")
    .setDescription("View your XP, level, and staff application eligibility")
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to check").setRequired(false),
    )
    .setDMPermission(false);

  const leaderboardCommand = new SlashCommandBuilder()
    .setName("xpleaderboard")
    .setDescription("View the server XP leaderboard")
    .setDMPermission(false);

  const applyCommand = new SlashCommandBuilder()
    .setName("staffapply")
    .setDescription("Apply for staff when you meet the minimum level")
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("Why do you want to join the staff team?")
        .setRequired(true)
        .setMaxLength(800),
    )
    .addStringOption((o) =>
      o
        .setName("experience")
        .setDescription("Your community or moderation experience")
        .setRequired(true)
        .setMaxLength(800),
    )
    .setDMPermission(false);

  const applicationsCommand = new SlashCommandBuilder()
    .setName("staffapplications")
    .setDescription("List pending staff applications")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false);

  const reviewCommand = new SlashCommandBuilder()
    .setName("staffreview")
    .setDescription("Approve or reject a staff application")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) =>
      o
        .setName("application_id")
        .setDescription("Application number")
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption((o) =>
      o
        .setName("decision")
        .setDescription("Decision")
        .setRequired(true)
        .addChoices(
          { name: "Approve", value: "approve" },
          { name: "Reject", value: "reject" },
        ),
    )
    .addStringOption((o) =>
      o
        .setName("note")
        .setDescription("Optional note to the applicant")
        .setRequired(false)
        .setMaxLength(500),
    )
    .setDMPermission(false);

  const setupCommand = new SlashCommandBuilder()
    .setName("xpstaff")
    .setDescription("Configure the separate XP and staff application feature")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("settings")
        .setDescription("Configure XP and staff application settings")
        .addIntegerOption((o) =>
          o
            .setName("xp_per_message")
            .setDescription("XP per qualifying message")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false),
        )
        .addIntegerOption((o) =>
          o
            .setName("cooldown_seconds")
            .setDescription("Seconds between XP awards")
            .setMinValue(10)
            .setMaxValue(3600)
            .setRequired(false),
        )
        .addIntegerOption((o) =>
          o
            .setName("staff_min_level")
            .setDescription("Minimum level needed to apply")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false),
        )
        .addChannelOption((o) =>
          o
            .setName("application_channel")
            .setDescription("Channel for new applications")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("Show XP and staff feature settings"),
    )
    .setDMPermission(false);

  function setting(guildId, key, fallback) {
    const value = db.getSetting(guildId, key);
    if (value === null || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  function levelFromXp(xp) {
    return Math.min(100, Math.floor(Math.sqrt(Math.max(0, xp) / 100)));
  }
  function nextLevelXp(level) {
    return 100 * (level + 1) * (level + 1);
  }
  function canManage(member) {
    return (
      member?.permissions?.has(PermissionFlagsBits.Administrator) ||
      member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
  }

  async function handleSlashCommand(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "Use this feature inside the server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "level") {
      const user = interaction.options.getUser("member") || interaction.user;
      const xp = db.getXp(interaction.guildId, user.id);
      const level = levelFromXp(xp);
      const floor = level * level * 100;
      const next = nextLevelXp(level);
      const progress = xp - floor;
      const needed = next - floor;
      const filled = Math.max(
        0,
        Math.min(10, Math.floor((progress / Math.max(1, needed)) * 10)),
      );
      const bar = "█".repeat(filled) + "░".repeat(10 - filled);
      const minimum = setting(interaction.guildId, "staff_min_level", 5);
      const embed = new EmbedBuilder()
        .setTitle(`⭐ ${user.username}'s Level`)
        .setColor(0xf1c40f)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: "Level", value: String(level), inline: true },
          { name: "Total XP", value: String(xp), inline: true },
          {
            name: "Next level",
            value: level >= 100 ? "Maximum level" : `${next - xp} XP needed`,
            inline: true,
          },
          {
            name: "Progress",
            value:
              level >= 100 ? "MAX LEVEL" : `${bar} ${progress}/${needed} XP`,
            inline: false,
          },
          {
            name: "Staff applications",
            value:
              level >= minimum
                ? "Eligible to apply"
                : `Unlocks at Level ${minimum}`,
            inline: false,
          },
        );
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "xpleaderboard") {
      const rows = db.leaderboard(interaction.guildId, 10);
      const lines = rows.map(
        (r, i) =>
          `**${i + 1}.** <@${r.user_id}> — Level **${levelFromXp(r.xp)}** · ${r.xp} XP`,
      );
      return interaction.reply({
        content: `🏆 **Server XP Leaderboard**\n${lines.length ? lines.join("\n") : "No XP earned yet."}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "staffapply") {
      const xp = db.getXp(interaction.guildId, interaction.user.id);
      const level = levelFromXp(xp);
      const minimum = setting(interaction.guildId, "staff_min_level", 5);
      if (level < minimum) {
        return interaction.reply({
          content: `You need Level **${minimum}** to apply. Your current level is **${level}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (db.hasPending(interaction.guildId, interaction.user.id)) {
        return interaction.reply({
          content: "You already have a pending staff application.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const reason = interaction.options.getString("reason", true).trim();
      const experience = interaction.options
        .getString("experience", true)
        .trim();
      const id = db.createApp(
        interaction.guildId,
        interaction.user.id,
        reason,
        experience,
      );
      const channelId = db.getSetting(
        interaction.guildId,
        "application_channel_id",
      );
      const channel = channelId
        ? await interaction.guild.channels.fetch(channelId).catch(() => null)
        : null;
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`Staff Application #${id}`)
          .setColor(0x5865f2)
          .addFields(
            {
              name: "Applicant",
              value: `<@${interaction.user.id}> (${interaction.user.id})`,
            },
            {
              name: "Level / XP",
              value: `Level ${level} · ${xp} XP`,
              inline: true,
            },
            { name: "Why they want to join", value: reason.slice(0, 1024) },
            { name: "Experience", value: experience.slice(0, 1024) },
          )
          .setFooter({ text: `Review with /staffreview application_id:${id}` });
        await channel.send({ embeds: [embed] }).catch(() => {});
      }
      const note = channel?.isTextBased()
        ? " The staff team has been notified."
        : " The application was saved, but the application channel is not configured or could not be reached. Ask an admin to configure /xpstaff settings.";
      return interaction.reply({
        content: `Your staff application #${id} has been submitted.${note} Meeting the level requirement does not guarantee staff acceptance.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "staffapplications") {
      if (!canManage(interaction.member))
        return interaction.reply({
          content:
            "Only administrators or members with Manage Server can view applications.",
          flags: MessageFlags.Ephemeral,
        });
      const rows = db.listApps(interaction.guildId, 10);
      const lines = rows.map(
        (r) =>
          `**#${r.id}** <@${r.user_id}> · Level ${levelFromXp(db.getXp(interaction.guildId, r.user_id))} · ${new Date(r.created_at).toLocaleString()}`,
      );
      return interaction.reply({
        content: `📨 **Pending Staff Applications**\n${lines.length ? lines.join("\n") : "No pending applications."}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "staffreview") {
      if (!canManage(interaction.member))
        return interaction.reply({
          content:
            "Only administrators or members with Manage Server can review applications.",
          flags: MessageFlags.Ephemeral,
        });
      const id = interaction.options.getInteger("application_id", true);
      const decision = interaction.options.getString("decision", true);
      const note = interaction.options.getString("note") || "";
      const application = db.getApp(interaction.guildId, id);
      if (!application)
        return interaction.reply({
          content: "Application not found in this server.",
          flags: MessageFlags.Ephemeral,
        });
      if (application.status !== "pending")
        return interaction.reply({
          content: `This application was already ${application.status}.`,
          flags: MessageFlags.Ephemeral,
        });
      const status = decision === "approve" ? "approved" : "rejected";
      if (
        !db.reviewApp(
          interaction.guildId,
          id,
          status,
          interaction.user.id,
          note,
        )
      ) {
        return interaction.reply({
          content:
            "Could not update the application; it may already have been reviewed.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const member = await interaction.guild.members
        .fetch(application.user_id)
        .catch(() => null);
      if (member)
        await member
          .send(
            `Your staff application #${id} was **${status}**.${note ? `\nStaff note: ${note}` : ""}\n${status === "approved" ? "An administrator will follow up about role assignment. No staff permissions were automatically granted." : "Thank you for your interest in helping the community."}`,
          )
          .catch(() => {});
      return interaction.reply({
        content: `Application #${id} ${status}. Staff roles and permissions must be assigned manually by an administrator.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (interaction.commandName === "xpstaff") {
      if (!canManage(interaction.member))
        return interaction.reply({
          content:
            "Only administrators or members with Manage Server can configure this feature.",
          flags: MessageFlags.Ephemeral,
        });
      const sub = interaction.options.getSubcommand();
      if (sub === "settings") {
        const xp = interaction.options.getInteger("xp_per_message");
        const cooldown = interaction.options.getInteger("cooldown_seconds");
        const minimum = interaction.options.getInteger("staff_min_level");
        const channel = interaction.options.getChannel("application_channel");
        if (xp === null && cooldown === null && minimum === null && !channel) {
          return interaction.reply({
            content: "Provide at least one setting to change.",
            flags: MessageFlags.Ephemeral,
          });
        }
        if (xp !== null)
          db.setSetting(interaction.guildId, "xp_per_message", xp);
        if (cooldown !== null)
          db.setSetting(interaction.guildId, "xp_cooldown_seconds", cooldown);
        if (minimum !== null)
          db.setSetting(interaction.guildId, "staff_min_level", minimum);
        if (channel)
          db.setSetting(
            interaction.guildId,
            "application_channel_id",
            channel.id,
          );
        return interaction.reply({
          content: `Saved settings.\nXP per message: **${setting(interaction.guildId, "xp_per_message", 5)}**\nCooldown: **${setting(interaction.guildId, "xp_cooldown_seconds", 60)} seconds**\nMinimum staff level: **${setting(interaction.guildId, "staff_min_level", 5)}**\nApplication channel: ${db.getSetting(interaction.guildId, "application_channel_id") ? `<#${db.getSetting(interaction.guildId, "application_channel_id")}>` : "Not configured"}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const channelId = db.getSetting(
        interaction.guildId,
        "application_channel_id",
      );
      return interaction.reply({
        content: `XP per message: **${setting(interaction.guildId, "xp_per_message", 5)}**\nCooldown: **${setting(interaction.guildId, "xp_cooldown_seconds", 60)} seconds**\nMinimum staff level: **${setting(interaction.guildId, "staff_min_level", 5)}**\nApplication channel: ${channelId ? `<#${channelId}>` : "Not configured"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  async function handlePrefixCommand(message) {
    if (!message.guild || message.author.bot) return false;

    const args = message.content.trim().split(/\s+/);
    const command = args[0].toLowerCase();

    if (command !== "!level") return false;

    const user = message.mentions.users.first() || message.author;
    const xp = db.getXp(message.guild.id, user.id);
    const level = levelFromXp(xp);
    const floor = level * level * 100;
    const next = nextLevelXp(level);
    const progress = xp - floor;
    const needed = next - floor;
    const filled = Math.max(
      0,
      Math.min(10, Math.floor((progress / Math.max(1, needed)) * 10)),
    );
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    const minimum = setting(message.guild.id, "staff_min_level", 5);

    const embed = new EmbedBuilder()
      .setTitle(`⭐ ${user.username}'s Level`)
      .setColor(0xf1c40f)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "Level", value: String(level), inline: true },
        { name: "Total XP", value: String(xp), inline: true },
        {
          name: "Next level",
          value: level >= 100 ? "Maximum level" : `${next - xp} XP needed`,
          inline: true,
        },
        {
          name: "Progress",
          value: level >= 100 ? "MAX LEVEL" : `${bar} ${progress}/${needed} XP`,
        },
        {
          name: "Staff applications",
          value:
            level >= minimum
              ? "Eligible to apply"
              : `Unlocks at Level ${minimum}`,
        },
      );

    await message.reply({ embeds: [embed] });
    return true;
  }
  async function handleMessageCreate(message) {
    if (
      !message.guild ||
      message.author.bot ||
      message.content.trim().length < minMessageLength
    )
      return;
    const content = message.content.trim();
    if (/(.)\1{7,}/i.test(content) || /^(\S+)(\s+\1){3,}$/i.test(content))
      return;
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const cooldown =
      setting(message.guild.id, "xp_cooldown_seconds", 60) * 1000;
    if (now - (lastXpMessage.get(key) || 0) < cooldown) return;
    lastXpMessage.set(key, now);
    db.addXp(
      message.guild.id,
      message.author.id,
      setting(message.guild.id, "xp_per_message", 5),
    );
  }

  return {
    commands: [
      levelCommand,
      leaderboardCommand,
      applyCommand,
      applicationsCommand,
      reviewCommand,
      setupCommand,
    ],
    handleSlashCommand,
    handleMessageCreate,
    handlePrefixCommand,
    close: () => db.close(),
    db,
  };
}
module.exports = createXpLevelStaff;
