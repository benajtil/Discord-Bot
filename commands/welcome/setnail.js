const { PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "setthumbnail",
  aliases: ["setnail", "st"],
  category: ":frame_photo: WELCOME",
  usage: "setthumbnail <url|tag>",
  description:
    "Set the thumbnail for the welcome embed. Use `?useravatar` for the member's avatar or `?serveravatar` for the server icon.",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    const value = args.join(" ");

    if (!value) {
      return message.channel.send(
        `**${message.author.username}**, please provide a URL or a tag.\n` +
          `Tags: \`?useravatar\` (member avatar), \`?serveravatar\` (server icon)`
      );
    }

    await db.set(`thumbnail_${message.guild.id}`, value);
    return message.channel.send(`Welcome thumbnail updated to:\n\`${value}\``);
  },
};