const {
  Events,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

module.exports = function registerFarewell(
  client,
  db,
  PREFIX = "!",
  DEVELOPER_ID = "",
) {
  // Check if the user can manage farewell settings.
  function isStaff(message) {
    return (
      message.author.id === DEVELOPER_ID ||
      message.member?.permissions.has(PermissionFlagsBits.ManageGuild)
    );
  }

  // Replace variables in the farewell message.
  function replaceFarewellVariables(text, member) {
    return text
      .replace(/\?user/gi, member.user.username)
      .replace(/\?tag/gi, member.user.tag || member.user.username)
      .replace(/\?server/gi, member.guild.name)
      .replace(/\?count/gi, String(member.guild.memberCount));
  }

  // Create the farewell embed.
  function makeFarewellEmbed(description, member) {
    return new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("🚪 Someone left the chaos")
      .setDescription(description)
      .setThumbnail(
        member.user.displayAvatarURL({
          extension: "png",
          size: 256,
        }),
      )
      .setFooter({
        text: `${member.guild.name} • Farewell`,
      })
      .setTimestamp();
  }

  // Send a farewell message when a member leaves the server.
  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const channelId = await db.get(`leave_${member.guild.id}`);

      // Do nothing if no farewell channel is configured.
      if (!channelId) return;

      const channel = await member.guild.channels
        .fetch(channelId)
        .catch(() => null);

      // Make sure the channel exists and supports messages.
      if (!channel || !channel.isTextBased() || !channel.send) {
        console.warn("Configured farewell channel is unavailable.");
        return;
      }

      // Use a custom message if one has been saved.
      const savedText = await db.get(`leavedesc_${member.guild.id}`);

      const text =
        savedText ||
        "💀 **ONE LESS MOTHERFUCKER IN THE SERVER!**\n\n" +
          "**?user** has left the fucking building. " +
          "No goodbye, no explanation—just gone. 😈\n\n" +
          "Members remaining: **?count**";

      const description = replaceFarewellVariables(text, member);

      await channel.send({
        embeds: [makeFarewellEmbed(description, member)],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("Farewell event error:", error);
    }
  });

  // Listen for farewell configuration commands.
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const input = message.content.slice(PREFIX.length).trim();

    if (!input) return;

    const [rawCommand, ...args] = input.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const rest = input.slice(rawCommand.length).trim();

    const commands = ["setleave", "leavedesc", "leaveoff", "leavetest"];

    // Ignore commands unrelated to farewell messages.
    if (!commands.includes(command)) return;

    // Only the developer or server managers can configure it.
    if (!isStaff(message)) {
      await message.reply(
        "You need the **Manage Server** permission to configure farewell messages.",
      );
      return;
    }

    const guildId = message.guild.id;

    try {
      // !setleave #goodbye
      // Set a separate channel for farewell messages.
      if (command === "setleave") {
        const channel =
          message.mentions.channels.first() ||
          (args[0]
            ? await message.guild.channels.fetch(args[0]).catch(() => null)
            : null);

        if (!channel || channel.type !== ChannelType.GuildText) {
          await message.reply(
            "Please mention a text channel or provide its channel ID. Example: `!setleave #goodbye`.",
          );
          return;
        }

        await db.set(`leave_${guildId}`, channel.id);

        await message.reply(`Saved farewell channel: ${channel}.`);

        return;
      }

      // !leavedesc <message>
      // Save a custom farewell message.
      if (command === "leavedesc") {
        if (!rest) {
          await message.reply(
            "Provide a farewell message. Variables: `?user`, `?tag`, `?server`, `?count`.",
          );
          return;
        }

        if (rest.length > 4000) {
          await message.reply(
            "Please keep the farewell message under 4,000 characters.",
          );
          return;
        }

        await db.set(`leavedesc_${guildId}`, rest);

        await message.reply("Farewell message saved.");

        return;
      }

      // !leaveoff
      // Disable automatic farewell messages.
      if (command === "leaveoff") {
        await db.delete(`leave_${guildId}`);

        await message.reply("Farewell messages disabled.");

        return;
      }

      // !leavetest
      // Preview the farewell message in the current channel.
      if (command === "leavetest") {
        const savedText = await db.get(`leavedesc_${guildId}`);

        const text =
          savedText ||
          "💀 **ONE LESS MOTHERFUCKER IN THE SERVER!**\n\n" +
            "**?user** has left the fucking building. " +
            "No goodbye, no explanation—just gone. 😈\n\n" +
            "Members remaining: **?count**";

        const description = replaceFarewellVariables(text, message.member);

        await message.channel.send({
          embeds: [makeFarewellEmbed(description, message.member)],
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      console.error(`Farewell command "${command}" failed:`, error);

      await message
        .reply("Something went wrong with the farewell command.")
        .catch(() => {});
    }
  });
};
