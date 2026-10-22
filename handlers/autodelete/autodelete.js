const { Events, PermissionsBitField } = require("discord.js");

const PREFIX = "!";
const COMMAND = "autodelete";
const BATCH_SIZE = 100;
const runningCleanups = new Map();

const DURATIONS = {
  "1minute": 60 * 1000,
  "1min": 60 * 1000,
  "1m": 60 * 1000,
  "1day": 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "24hours": 24 * 60 * 60 * 1000,
};

function parseDuration(input) {
  const value = input.toLowerCase();
  const match = value.match(
    /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/,
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isSafeInteger(amount) || amount < 1) return null;

  let multiplier;

  if (["m", "min", "mins", "minute", "minutes"].includes(unit)) {
    multiplier = 60 * 1000;
  } else if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) {
    multiplier = 60 * 60 * 1000;
  } else {
    multiplier = 24 * 60 * 60 * 1000;
  }

  return amount * multiplier;
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  if (args[0].toLowerCase() !== `${PREFIX}${COMMAND}`) return;

  if (
    !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)
  ) {
    await message.reply(
      "You need the **Manage Messages** permission to use this command.",
    );
    return;
  }

  function parseDuration(input) {
    const value = input.toLowerCase();
    const match = value.match(
      /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/,
    );

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isSafeInteger(amount) || amount < 1) return null;

    let multiplier;

    if (["m", "min", "mins", "minute", "minutes"].includes(unit)) {
      multiplier = 60 * 1000;
    } else if (["h", "hr", "hrs", "hour", "hours"].includes(unit)) {
      multiplier = 60 * 60 * 1000;
    } else {
      multiplier = 24 * 60 * 60 * 1000;
    }

    return amount * multiplier;
  }

  const channel = message.channel;
  const channelId = channel.id;
  const option = (args[1] || "").toLowerCase();

  if (option === "cancel") {
    const cleanup = runningCleanups.get(channelId);

    if (!cleanup) {
      await message.reply(
        "There's no active cleanup to cancel in this channel.",
      );
      return;
    }

    cleanup.cancelled = true;

    await message.reply(
      "Cancellation requested. I'll stop the cleanup shortly.",
    );
    return;
  }

  const maxAge = parseDuration(option);
  if (!maxAge) {
    await message.reply(
      "**Auto-delete usage**\n" +
        "`!autodelete 5m` — delete messages from the past 5 minutes\n" +
        "`!autodelete 30minutes` — delete messages from the past 30 minutes\n" +
        "`!autodelete 2h` — delete messages from the past 2 hours\n" +
        "`!autodelete 1day` — delete messages from the past 24 hours\n" +
        "`!autodelete cancel` — cancel a running cleanup",
    );
    return;
  }

  if (runningCleanups.has(channelId)) {
    await message.reply(
      "A cleanup is already running in this channel. Use `!autodelete cancel` first.",
    );
    return;
  }

  if (!channel.isTextBased() || !channel.messages || !channel.bulkDelete) {
    await message.reply("This channel doesn't support message cleanup.");
    return;
  }

  const cleanup = { cancelled: false };
  runningCleanups.set(channelId, cleanup);

  const cutoff = Date.now() - maxAge;
  let before;
  let deletedCount = 0;
  let failedCount = 0;

  const status = await message
    .reply(
      `Starting cleanup of messages from the past ${option === "1day" || option === "1d" || option === "24h" || option === "24hours" ? "24 hours" : "minute"}...`,
    )
    .catch(() => null);

  try {
    while (!cleanup.cancelled) {
      const options = { limit: BATCH_SIZE };
      if (before) options.before = before;

      const messages = await channel.messages.fetch(options);
      if (messages.size === 0) break;

      before = messages.last().id;

      const eligible = messages.filter((msg) => msg.createdTimestamp >= cutoff);

      if (eligible.size >= 2) {
        const deleted = await channel.bulkDelete(eligible, true);
        deletedCount += deleted.size;
        failedCount += eligible.size - deleted.size;
      } else if (eligible.size === 1) {
        try {
          await eligible.first().delete();
          deletedCount++;
        } catch (error) {
          failedCount++;
          console.error(
            "[AutoDelete] Failed to delete message:",
            error.message,
          );
        }
      }

      if (messages.some((msg) => msg.createdTimestamp < cutoff)) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const result = cleanup.cancelled
      ? `Cleanup cancelled. Deleted **${deletedCount} messages** before cancellation.`
      : `Cleanup finished. Deleted **${deletedCount} messages**.`;

    const details = failedCount
      ? `\nFailed to delete **${failedCount} messages**.`
      : "";

    if (status) {
      await status.edit(`${result}${details}`).catch(() => {});
    }
  } catch (error) {
    console.error("[AutoDelete]", error);

    if (status) {
      await status
        .edit(
          `Cleanup stopped due to an error. Deleted **${deletedCount} messages** so far.`,
        )
        .catch(() => {});
    }
  } finally {
    runningCleanups.delete(channelId);
  }
}

function registerAutoDelete(client) {
  client.on(Events.MessageCreate, handleMessage);
  console.log("[AutoDelete] History cleanup command registered.");
}

module.exports = { registerAutoDelete };
