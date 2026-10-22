const { Events, PermissionsBitField } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "llama3.2:3b";

const CONFIG_PATH = path.join(__dirname, "ysabelle_personality.json");

const MAX_HISTORY = 12;
const COOLDOWN_MS = 3000;

const conversations = new Map();
const cooldowns = new Map();
const serverPersonalities = new Map();

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function getConversationKey(message) {
  return `${message.guildId}:${message.channelId}:${message.author.id}`;
}

function getConversation(key) {
  if (!conversations.has(key)) conversations.set(key, []);
  return conversations.get(key);
}

function isTalkingToYsabelle(message, client) {
  if (message.mentions.has(client.user)) return true;

  return Boolean(
    message.reference?.messageId &&
    message.mentions.repliedUser?.id === client.user.id,
  );
}

function findExamples(config, tone, prompt) {
  const examples = [
    ...(config.replyExamples || []),
    ...(config.learnedExamples || []),
  ];

  const words = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((word) => word.length > 3);

  return examples
    .filter((example) => example.tone === tone)
    .map((example) => {
      const exampleWords = `${example.user} ${example.reply}`.toLowerCase();
      const score = words.reduce(
        (total, word) => total + Number(exampleWords.includes(word)),
        0,
      );
      return { example, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.example);
}

function getReplyMode(config) {
  const mode = config.settings.replyMode;
  return ["mention", "all", "selected"].includes(mode) ? mode : "mention";
}

function canReplyWithoutMention(message, config) {
  const mode = getReplyMode(config);

  if (mode === "mention") return false;
  if (mode === "all") return true;

  const channels = config.settings.replyChannels || [];
  return channels.includes(message.channelId);
}

async function askOllama(messages) {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages,
      options: { temperature: 0.85 },
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.message?.content?.trim() || "";
}

async function handleMessage(message, client) {
  if (!message.guild || message.author.bot || message.webhookId) return;

  const content = message.content.trim();
  const config = loadConfig();

  if (/^!forget$/i.test(content)) {
    conversations.delete(getConversationKey(message));
    await message.reply("Recent conversation cleared for this channel.");
    return;
  }

  if (/^!replymode(?:\s|$)/i.test(content)) {
    if (
      !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      await message.reply(
        "You need the Manage Server permission to change my reply mode.",
      );
      return;
    }

    const args = content.split(/\s+/);
    const requestedMode = args[1]?.toLowerCase();

    if (!requestedMode || requestedMode === "status") {
      await message.reply(
        `Current reply mode: **${getReplyMode(config)}**\n` +
          "`!replymode mention` — Reply only when mentioned\n" +
          "`!replymode all` — Consider all messages for a reply\n" +
          "`!replymode selected #channel` — Reply in selected channels\n" +
          "`!replymode add #channel` — Add a channel in selected mode\n" +
          "`!replymode remove #channel` — Remove a channel\n" +
          "`!replymode chance 25` — Set reply chance to 25%",
      );
      return;
    }

    config.settings.replyChannels ||= [];

    if (["mention", "all", "selected"].includes(requestedMode)) {
      config.settings.replyMode = requestedMode;
      saveConfig(config);
      await message.reply(`Reply mode set to **${requestedMode}**.`);
      return;
    }

    if (
      ["add", "remove", "selected"].includes(requestedMode) &&
      (requestedMode !== "selected" || args[2])
    ) {
      const channel =
        message.mentions.channels.first() ||
        message.guild.channels.cache.get(args[2]?.replace(/[<#>]/g, ""));

      if (!channel) {
        await message.reply(
          "Mention a text channel, like `!replymode add #general`.",
        );
        return;
      }

      if (requestedMode === "remove") {
        config.settings.replyChannels = config.settings.replyChannels.filter(
          (id) => id !== channel.id,
        );
      } else {
        if (!config.settings.replyChannels.includes(channel.id)) {
          config.settings.replyChannels.push(channel.id);
        }
        config.settings.replyMode = "selected";
      }

      saveConfig(config);
      await message.reply(
        requestedMode === "remove"
          ? `Removed ${channel} from my reply channels.`
          : `I'll consider replying in ${channel}. Reply mode is **selected**.`,
      );
      return;
    }

    if (requestedMode === "chance") {
      const percentage = Number(args[2]);

      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        await message.reply(
          "Choose a percentage from 0 to 100, e.g. `!replymode chance 25`.",
        );
        return;
      }

      config.settings.replyChance = percentage / 100;
      saveConfig(config);
      await message.reply(
        `My automatic reply chance is now **${percentage}%**.`,
      );
      return;
    }

    await message.reply(
      "Unknown option. Use `!replymode` to see the commands.",
    );
    return;
  }

  const toneMatch = content.match(
    /^!tone\s+(friendly|funny|chill|helpful|darkhumor)$/i,
  );

  if (toneMatch) {
    if (
      !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      await message.reply(
        "You need the Manage Server permission to change my personality.",
      );
      return;
    }

    const tone = toneMatch[1].toLowerCase();
    serverPersonalities.set(message.guildId, tone);
    await message.reply(`Personality updated: ${tone}.`);
    return;
  }

  const mentioned = isTalkingToYsabelle(message, client);
  const automatic = !mentioned && canReplyWithoutMention(message, config);

  if (!mentioned && !automatic) return;

  if (automatic) {
    const chance = Number(config.settings.replyChance ?? 0.25);
    if (Math.random() >= Math.max(0, Math.min(1, chance))) return;
  }

  const now = Date.now();
  const lastUsed = cooldowns.get(message.author.id) || 0;
  if (now - lastUsed < COOLDOWN_MS) return;

  cooldowns.set(message.author.id, now);

  const prompt = content
    .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
    .trim();

  if (!prompt) {
    await message.reply("What's up?");
    return;
  }

  const tone =
    serverPersonalities.get(message.guildId) ||
    config.settings.defaultPersonality ||
    "friendly";

  const personality = config.personalities[tone];
  if (!personality) throw new Error(`Unknown personality: ${tone}`);

  const key = getConversationKey(message);
  const history = getConversation(key);
  const examples = findExamples(config, tone, prompt);

  const exampleText = examples.length
    ? examples
        .map((example) => `User: ${example.user}\nYsabelle: ${example.reply}`)
        .join("\n\n")
    : "No matching examples. Respond naturally and create an original reply.";

  const language = config.settings.defaultLanguage || "taglish";
  const languageInstructions = {
    english: "Reply in natural English only.",
    tagalog: "Reply in natural Tagalog.",
    taglish: "Use a natural mix of English and Tagalog.",
  };

  const systemPrompt = `
You are Ysabelle, a Filipino Discord AI companion.

PERSONALITY: ${tone}
${personality.description}

PERSONALITY RULES:
${personality.instructions.map((rule) => `- ${rule}`).join("\n")}

LANGUAGE:
${languageInstructions[language] || languageInstructions.taglish}

GENERAL RULES:
- Match the user's conversational energy.
- Use recent conversation history when relevant.
- Do not pretend to remember information outside the available context.
- Do not repeat example replies word for word unless appropriate.
- Emojis are optional. Do not put an emoji in every reply.
- Keep casual replies short.
- Be empathetic when someone is genuinely distressed.
- Do not treat jokes as confirmed personal facts.

STYLE EXAMPLES:
${exampleText}
`;

  try {
    await message.channel.sendTyping();

    const answer = await askOllama([
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: prompt },
    ]);

    if (!answer) {
      await message.reply("I can't think of a reply right now.");
      return;
    }

    const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
    for (const chunk of chunks) await message.reply(chunk);

    history.push(
      { role: "user", content: prompt },
      { role: "assistant", content: answer },
    );

    while (history.length > MAX_HISTORY) history.shift();

    config.learnedExamples ||= [];

    const normalizedPrompt = prompt.slice(0, 500);
    const normalizedAnswer = answer.slice(0, 1000);

    if (
      normalizedPrompt &&
      normalizedAnswer &&
      !config.learnedExamples.some(
        (item) => item.tone === tone && item.user === normalizedPrompt,
      )
    ) {
      config.learnedExamples.push({
        tone,
        user: normalizedPrompt,
        reply: normalizedAnswer,
      });

      const maxExamples = config.settings.maxStoredExamples || 200;
      config.learnedExamples = config.learnedExamples.slice(-maxExamples);
      saveConfig(config);
    }
  } catch (error) {
    console.error("[Ysabelle AI]", error.message);
    await message
      .reply(
        "My AI is having trouble right now. Check whether Ollama is running.",
      )
      .catch(() => {});
  }
}

function registerAutoReply(client) {
  client.on(Events.MessageCreate, (message) => {
    handleMessage(message, client).catch((error) => {
      console.error("[Ysabelle AutoReply]", error);
    });
  });

  console.log("[Ysabelle AI] Personality, memory, and reply modes loaded.");
}

module.exports = { registerAutoReply };
