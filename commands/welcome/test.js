const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
  name: "test",
  description: "Preview the embed welcome message in the configured welcome channel.",
  usage: "test",
  category: ":frame_photo: WELCOME",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    const [channelId, text, img, nail] = await Promise.all([
      db.get(`welcome_${message.guild.id}`),
      db.get(`desc_${message.guild.id}`),
      db.get(`image_${message.guild.id}`),
      db.get(`thumbnail_${message.guild.id}`),
    ]);

    if (!channelId) {
      return message.channel.send(
        "Welcome channel is not set. Use `setwelcomechannel` first."
      );
    }
    if (!text) {
      return message.channel.send(
        "Welcome description is not set. Use `setdescription` first."
      );
    }
    if (!nail) {
      return message.channel.send(
        "Welcome thumbnail is not set. Use `setthumbnail` first."
      );
    }

    const memberCount = message.guild.memberCount;

    const description = text
      .replace(/`?\?user`?/g, message.author.username)
      .replace(/`?\?server`?/g, message.guild.name)
      .replace(/`?\?tag`?/g, message.author.tag)
      .replace(/`?\?mention`?/g, `<@${message.author.id}>`)
      .replace(/`?\?rank`?/g, memberCount);

    const thumbnail = nail
      .replace(/`?\?useravatar`?/g, message.author.displayAvatarURL({ forceStatic: false }))
      .replace(/`?\?serveravatar`?/g, message.guild.iconURL({ forceStatic: false }));

    const embed = new EmbedBuilder()
      .setTitle(`Welcome to ${message.guild.name}`)
      .setDescription(
        `${description}\n\n*This is a preview — the note below only appears during testing.*\n` +
          `[Join the support server](https://discord.gg/gU7XAxTpX5)`
      )
      .setColor("Random")
      .setThumbnail(thumbnail);

    if (img) embed.setImage(img);

    const welcomeChannel = client.channels.cache.get(channelId);
    if (!welcomeChannel) {
      return message.channel.send("The configured welcome channel could not be found.");
    }

    await welcomeChannel.send({ embeds: [embed] });
  },
};