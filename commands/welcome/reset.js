const { PermissionFlagsBits } = require("discord.js");

module.exports = {
  name: "reset",
  description: "Clear all welcome settings for this server.",
  usage: "reset",
  category: ":frame_photo: WELCOME",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    await Promise.all([
      db.delete(`welcome_${message.guild.id}`),
      db.delete(`desc_${message.guild.id}`),
      db.delete(`image_${message.guild.id}`),
      db.delete(`thumbnail_${message.guild.id}`),
      db.delete(`welcomeimg_${message.guild.id}`),
    ]);

    return message.channel.send("All welcome settings have been reset.");
  },
};