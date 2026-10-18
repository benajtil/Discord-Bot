const { PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "setwelcomechannel",
  aliases: ["setwelcome", "sw"],
  usage: "setwelcomechannel <#channel>",
  category: ":frame_photo: WELCOME",
  description: "Set the channel where welcome embeds will be sent.",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    const channel = message.mentions.channels.first();

    if (!channel) {
      return message.channel.send(
        "Please mention a valid channel, e.g. `setwelcomechannel #welcome`."
      );
    }

    await db.set(`welcome_${message.guild.id}`, channel.id);
    return message.channel.send(`Welcome channel set to ${channel}.`);
  },
};