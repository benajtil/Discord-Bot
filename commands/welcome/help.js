const { EmbedBuilder } = require("discord.js");
const { prefix } = require("../../config.json");

module.exports = {
  name: "help",
  description: "Get a list of all commands, or details about a specific command.",
  usage: "help [command]",
  category: ":frame_photo: WELCOME",
  run: async (client, message, args) => {
    // Show info for a specific command
    if (args[0]) {
      const command =
        client.commands.get(args[0]) ??
        client.commands.get(client.aliases.get(args[0]));

      if (!command) {
        return message.channel.send(`Unknown command: \`${args[0]}\``);
      }

      const embed = new EmbedBuilder()
        .setAuthor({ name: command.name, iconURL: client.user.displayAvatarURL() })
        .addFields(
          {
            name: "Description",
            value: command.description ?? "No description provided.",
          },
          {
            name: "Usage",
            value: command.usage ? `\`${command.usage}\`` : "Not provided.",
          },
          {
            name: "Aliases",
            value:
              command.aliases?.length
                ? command.aliases.map((a) => `\`${a}\``).join(", ")
                : "None",
          }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setColor("#000000")
        .setFooter({ text: "Join our support server for more help." });

      const sent = await message.channel.send({ embeds: [embed] });
      setTimeout(() => sent.delete().catch(() => {}), 8000);
      return;
    }

    // Build main help embed
    const emx = new EmbedBuilder()
      .setDescription(
        `**Note:** You must set \`welcomechannel\`, \`description\`, and \`thumbnail\` before the welcome system works.\n\n` +
          `**\`${prefix}setwelcomechannel <#channel>\`** — Set the embed welcome channel *(required)*\n` +
          `**\`${prefix}setdescription <text>\`** — Set the welcome description *(required)*\n` +
          `**\`${prefix}setthumbnail <link|tag>\`** — Set the thumbnail *(required)*\n` +
          `**\`${prefix}setimage <link>\`** — Set the embed image *(optional)*\n` +
          `**\`${prefix}setimagewelcome <#channel>\`** — Set the image welcome channel *(optional)*\n` +
          `**\`${prefix}test\`** — Preview the welcome embed\n` +
          `**\`${prefix}testimage\`** — Preview the image welcome\n` +
          `**\`${prefix}reset\`** — Clear all welcome settings\n\n` +
          `**Description tags:**\n` +
          `\`?user\` → username · \`?tag\` → user#0000 · \`?mention\` → @mention · \`?server\` → server name · \`?rank\` → member count\n\n` +
          `**Thumbnail tags:**\n` +
          `\`?useravatar\` → member avatar · \`?serveravatar\` → server icon\n\n` +
          `Run \`${prefix}help <command>\` for details on any command.`
      )
      .setColor("#FFFFF0")
      .setFooter({ text: "Welcome Bot by Atreya" });

    // Append categorized command list
    const grouped = {};
    for (const command of client.commands.values()) {
      const cat = command.category ?? "Uncategorized";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(command.name);
    }

    for (const [category, names] of Object.entries(grouped)) {
      emx.addFields({
        name: category,
        value: names.map((n) => `\`${n}\``).join(" · "),
      });
    }

    await message.channel.send({ embeds: [emx] });
  },
};
