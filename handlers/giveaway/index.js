const { buildGiveawaySlashCommand } = require("./commands/slash-definition");
const { createSlashHandler } = require("./commands/slash-handler");
const { createPrefixHandler } = require("./commands/prefix-handler");
const { registerButtonHandler } = require("./handlers/interactions");
const { registerMessageTracker } = require("./handlers/message-tracker");
const { getGiveaway } = require("./db");
const { endGiveaway } = require("./services/giveaway");
function createGiveawayModule(client, db, prefix = "!") {
  if (client.__ysabelleGiveawayLoaded)
    return {
      slashCommand: buildGiveawaySlashCommand(),
      handleSlashCommand: async () => false,
      handlePrefix: async () => false,
    };
  client.__ysabelleGiveawayLoaded = true;
  registerButtonHandler(client, db);
  registerMessageTracker(client, db);
  const timer = setInterval(async () => {
    try {
      for (const [guildId] of client.guilds.cache) {
        const g = await getGiveaway(db, guildId);
        if (
          g?.status === "active" &&
          Number(g.endsAt) > 0 &&
          Number(g.endsAt) <= Date.now()
        ) {
          const r = await endGiveaway(client, db, guildId, false, true);
          if (!r.ok)
            console.error(`[Giveaway auto-end] ${guildId}: ${r.reason}`);
        }
      }
    } catch (e) {
      console.error("[Giveaway auto-end]", e);
    }
  }, 30000);
  timer.unref?.();
  return {
    slashCommand: buildGiveawaySlashCommand(),
    handleSlashCommand: createSlashHandler(client, db),
    handlePrefix: createPrefixHandler(client, db, prefix),
  };
}
module.exports = createGiveawayModule;
module.exports.createGiveawayModule = createGiveawayModule;
module.exports.buildGiveawaySlashCommand = buildGiveawaySlashCommand;
