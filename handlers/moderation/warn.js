const { PermissionsBitField, EmbedBuilder } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const WARNINGS_PATH = path.join(__dirname, "warnings.json");
const SETTINGS_PATH = path.join(__dirname, "moderation-settings.json");

function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "{}", "utf8");
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(
      `[Moderation] Failed to load ${path.basename(filePath)}:`,
      error,
    );
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function loadWarnings() {
  return loadJson(WARNINGS_PATH);
}

function saveWarnings(data) {
  saveJson(WARNINGS_PATH, data);
}

function loadSettings() {
  return loadJson(SETTINGS_PATH);
}

function saveSettings(data) {
  saveJson(SETTINGS_PATH, data);
}

function hasPermission(message, permission) {
  return Boolean(message.member?.permissions.has(permission));
}

function parseDuration(input) {
  const match = input?.match(/^(\d+)(m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }[unit];

  const duration = amount * multiplier;

  return duration > 0 && duration <= 28 * 86_400_000 ? duration : null;
}

function canActOn(message, target) {
  if (!target) return "Member not found.";
  if (target.id === message.author.id) {
    return "You cannot moderate yourself.";
  }
  if (target.id === message.guild.ownerId) {
    return "You cannot moderate the server owner.";
  }
  if (target.user.bot) {
    return "This command cannot target bots.";
  }

  if (
    message.guild.ownerId !== message.author.id &&
    message.member.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return "Your highest role must be above the target's highest role.";
  }

  const botMember = message.guild.members.me;

  if (
    !botMember ||
    botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return "My highest role must be above the target's highest role.";
  }

  return null;
}

function canAssignRole(guild, role) {
  const botMember = guild.members.me;

  if (!botMember) {
    return "I could not find my server member information.";
  }

  if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return "I need the **Manage Roles** permission to assign the warning role.";
  }

  if (role.managed || role.id === guild.id) {
    return "That role cannot be assigned manually.";
  }

  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    return "My highest role must be above the configured warning role.";
  }

  return null;
}

async function syncWarningRole(guild, member, hasWarnings) {
  const settings = loadSettings();
  const roleId = settings[guild.id]?.warnRoleId;

  if (!roleId) return;

  const role = guild.roles.cache.get(roleId);
  if (!role) return;

  const botMember = guild.members.me;

  if (!botMember) return;

  if (
    !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
    botMember.roles.highest.comparePositionTo(role) <= 0 ||
    role.managed ||
    role.id === guild.id
  ) {
    console.warn("[Moderation] Cannot manage the configured Auto-Warn Role.");
    return;
  }

  try {
    const currentlyHasRole = member.roles.cache.has(role.id);

    if (hasWarnings && !currentlyHasRole) {
      await member.roles.add(role, "Member has active warnings.");
    } else if (!hasWarnings && currentlyHasRole) {
      await member.roles.remove(role, "Member has no remaining warnings.");
    }
  } catch (error) {
    console.error("[Moderation] Failed to synchronize warning role:", error);
  }
}

