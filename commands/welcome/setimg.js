const { PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "setimage",
  aliases: ["setimg", "si"],
  category: ":frame_photo: WELCOME",
  usage: "setimage <url>",
  description: "Set the image displayed in the welcome embed.",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    const url = args.join(" ");

    if (!url) {
      return message.channel.send(
        `**${message.author.username}**, please provide a valid image URL.`
      );
    }

    await db.set(`image_${message.guild.id}`, url);
    return message.channel.send(`Welcome embed image updated to:\n\`${url}\``);
  },
};