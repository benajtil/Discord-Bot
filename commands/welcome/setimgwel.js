const { PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "setimagewelcome",
  aliases: ["setimgwel", "siw"],
  usage: "setimagewelcome <#channel>",
  category: ":frame_photo: WELCOME",
  description: "Set the channel where image-based welcome cards will be sent.",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    const channel = message.mentions.channels.first();

    if (!channel) {
      return message.channel.send("Please mention a valid channel, e.g. `setimagewelcome #welcome`.");
    }

    await db.set(`welcomeimg_${message.guild.id}`, channel.id);
    return message.channel.send(`Image welcome channel set to ${channel}.`);
  },
};