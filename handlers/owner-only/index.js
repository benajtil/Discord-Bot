const { Collection } = require("discord.js");

function createOwnerOnly(client, options = {}) {
  const ownerId = String(
    options.ownerId || process.env.BOT_OWNER_ID || "",
  ).trim();

  const xpDb = options.xpDb;
  const commands = new Collection();

  // Load owner-only commands
  const levelCommand = require("./level");
  commands.set(levelCommand.name, levelCommand);

  async function handleMessage(message) {
    if (!message.guild || message.author.bot) return false;

    if (!message.content.startsWith("!")) return false;

    const args = message.content.trim().slice(1).split(/\s+/);
    const commandName = args.shift()?.toLowerCase();

    const command = commands.get(commandName);
    if (!command) return false;

    // Strict bot owner authorization.
    // Server owner and Administrator permissions are ignored.
    if (!ownerId || message.author.id !== ownerId) {
      await message.delete().catch(() => {});
      return true;
    }

    // Delete the command message to keep it out of public chat.
    await message.delete().catch(() => {});

    try {
      await command.execute({
        client,
        message,
        args,
        xpDb,
      });
    } catch (error) {
      console.error(`[OWNER COMMAND: ${commandName}]`, error);

      await message.author
        .send("An error occurred while executing this owner command.")
        .catch(() => {});
    }

    return true;
  }

  return {
    handleMessage,
    commands,
  };
}

module.exports = createOwnerOnly;
