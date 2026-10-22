const { Events, PermissionFlagsBits } = require("discord.js");

const MAX_CHANNEL_MESSAGES = 100;
const MAX_USER_MESSAGES = 50;
const MAX_FACTS = 20;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_FACT_LENGTH = 300;
const RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = function registerMemory(client, db, PREFIX = "!") {
  // Database keys are separated by server, channel, and user.
  const keys = {
    enabled: (guildId, userId) => `memory_enabled_${guildId}_${userId}`,

    channel: (guildId, channelId) => `memory_channel_${guildId}_${channelId}`,

    user: (guildId, userId) => `memory_user_${guildId}_${userId}`,

    facts: (guildId, userId) => `memory_facts_${guildId}_${userId}`,
  };

  function isStaff(message) {
    return message.member?.permissions.has(PermissionFlagsBits.ManageGuild);
  }

  function cleanText(text, maxLength) {
    return String(text || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .slice(0, maxLength)
      .trim();
  }

  function isFresh(item) {
    return (
      item &&
      typeof item.timestamp === "number" &&
      Date.now() - item.timestamp <= RETENTION_DAYS * DAY_MS
    );
  }

  function prune(items, limit) {
    return (Array.isArray(items) ? items : []).filter(isFresh).slice(-limit);
  }

  async function getSavedMessages(key, limit) {
    const saved = await db.get(key);
    const fresh = prune(saved, limit);

    // Save the cleaned list so expired records are removed.
    if (!Array.isArray(saved) || fresh.length !== saved.length) {
      await db.set(key, fresh);
    }

    return fresh;
  }

  async function saveMessage(message) {
    const guildId = message.guild.id;
    const userId = message.author.id;
    const channelId = message.channel.id;

    // Only save messages from members who opted in.
    const enabled = await db.get(keys.enabled(guildId, userId));
    if (enabled !== true) return;

    // Never save bot commands or messages that are too short.
    const content = cleanText(message.content, MAX_MESSAGE_LENGTH);
    if (!content || content.startsWith(PREFIX)) return;

    const entry = {
      userId,
      username: cleanText(
        message.member?.displayName || message.author.username,
        80,
      ),
      channelId,
      content,
      timestamp: Date.now(),
    };

    // Save to the channel's shared history.
    const channelKey = keys.channel(guildId, channelId);
    const channelMessages = await getSavedMessages(
      channelKey,
      MAX_CHANNEL_MESSAGES,
    );

    channelMessages.push(entry);
    await db.set(channelKey, prune(channelMessages, MAX_CHANNEL_MESSAGES));

    // Save separately to the member's own history.
    const userKey = keys.user(guildId, userId);
    const userMessages = await getSavedMessages(userKey, MAX_USER_MESSAGES);

    userMessages.push(entry);
    await db.set(userKey, prune(userMessages, MAX_USER_MESSAGES));
  }

  async function showHistory(message, mode) {
    const guildId = message.guild.id;
    const userId = message.author.id;

    if (mode === "user") {
      const history = await getSavedMessages(
        keys.user(guildId, userId),
        MAX_USER_MESSAGES,
      );

      if (!history.length) {
        await message.reply("I don't have any saved messages for you yet.");
        return;
      }

      const lines = history.slice(-10).map((item) => {
        const date = new Date(item.timestamp).toLocaleString();
        return `**${date}**\n${item.content}`;
      });

      await message.author
        .send({
          content:
            `Your recent saved messages in **${message.guild.name}**:\n\n${lines.join("\n\n")}`.slice(
              0,
              1900,
            ),
          allowedMentions: { parse: [] },
        })
        .then(() => message.reply("I sent your saved history to your DMs."))
        .catch(() =>
          message.reply("I couldn't DM you. Please enable DMs and try again."),
        );

      return;
    }

    if (mode === "channel") {
      if (!isStaff(message)) {
        await message.reply(
          "Only staff with **Manage Server** can view channel memory.",
        );
        return;
      }

      const history = await getSavedMessages(
        keys.channel(guildId, message.channel.id),
        MAX_CHANNEL_MESSAGES,
      );

      if (!history.length) {
        await message.reply("There are no saved messages for this channel.");
        return;
      }

      const lines = history.slice(-10).map((item) => {
        const date = new Date(item.timestamp).toLocaleString();
        return `**${item.username} • ${date}**\n${item.content}`;
      });

      await message.author
        .send({
          content:
            `Recent saved messages from #${message.channel.name}:\n\n${lines.join("\n\n")}`.slice(
              0,
              1900,
            ),
          allowedMentions: { parse: [] },
        })
        .then(() => message.reply("I sent the channel history to your DMs."))
        .catch(() =>
          message.reply("I couldn't DM you. Please enable DMs and try again."),
        );

      return;
    }
  }

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot || !message.guild) return;

      const content = message.content.trim();
      if (!content.toLowerCase().startsWith(`${PREFIX}memory`)) {
        await saveMessage(message);
        return;
      }

      const args = content.split(/\s+/);
      const action = (args[1] || "help").toLowerCase();
      const rest = content.slice(`${PREFIX}memory`.length).trim();
      const detail = rest.slice(action.length).trim();

      const guildId = message.guild.id;
      const userId = message.author.id;

      if (action === "help") {
        await message.reply(
          [
            "**Ysabelle • Memory commands**",
            "`!memory on` — Opt in to message storage",
            "`!memory off` — Stop storing your future messages",
            "`!memory show` — DM your recent saved history",
            "`!memory clear` — Delete your saved history and facts",
            "`!memory remember <fact>` — Save a long-term fact",
            "`!memory facts` — View your saved facts",
            "`!memory forget <number>` — Delete one saved fact",
            "`!memory channel` — Staff: view this channel's saved history",
            "`!memory channelclear` — Staff: clear this channel's history",
          ].join("\n"),
        );
        return;
      }

      if (action === "on") {
        await db.set(keys.enabled(guildId, userId), true);
        await message.reply(
          "Memory is now on for you. New messages in this server may be saved for up to 30 days, with a maximum of 50 in your personal history and 100 per channel. Use `!memory off` to opt out.",
        );
        return;
      }

      if (action === "off") {
        await db.set(keys.enabled(guildId, userId), false);
        await message.reply(
          "Memory is off for you. Your previously saved messages remain until you use `!memory clear` or they expire.",
        );
        return;
      }

      if (action === "show") {
        await showHistory(message, "user");
        return;
      }

      if (action === "channel") {
        await showHistory(message, "channel");
        return;
      }

      if (action === "clear") {
        await db.delete(keys.user(guildId, userId));
        await db.delete(keys.facts(guildId, userId));
        await db.set(keys.enabled(guildId, userId), false);

        // Remove this member's entries from every channel history
        // the bot can currently see in the server.
        for (const channel of message.guild.channels.cache.values()) {
          const key = keys.channel(guildId, channel.id);
          const history = await db.get(key);

          if (Array.isArray(history)) {
            await db.set(
              key,
              history.filter((item) => item.userId !== userId),
            );
          }
        }

        await message.reply(
          "Your saved message history and long-term facts have been cleared. Memory is now off for you.",
        );
        return;
      }

      if (action === "remember") {
        if (!detail) {
          await message.reply(
            "Usage: `!memory remember <fact>` — only save information you want Ysabelle to remember.",
          );
          return;
        }

        const fact = cleanText(detail, MAX_FACT_LENGTH);
        const key = keys.facts(guildId, userId);
        const facts = (await db.get(key)) || [];

        if (facts.length >= MAX_FACTS) {
          await message.reply(
            `You can save up to ${MAX_FACTS} facts. Use \`!memory forget <number>\` to remove one.`,
          );
          return;
        }

        facts.push({
          fact,
          timestamp: Date.now(),
        });

        await db.set(key, facts);
        await message.reply("Saved that fact to your long-term memory. 💜");
        return;
      }

      if (action === "facts") {
        const facts = (await db.get(keys.facts(guildId, userId))) || [];

        if (!facts.length) {
          await message.reply("You don't have any saved long-term facts.");
          return;
        }

        const lines = facts.map(
          (item, index) => `**${index + 1}.** ${item.fact}`,
        );

        await message.author
          .send({
            content:
              `**Your saved facts in ${message.guild.name}**\n\n${lines.join("\n")}`.slice(
                0,
                1900,
              ),
            allowedMentions: { parse: [] },
          })
          .then(() => message.reply("I sent your saved facts to your DMs."))
          .catch(() =>
            message.reply(
              "I couldn't DM you. Please enable DMs and try again.",
            ),
          );

        return;
      }

      if (action === "forget") {
        const number = Number.parseInt(detail, 10);
        const key = keys.facts(guildId, userId);
        const facts = (await db.get(key)) || [];

        if (!Number.isInteger(number) || number < 1 || number > facts.length) {
          await message.reply(
            "Choose a valid fact number from `!memory facts`.",
          );
          return;
        }

        facts.splice(number - 1, 1);
        await db.set(key, facts);
        await message.reply("That fact has been deleted.");
        return;
      }

      if (action === "channelclear") {
        if (!isStaff(message)) {
          await message.reply(
            "Only staff with **Manage Server** can clear channel memory.",
          );
          return;
        }

        await db.delete(keys.channel(guildId, message.channel.id));
        await message.reply("Saved history for this channel has been cleared.");
        return;
      }

      await message.reply("Unknown memory command. Use `!memory help`.");
    } catch (error) {
      console.error("Memory feature error:", error);
      await message
        .reply("I couldn't complete that memory action.")
        .catch(() => {});
    }
  });

  console.log("Ysabelle conversation memory registered.");
};