async function handleWarnCommand(message) {
  if (!message.guild || message.author.bot) return false;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  const commands = [
    "!warn",
    "!warnrole",
    "!warnings",
    "!unwarn",
    "!clearwarnings",
    "!mute",
    "!unmute",
    "!kick",
    "!ban",
    "!unban",
  ];

  if (!commands.includes(command)) return false;

  const target = message.mentions.members.first();
  const memberPerms = PermissionsBitField.Flags;

  async function deny(text) {
    await message.reply(text);
    return true;
  }

  async function requirePermission(permission, label) {
    if (!hasPermission(message, permission)) {
      await deny(`You need the **${label}** permission to use this command.`);
      return false;
    }

    return true;
  }

  async function getTarget() {
    if (!target) {
      await deny(`Mention a member. Usage: \`${command} @member reason\``);
      return null;
    }

    const issue = canActOn(message, target);

    if (issue) {
      await deny(issue);
      return null;
    }

    return target;
  }

  if (command === "!warn") {
    if (
      !(await requirePermission(
        memberPerms.ModerateMembers,
        "Moderate Members",
      ))
    ) {
      return true;
    }

    const member = await getTarget();
    if (!member) return true;

    const relatedRole = message.mentions.roles.first();

    const reason = args
      .slice(1)
      .filter((arg) => !/^<@!?\d+>$/.test(arg) && !/^<@&\d+>$/.test(arg))
      .join(" ")
      .trim();

    if (!reason) {
      return deny("Usage: `!warn @member [@role] reason`");
    }

    const data = loadWarnings();
    data[message.guild.id] ||= {};
    data[message.guild.id][member.id] ||= [];

    const record = {
      id: `${Date.now()}`,
      reason: reason.slice(0, 1000),
      roleId: relatedRole?.id || null,
      moderatorId: message.author.id,
      timestamp: new Date().toISOString(),
    };

    data[message.guild.id][member.id].push(record);
    saveWarnings(data);

    const settings = loadSettings();
    const warnRoleId = settings[message.guild.id]?.warnRoleId;
    const warnRole = warnRoleId
      ? message.guild.roles.cache.get(warnRoleId)
      : null;

    let roleMessage = "No Auto-Warn Role is configured.";

    if (warnRoleId && !warnRole) {
      roleMessage =
        "The configured role no longer exists. Use `!warnrole set @role` to configure another role.";
    } else if (warnRole) {
      const roleIssue = canAssignRole(message.guild, warnRole);

      if (roleIssue) {
        roleMessage = `⚠️ ${roleIssue}`;
      } else {
        try {
          if (!member.roles.cache.has(warnRole.id)) {
            await member.roles.add(
              warnRole,
              `Auto-Warn: ${record.reason} | Moderator: ${message.author.tag}`,
            );
          }

          roleMessage = member.roles.cache.has(warnRole.id)
            ? `Successfully assigned ${warnRole}.`
            : `The role assignment could not be confirmed for ${warnRole}.`;
        } catch (error) {
          console.error("[Moderation] Could not assign warning role:", error);

          roleMessage =
            "⚠️ The warning was saved, but I couldn't assign the Auto-Warn Role. Check my permissions and role hierarchy.";
        }
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Member Warning")
      .addFields(
        {
          name: "Member",
          value: `${member.user.tag} (${member.id})`,
        },
        {
          name: "Moderator",
          value: message.author.tag,
        },
        {
          name: "Reason",
          value: record.reason,
        },
        {
          name: "Related Role",
          value: relatedRole ? `${relatedRole}` : "None specified",
        },
        {
          name: "Auto-Warn Role",
          value: roleMessage,
        },
        {
          name: "Total Warnings",
          value: String(data[message.guild.id][member.id].length),
        },
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    try {
      await member.send(
        `You received a warning in **${message.guild.name}**.\n` +
          `Reason: ${record.reason}` +
          (relatedRole ? `\nRelated role: ${relatedRole.name}` : "") +
          (warnRole ? `\nAuto-Warn Role: ${warnRole.name}` : ""),
      );
    } catch {
      // The member may have direct messages disabled.
    }

    return true;
  }

  if (command === "!warnrole") {
    if (!(await requirePermission(memberPerms.ManageGuild, "Manage Server"))) {
      return true;
    }

    const action = args[1]?.toLowerCase();
    const settings = loadSettings();
    settings[message.guild.id] ||= {};

    if (!action || action === "status") {
      const roleId = settings[message.guild.id].warnRoleId;
      const role = roleId ? message.guild.roles.cache.get(roleId) : null;

      if (role) {
        return deny(
          `Auto-Warn Role: ${role}\n` +
            "I'll assign this role whenever someone is warned.",
        );
      }

      return deny(
        "Auto-Warn Role is currently disabled or its role no longer exists.\n" +
          "Use `!warnrole set @role` to configure it.",
      );
    }

    if (action === "off") {
      delete settings[message.guild.id].warnRoleId;
      saveSettings(settings);

      return deny(
        "Auto-Warn Role has been disabled. Existing roles will not be removed.",
      );
    }

    if (action === "set") {
      const role =
        message.mentions.roles.first() ||
        message.guild.roles.cache.get(args[2]?.replace(/[<@&>]/g, ""));

      if (!role) {
        return deny("Usage: `!warnrole set @role`");
      }

      const roleIssue = canAssignRole(message.guild, role);

      if (roleIssue) {
        return deny(`I cannot use that role. ${roleIssue}`);
      }

      settings[message.guild.id].warnRoleId = role.id;
      saveSettings(settings);

      return deny(
        `Auto-Warn Role set to ${role}. Members will receive this role whenever they are warned.`,
      );
    }

    return deny(
      "Usage: `!warnrole set @role`, `!warnrole off`, or `!warnrole status`.",
    );
  }

  if (command === "!warnings") {
    const viewingOther = Boolean(target);

    if (
      viewingOther &&
      !(await requirePermission(
        memberPerms.ModerateMembers,
        "Moderate Members",
      ))
    ) {
      return true;
    }

    const userId = target?.id || message.author.id;
    const records = loadWarnings()[message.guild.id]?.[userId] || [];

    if (!records.length) {
      return deny(
        target
          ? `${target.user.tag} has no warnings.`
          : "You have no recorded warnings.",
      );
    }

    const shownRecords = records.slice(-10);
    const firstNumber = records.length - shownRecords.length;

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`Warnings for ${target?.user.tag || message.author.tag}`)
      .setDescription(
        shownRecords
          .map(
            (item, index) =>
              `**${firstNumber + index + 1}.** ${item.reason}\n` +
              `Moderator: <@${item.moderatorId}> • ` +
              `Related role: ${item.roleId ? `<@&${item.roleId}>` : "None"}\n` +
              `Date: <t:${Math.floor(
                new Date(item.timestamp).getTime() / 1000,
              )}:f>`,
          )
          .join("\n\n")
          .slice(0, 4000),
      )
      .setFooter({
        text: `Showing up to 10 of ${records.length} warnings`,
      });

    await message.reply({ embeds: [embed] });
    return true;
  }

  if (command === "!unwarn") {
    if (
      !(await requirePermission(
        memberPerms.ModerateMembers,
        "Moderate Members",
      ))
    ) {
      return true;
    }

    const member = await getTarget();
    if (!member) return true;

    const number = Number(args[2]);
    const data = loadWarnings();
    const records = data[message.guild.id]?.[member.id] || [];

    if (!Number.isInteger(number) || number < 1 || number > records.length) {
      return deny("Usage: `!unwarn @member warning-number`");
    }

    const [removed] = records.splice(number - 1, 1);
    saveWarnings(data);

    await syncWarningRole(message.guild, member, records.length > 0);

    return deny(
      `Removed warning #${number} for **${member.user.tag}**: ${removed.reason}\n` +
        `Remaining warnings: ${records.length}` +
        (records.length === 0
          ? "\nThe Auto-Warn Role has been removed if it was assigned."
          : ""),
    );
  }

  if (command === "!clearwarnings") {
    if (!(await requirePermission(memberPerms.ManageGuild, "Manage Server"))) {
      return true;
    }

    if (!target) {
      return deny("Usage: `!clearwarnings @member`");
    }

    const data = loadWarnings();
    const records = data[message.guild.id]?.[target.id] || [];
    const count = records.length;

    if (data[message.guild.id]) {
      delete data[message.guild.id][target.id];
    }

    saveWarnings(data);

    const member = await message.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (member) {
      await syncWarningRole(message.guild, member, false);
    }

    return deny(
      `Cleared ${count} warning(s) for **${target.user.tag}**.\n` +
        "The Auto-Warn Role has been removed if it was assigned.",
    );
  }

  if (command === "!mute") {
    if (
      !(await requirePermission(
        memberPerms.ModerateMembers,
        "Moderate Members",
      ))
    ) {
      return true;
    }

    const member = await getTarget();
    if (!member) return true;

    const duration = parseDuration(args[2]);

    if (!duration) {
      return deny(
        "Usage: `!mute @member 10m reason` (use m, h, or d; maximum 28 days).",
      );
    }

    const reason = args.slice(3).join(" ").trim() || "No reason provided";

    await member.timeout(
      duration,
      `${reason} | Moderator: ${message.author.tag}`,
    );

    return deny(
      `🔇 **${member.user.tag}** has been timed out for **${args[2]}**.\n` +
        `Reason: ${reason}`,
    );
  }

  if (command === "!unmute") {
    if (
      !(await requirePermission(
        memberPerms.ModerateMembers,
        "Moderate Members",
      ))
    ) {
      return true;
    }

    const member = await getTarget();
    if (!member) return true;

    if (!member.isCommunicationDisabled()) {
      return deny(`${member.user.tag} is not currently timed out.`);
    }

    await member.timeout(null, `Timeout removed by ${message.author.tag}`);

    return deny(`🔊 Timeout removed for **${member.user.tag}**.`);
  }

  if (command === "!kick") {
    if (!(await requirePermission(memberPerms.KickMembers, "Kick Members"))) {
      return true;
    }

    const member = await getTarget();
    if (!member) return true;

    const reason = args.slice(2).join(" ").trim() || "No reason provided";

    await member.kick(`${reason} | Moderator: ${message.author.tag}`);

    return deny(`👢 Kicked **${member.user.tag}**.\nReason: ${reason}`);
  }

  if (command === "!ban") {
    if (!(await requirePermission(memberPerms.BanMembers, "Ban Members"))) {
      return true;
    }

    const member = await getTarget();
    if (!member) return true;

    const possibleDays = Number(args[2]);
    const deleteDays =
      Number.isInteger(possibleDays) && possibleDays >= 0 && possibleDays <= 7
        ? possibleDays
        : 0;

    const reason =
      args[2] !== undefined &&
      Number.isInteger(possibleDays) &&
      possibleDays >= 0 &&
      possibleDays <= 7
        ? args.slice(3).join(" ").trim() || "No reason provided"
        : args.slice(2).join(" ").trim() || "No reason provided";

    await member.ban({
      deleteMessageSeconds: deleteDays * 86400,
      reason: `${reason} | Moderator: ${message.author.tag}`,
    });

    return deny(
      `🔨 Banned **${member.user.tag}**.\n` +
        `Messages deleted: ${deleteDays} day(s).\n` +
        `Reason: ${reason}`,
    );
  }

  if (command === "!unban") {
    if (!(await requirePermission(memberPerms.BanMembers, "Ban Members"))) {
      return true;
    }

    const userId = args[1]?.replace(/[<@!>]/g, "");

    if (!/^\d{17,20}$/.test(userId || "")) {
      return deny("Usage: `!unban userID [reason]`");
    }

    const reason = args.slice(2).join(" ").trim() || "No reason provided";

    await message.guild.members.unban(
      userId,
      `${reason} | Moderator: ${message.author.tag}`,
    );

    return deny(`Unbanned user \`${userId}\`.`);
  }

  return false;
}

module.exports = { handleWarnCommand };
