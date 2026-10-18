const { PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "setdescription",
  aliases: ["setdesc", "sd"],
  category: ":frame_photo: WELCOME",
  usage: "setdescription <message>",
  description: "Set the welcome embed description. Supports tags: ?user, ?tag, ?mention, ?server, ?rank.",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    const text = args.join(" ");

    if (!text) {
      return message.channel.send(
        `**${message.author.username}**, please provide a description.\nAvailable tags: \`?user\`, \`?tag\`, \`?mention\`, \`?server\`, \`?rank\``
      );
    }

    if (text.length > 1024) {
      return message.channel.send(
        `**${message.author.username}**, the description must be under 1024 characters.`
      );
    }

    await db.set(`desc_${message.guild.id}`, text);

    // Preview with current user's info as example
    const preview = text
      .replace(/`?\?user`?/g, message.author.username)
      .replace(/`?\?server`?/g, message.guild.name)
      .replace(/`?\?tag`?/g, message.author.tag)
      .replace(/`?\?mention`?/g, `<@${message.author.id}>`);

    return message.channel.send(
      `Welcome description updated. Preview:\n\`${preview}\``
    );
  },
};
