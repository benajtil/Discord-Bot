module.exports = {
  name: "setlevel",

  async execute({ message, args, xpDb }) {
    if (!xpDb) {
      throw new Error("XP database was not connected.");
    }

    const target = message.mentions.members.first();
    const requestedLevel = Number(args[1]);

    if (!target) {
      return message.author
        .send(
          "❌ **Invalid command usage.**\n\n" +
            "Usage: `!setlevel @member <level>`\n" +
            "Example: `!setlevel @member 50`",
        )
        .catch(() => {});
    }

    if (target.user.bot) {
      return message.author
        .send("❌ You cannot change a bot account's level.")
        .catch(() => {});
    }

    if (
      !Number.isInteger(requestedLevel) ||
      requestedLevel < 0 ||
      requestedLevel > 100
    ) {
      return message.author
        .send("❌ Level must be between **0 and 100**.")
        .catch(() => {});
    }

    const guildId = message.guild.id;
    const userId = target.id;

    // Retrieve current XP and level.
    const currentXp = Number(xpDb.getXp(guildId, userId)) || 0;

    const currentLevel = Math.min(
      100,
      Math.floor(Math.sqrt(Math.max(0, currentXp) / 100)),
    );

    // Calculate exact XP for the requested level.
    const newXp = requestedLevel * requestedLevel * 100;

    // Apply positive or negative XP difference.
    const difference = newXp - currentXp;

    if (difference !== 0) {
      xpDb.addXp(guildId, userId, difference);
    }

    // Verify database update.
    const updatedXp = Number(xpDb.getXp(guildId, userId)) || 0;

    const updatedLevel = Math.min(
      100,
      Math.floor(Math.sqrt(Math.max(0, updatedXp) / 100)),
    );

    if (updatedLevel !== requestedLevel) {
      throw new Error("The database did not save the requested level.");
    }

    console.log(
      `[OWNER LEVEL] ${message.author.tag} changed ${target.user.tag}: ` +
        `${currentLevel} -> ${updatedLevel}`,
    );

    await message.author
      .send(
        `✅ **LEVEL UPDATED SUCCESSFULLY**\n\n` +
          `**Server:** ${message.guild.name}\n` +
          `**Member:** ${target.user.tag}\n\n` +
          `**Previous Level:** ${currentLevel}\n` +
          `**New Level:** ${updatedLevel}\n` +
          `**Previous XP:** ${currentXp.toLocaleString()}\n` +
          `**New XP:** ${updatedXp.toLocaleString()}`,
      )
      .catch(() => {});
  },
};
