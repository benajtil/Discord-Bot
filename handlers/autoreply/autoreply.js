const { Events, PermissionsBitField, EmbedBuilder } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const { GoogleGenAI } = require("@google/genai");
const { searchTcas } = require("./tcas-search");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const CONFIG_PATH = path.join(__dirname, "ysabelle_personality.json");
const MATERIALS_DIR = path.join(__dirname, "processed");

const MAX_HISTORY = 12;
const COOLDOWN_MS = 3000;
const MAX_MATERIAL_CHARS = 12000;
const MATERIAL_CACHE_MS = 60000;

const conversations = new Map();
const cooldowns = new Map();
const serverPersonalities = new Map();
const registeredClients = new WeakSet();

const materialCache = {
  loadedAt: 0,
  text: "",
};

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  config.settings ||= {};
  config.personalities ||= {};
  config.replyExamples ||= [];
  config.learnedExamples ||= [];
  config.settings.replyChannels ||= [];

  return config;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function getConversationKey(message) {
  return `${message.guildId}:${message.channelId}:${message.author.id}`;
}

function getConversation(key) {
  if (!conversations.has(key)) {
    conversations.set(key, []);
  }

  return conversations.get(key);
}

function isTalkingToYsabelle(message, client) {
  if (message.mentions.has(client.user)) {
    return true;
  }

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
  const mode = config.settings?.replyMode;

  return ["mention", "all", "selected"].includes(mode) ? mode : "mention";
}

function canReplyWithoutMention(message, config) {
  const mode = getReplyMode(config);

  if (mode === "mention") return false;
  if (mode === "all") return true;

  const channels = config.settings?.replyChannels || [];

  return channels.includes(message.channelId);
}

function getTcasReply(prompt) {
  try {
    const samples = searchTcas(prompt, 5);

    if (!Array.isArray(samples) || samples.length === 0) {
      console.log("[Ysabelle AI] No suitable TCAS match. Skipping reply.");
      return null;
    }

    const validSamples = samples
      .filter((sample) => typeof sample === "string")
      .map((sample) => sample.trim())
      .filter(Boolean);

    if (validSamples.length === 0) {
      console.log(
        "[Ysabelle AI] TCAS returned no usable samples. Skipping reply.",
      );
      return null;
    }

    console.log(
      `[Ysabelle AI] TCAS found ${validSamples.length} suitable sample(s).`,
    );

    return { samples: validSamples };
  } catch (error) {
    console.error("[Ysabelle AI] TCAS search failed:", error.message || error);
    return null;
  }
}

function loadConversationMaterials() {
  const now = Date.now();

  if (now - materialCache.loadedAt < MATERIAL_CACHE_MS) {
    return materialCache.text;
  }

  try {
    if (!fs.existsSync(MATERIALS_DIR)) {
      materialCache.text = "";
      materialCache.loadedAt = now;

      console.warn(
        `[Ysabelle AI] Materials directory not found: ${MATERIALS_DIR}`,
      );

      return "";
    }

    const allowedExtensions = new Set([".txt", ".md", ".json"]);
    const excludedNames = new Set(["tlcas-stats.json"]);

    const files = fs
      .readdirSync(MATERIALS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .filter((entry) =>
        allowedExtensions.has(path.extname(entry.name).toLowerCase()),
      )
      .filter((entry) => !excludedNames.has(entry.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));

    const sections = [];
    let totalChars = 0;

    for (const entry of files) {
      const filePath = path.join(MATERIALS_DIR, entry.name);
      let content = fs.readFileSync(filePath, "utf8").trim();

      if (!content) continue;

      if (path.extname(entry.name).toLowerCase() === ".json") {
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          console.warn(
            `[Ysabelle AI] Skipping invalid JSON material: ${entry.name}`,
          );
          continue;
        }
      }

      const remaining = MAX_MATERIAL_CHARS - totalChars;

      if (remaining <= 0) break;

      content = content.slice(0, remaining);

      sections.push(`SOURCE FILE: ${entry.name}\n${content}`);
      totalChars += content.length;
    }

    materialCache.text = sections.join("\n\n---\n\n");
    materialCache.loadedAt = now;

    console.log(
      `[Ysabelle AI] Loaded ${sections.length} processed material file(s), ${totalChars} characters.`,
    );

    return materialCache.text;
  } catch (error) {
    console.error("[Ysabelle AI] Failed to load processed materials:", error);
    return materialCache.text;
  }
}

async function askGroq(messages) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing from .env");
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.85,
      max_completion_tokens: 400,
    }),
    signal: AbortSignal.timeout(45000),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Groq HTTP ${response.status}: ${
        data.error?.message || "Unknown API error"
      }`,
    );
  }

  const answer = data.choices?.[0]?.message?.content?.trim() || "";

  if (!answer) {
    throw new Error("Groq returned an empty response.");
  }

  return answer;
}

async function askOllama(messages) {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages,
      options: {
        temperature: 0.85,
      },
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const data = await response.json();

  return data.message?.content?.trim() || "";
}

async function askGemini(messages) {
  if (!gemini) {
    throw new Error("GEMINI_API_KEY is missing from .env");
  }

  const systemMessage = messages.find((item) => item.role === "system");

  const conversation = messages
    .filter((item) => item.role !== "system")
    .map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    }));

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: conversation,
    config: {
      systemInstruction: systemMessage?.content || "",
      temperature: 0.85,
      maxOutputTokens: 400,
    },
  });

  return response.text?.trim() || "";
}

async function generateAnswer(messages, mode = "auto") {
  if (mode === "groq") {
    return {
      answer: await askGroq(messages),
      provider: "Groq",
    };
  }

  if (mode === "ollama") {
    const answer = await askOllama(messages);

    if (!answer) {
      throw new Error("Ollama returned an empty response.");
    }

    return {
      answer,
      provider: "Ollama",
    };
  }

  if (mode === "gemini") {
    const answer = await askGemini(messages);

    if (!answer) {
      throw new Error("Gemini returned an empty response.");
    }

    return {
      answer,
      provider: "Gemini",
    };
  }

  try {
    const answer = await askGroq(messages);

    if (answer) {
      console.log("[Ysabelle AI] Groq succeeded.");

      return {
        answer,
        provider: "Groq",
      };
    }
  } catch (error) {
    console.error(
      "[Ysabelle AI] Groq failed; trying Gemini:",
      error.message || error,
    );
  }

  try {
    const answer = await askGemini(messages);

    if (answer) {
      console.log("[Ysabelle AI] Gemini fallback succeeded.");

      return {
        answer,
        provider: "Gemini (fallback)",
      };
    }
  } catch (error) {
    console.error(
      "[Ysabelle AI] Gemini fallback failed; trying Ollama:",
      error.message || error,
    );
  }

  try {
    const answer = await askOllama(messages);

    if (answer) {
      console.log("[Ysabelle AI] Ollama fallback succeeded.");

      return {
        answer,
        provider: "Ollama (fallback)",
      };
    }

    throw new Error("Ollama returned an empty response.");
  } catch (error) {
    console.error(
      "[Ysabelle AI] Ollama fallback failed:",
      error.message || error,
    );

    throw new Error("All configured AI providers failed.");
  }
}

async function correctReplyLanguage(answer, language, aiMode) {
  if (language === "taglish") {
    return answer;
  }

  const languageName = language === "english" ? "English" : "Tagalog";

  const correctionPrompt = [
    {
      role: "system",
      content: [
        `Rewrite the response in ${languageName} only.`,
        "Preserve the original meaning, humor, and personality.",
        "Do not add explanations, introductions, or quotation marks.",
        language === "english"
          ? "Never use Tagalog or Taglish unless translation is explicitly requested."
          : "Use natural Tagalog, not English or Taglish.",
      ].join("\n"),
    },
    {
      role: "user",
      content: answer,
    },
  ];

  const result = await generateAnswer(correctionPrompt, aiMode);

  return result.answer || answer;
}
async function handleMessage(message, client) {
  if (!message.guild || message.author.bot || message.webhookId) {
    return;
  }

  const content = message.content.trim();

  if (!content) return;

  let config;

  try {
    config = loadConfig();
  } catch (error) {
    console.error("[Ysabelle AI] Failed to load configuration:", error);
    return;
  }

  if (/^!autoreply(?:\s|$)/i.test(content)) {
    if (
      !message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      await message.reply(
        "You need the Manage Server permission to control auto-reply.",
      );
      return;
    }

    const action = content.split(/\s+/)[1]?.toLowerCase();
    const enabled = config.settings.autoReplyEnabled !== false;

    if (!action || action === "status") {
      await message.reply(
        `Ysabelle auto-reply is currently **${enabled ? "ON" : "OFF"}**.\n` +
          "Use `!autoreply on` or `!autoreply off`.",
      );
      return;
    }

    if (action === "on") {
      config.settings.autoReplyEnabled = true;
      saveConfig(config);
      await message.reply("🔔 Ysabelle auto-reply is now **ON**.");
      return;
    }

    if (action === "off") {
      config.settings.autoReplyEnabled = false;
      saveConfig(config);
      await message.reply("🔕 Ysabelle auto-reply is now **OFF**.");
      return;
    }

    await message.reply(
      "Usage: `!autoreply on`, `!autoreply off`, or `!autoreply status`.",
    );
    return;
  }

  if (/^!aimode(?:\s|$)/i.test(content)) {
    if (
      !message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      await message.reply(
        "You need the Manage Server permission to change my AI mode.",
      );
      return;
    }

    const requestedMode = content.split(/\s+/)[1]?.toLowerCase();
    const currentMode = config.settings.aiMode || "auto";

    if (!requestedMode || requestedMode === "status") {
      await message.reply(
        `Current AI mode: **${currentMode}**\n` +
          "`!aimode auto` — Groq first, Gemini then Ollama fallback\n" +
          "`!aimode groq` — Groq only\n" +
          "`!aimode gemini` — Gemini only\n" +
          "`!aimode ollama` — Ollama only",
      );
      return;
    }

    if (!["auto", "groq", "gemini", "ollama"].includes(requestedMode)) {
      await message.reply("Choose `auto`, `groq`, `gemini`, or `ollama`.");
      return;
    }

    if (requestedMode === "groq" && !GROQ_API_KEY) {
      await message.reply(
        "Groq API key is missing. Add GROQ_API_KEY to your .env file.",
      );
      return;
    }

    if (requestedMode === "gemini" && !process.env.GEMINI_API_KEY) {
      await message.reply(
        "Gemini API key is missing. Add GEMINI_API_KEY to your .env file.",
      );
      return;
    }

    config.settings.aiMode = requestedMode;
    saveConfig(config);
    await message.reply(`AI mode changed to **${requestedMode}**.`);
    return;
  }

  if (/^!forget$/i.test(content)) {
    conversations.delete(getConversationKey(message));
    await message.reply("Recent conversation cleared for this channel.");
    return;
  }

  if (/^!mention(?:\s|$)/i.test(content)) {
    if (
      !message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      await message.reply(
        "You need the Manage Server permission to change mention replies.",
      );
      return;
    }

    const action = content.split(/\s+/)[1]?.toLowerCase();
    const enabled = config.settings.mentionRepliesEnabled !== false;

    if (!action || action === "status") {
      await message.reply(
        `Mention-triggered replies are currently **${enabled ? "ON" : "OFF"}**.\n` +
          "Use `!mention on` or `!mention off`.",
      );
      return;
    }

    if (!["on", "off"].includes(action)) {
      await message.reply(
        "Usage: `!mention on`, `!mention off`, or `!mention status`.",
      );
      return;
    }

    config.settings.mentionRepliesEnabled = action === "on";
    saveConfig(config);

    await message.reply(
      `Mention-triggered replies are now **${action.toUpperCase()}**.`,
    );
    return;
  }

  if (/^!replymode(?:\s|$)/i.test(content)) {
    if (
      !message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)
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
        `Auto-reply: **${config.settings.autoReplyEnabled === false ? "OFF" : "ON"}**\n` +
          `Mention replies: **${config.settings.mentionRepliesEnabled === false ? "OFF" : "ON"}**\n` +
          `Current reply mode: **${getReplyMode(config)}**\n\n` +
          "`!replymode on` — Enable automatic replies\n" +
          "`!replymode off` — Disable automatic replies\n" +
          "`!replymode mention` — Reply only when mentioned\n" +
          "`!replymode all` — Consider all messages\n" +
          "`!replymode selected` — Consider selected channels\n" +
          "`!replymode add #channel` — Add a channel\n" +
          "`!replymode remove #channel` — Remove a channel\n" +
          "`!replymode chance 25` — Set reply chance to 25%",
      );
      return;
    }

    config.settings.replyChannels ||= [];

    if (requestedMode === "on" || requestedMode === "off") {
      config.settings.autoReplyEnabled = requestedMode === "on";
      saveConfig(config);

      await message.reply(
        `Ysabelle automatic replies are now **${requestedMode.toUpperCase()}**.`,
      );
      return;
    }

    if (["mention", "all", "selected"].includes(requestedMode)) {
      config.settings.replyMode = requestedMode;
      saveConfig(config);

      await message.reply(`Reply mode set to **${requestedMode}**.`);
      return;
    }

    if (["add", "remove"].includes(requestedMode)) {
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

  const toneMatch = content.match(/^!tone(?:\s+(\w+))?$/i);

  if (toneMatch) {
    if (
      !message.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      await message.reply(
        "You need the Manage Server permission to change my tone.",
      );
      return;
    }

    const requestedTone = toneMatch[1]?.toLowerCase();
    const languages = ["english", "tagalog", "taglish"];

    const personalities = [
      "friendly",
      "funny",
      "chill",
      "helpful",
      "darkhumor",
    ];

    if (!requestedTone || requestedTone === "status") {
      await message.reply(
        `Current language: **${config.settings.defaultLanguage || "taglish"}**\n` +
          `Current personality: **${serverPersonalities.get(message.guildId) || config.settings.defaultPersonality || "friendly"}**\n\n` +
          "Language commands:\n" +
          "`!tone english`\n`!tone tagalog`\n`!tone taglish`\n\n" +
          "Personality commands:\n" +
          personalities.map((tone) => `\`!tone ${tone}\``).join("\n"),
      );
      return;
    }

    if (languages.includes(requestedTone)) {
      config.settings.defaultLanguage = requestedTone;
      saveConfig(config);

      await message.reply(
        `My language is now **${requestedTone}**. My personality stays the same.`,
      );
      return;
    }

    if (personalities.includes(requestedTone)) {
      serverPersonalities.set(message.guildId, requestedTone);

      await message.reply(
        `My personality is now **${requestedTone}**. My language stays the same.`,
      );
      return;
    }

    await message.reply(
      "Unknown tone. Use `!tone` to see the available options.",
    );
    return;
  }

  if (config.settings.autoReplyEnabled === false) {
    return;
  }

  const mentioned = isTalkingToYsabelle(message, client);

  if (mentioned && config.settings.mentionRepliesEnabled === false) {
    return;
  }

  const automatic = !mentioned && canReplyWithoutMention(message, config);

  if (!mentioned && !automatic) return;

  if (automatic) {
    const chance = Number(config.settings.replyChance ?? 0.25);

    if (Math.random() >= Math.max(0, Math.min(1, chance))) {
      return;
    }
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

  const tcasResult = getTcasReply(prompt);

  if (!tcasResult) {
    return;
  }

  const tone =
    serverPersonalities.get(message.guildId) ||
    config.settings.defaultPersonality ||
    "friendly";

  const personality = config.personalities[tone];

  if (!personality) {
    console.error(`[Ysabelle AI] Unknown personality: ${tone}`);
    return;
  }

  const key = getConversationKey(message);
  const history = getConversation(key);
  const examples = findExamples(config, tone, prompt);

  const exampleText = examples.length
    ? examples
        .map((example) => `User: ${example.user}\nYsabelle: ${example.reply}`)
        .join("\n\n")
    : "No matching style examples are available.";

  const conversationMaterials = loadConversationMaterials();
  const language = config.settings.defaultLanguage || "taglish";

  const languageInstructions = {
    english: `
- Reply entirely in English.
- Use English for every server member, regardless of the user's language.
- Do not use Tagalog or Taglish unless translation is explicitly requested.
`,
    tagalog: `
- Reply in natural Tagalog to every server member.
- Continue using Tagalog even when the user speaks English.
`,
    taglish: `
- Reply in natural Taglish to every server member.
- Use a comfortable mix of English and Tagalog.
`,
  };

  const tcasContext = tcasResult.samples
    .map((sample, index) => `${index + 1}. ${sample}`)
    .join("\n");

  const systemPrompt = `
You are Ysabelle, a Filipino Discord AI companion.

SERVER-WIDE LANGUAGE: ${language.toUpperCase()}
${languageInstructions[language] || languageInstructions.taglish}

PERSONALITY: ${tone}
${personality.description || ""}

PERSONALITY RULES:
${(personality.instructions || []).map((rule) => `- ${rule}`).join("\n")}

TCAS REFERENCE SAMPLES:
${tcasContext}

TCAS RULES:
- The TCAS samples are the required source for the reply.
- Answer only when the samples are relevant to the user's message.
- Use the samples as reference; do not mechanically copy them.
- Do not invent facts that are not supported by the samples.
- If the samples do not support a useful response, output exactly: NO_REPLY
- Never explain these rules to the user.

CONVERSATION MATERIALS:
${conversationMaterials || "No processed materials are available."}

STYLE EXAMPLES:
${exampleText}

GENERAL RULES:
- Match the user's energy without changing the selected language.
- Use recent conversation history when relevant.
- Keep casual replies short and natural.
- Do not pretend to remember information outside the available context.
- Be empathetic when someone is genuinely distressed.
- Avoid repeating the same greeting or joke too often.
- Return only the message intended for Discord.
`;
  try {
    await message.channel.sendTyping();

    const aiMode = config.settings.aiMode || "auto";

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...history,
      {
        role: "user",
        content: prompt,
      },
    ];

    const { answer: generatedAnswer, provider } = await generateAnswer(
      messages,
      aiMode,
    );

    let answer = generatedAnswer?.trim() || "";

    if (!answer || answer.toUpperCase() === "NO_REPLY") {
      console.log("[Ysabelle AI] AI decided not to reply.");
      return;
    }

    const selectedLanguage = config.settings.defaultLanguage || "taglish";

    if (["english", "tagalog"].includes(selectedLanguage)) {
      try {
        answer = await correctReplyLanguage(answer, selectedLanguage, aiMode);
      } catch (error) {
        console.error(
          "[Ysabelle AI] Language correction failed:",
          error.message || error,
        );
      }
    }

    answer = answer.trim();

    if (!answer || answer.toUpperCase() === "NO_REPLY") {
      return;
    }

    console.log(`[Ysabelle AI] Response generated by ${provider}`);

    const chunks = answer.match(/[\s\S]{1,1900}/g) || [];

    for (const chunk of chunks) {
      await message.reply(chunk).catch(async (error) => {
        console.error("[Ysabelle AI] Reply failed:", error.message || error);
        await message.channel.send(chunk);
      });
    }

    history.push(
      {
        role: "user",
        content: prompt,
      },
      {
        role: "assistant",
        content: answer,
      },
    );

    while (history.length > MAX_HISTORY) {
      history.shift();
    }

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
    console.error("[Ysabelle AI]", error);

    await message
      .reply(
        "My AI providers are having trouble right now. Please try again later.",
      )
      .catch(() => {});
  }
}

/* =========================================================
   YSABELLE MANUAL COMMAND AUDIT LOGGER
   Tracks !chat and !reply usage, permissions, and results.
   ========================================================= */

/* =========================================================
   YSABELLE MANUAL COMMAND AUDIT LOGGER
   Tracks !chat and !reply usage, permissions, and results.
   ========================================================= */

function getManualCommandSettings(config) {
  return config.settings?.manualCommands ?? {};
}

function canUseManualCommand(message, config, commandName) {
  const settings = getManualCommandSettings(config);

  const isAdmin = message.member?.permissions.has(
    PermissionsBitField.Flags.Administrator,
  );

  // Administrators bypass role restrictions by default.
  if (settings.adminsBypass !== false && isAdmin) {
    return true;
  }

  const roleKey = commandName === "!chat" ? "chatRoleIds" : "replyRoleIds";

  const allowedRoleIds = settings[roleKey] ?? [];

  // Empty role list means administrators only.
  if (allowedRoleIds.length === 0) {
    return false;
  }

  return (
    message.member?.roles.cache.some((role) =>
      allowedRoleIds.includes(role.id),
    ) ?? false
  );
}

async function logManualCommandAudit({
  message,
  client,
  commandName,
  status,
  details = "",
  targetMessage = null,
  config,
  originalContent,
  originalRoles,
}) {
  const settings = getManualCommandSettings(config);

  console.log(
    `[Ysabelle Audit] ${commandName} | ` +
      `User: ${message.author.tag} (${message.author.id}) | ` +
      `Status: ${status} | ${details}`,
  );

  const auditChannelId = settings.auditChannelId;

  if (!auditChannelId) return;

  try {
    const auditChannel = await client.channels.fetch(auditChannelId);

    if (
      !auditChannel?.isTextBased() ||
      typeof auditChannel.send !== "function"
    ) {
      console.warn("[Ysabelle Audit] Configured audit channel is invalid.");
      return;
    }

    const roleText =
      originalRoles ||
      message.member?.roles.cache
        .filter((role) => role.id !== message.guild.id)
        .map((role) => `${role.name} (${role.id})`)
        .join(", ") ||
      "No roles found";

    const loggedContent =
      settings.logMessageContent === false
        ? "[Message content logging disabled]"
        : (originalContent ?? message.content ?? "[No content]").slice(0, 1000);

    const colors = {
      SUCCESS: 0x2ecc71,
      DENIED: 0xe74c3c,
      FAILED: 0xf39c12,
    };

    const embed = new EmbedBuilder()
      .setTitle(`Manual Command Audit: ${commandName}`)
      .setColor(colors[status] ?? 0x5865f2)
      .addFields(
        {
          name: "User",
          value: `${message.author} (\`${message.author.id}\`)`,
        },
        {
          name: "Roles",
          value: roleText.slice(0, 1024),
        },
        {
          name: "Channel",
          value: `${message.channel} (\`${message.channel.id}\`)`,
        },
        {
          name: "Status",
          value: status,
          inline: true,
        },
        {
          name: "Command Message",
          value: loggedContent || "[Empty]",
        },
      )
      .setTimestamp();

    if (details) {
      embed.addFields({
        name: "Details",
        value: details.slice(0, 1024),
      });
    }

    if (targetMessage) {
      embed.addFields({
        name: "Reply Target",
        value:
          `Author: ${targetMessage.author?.tag ?? "Unknown"}\n` +
          `User ID: ${targetMessage.author?.id ?? "Unknown"}\n` +
          `Message ID: ${targetMessage.id}`,
      });
    }

    await auditChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error(
      "[Ysabelle Audit] Failed to send audit log:",
      error.message || error,
    );
  }
}

/* =========================================================
   MANUAL COMMAND HANDLER
   !chat  - Posts a normal channel message.
   !reply - Replies to the message being referenced.
   ========================================================= */

async function handleManualConfigCommand(message, client, content) {
  if (!/^!manualcmd(?:\s|$)/i.test(content)) {
    return false;
  }

  const isAdmin = message.member?.permissions.has(
    PermissionsBitField.Flags.Administrator,
  );

  if (!isAdmin) {
    await message.reply(
      "You need the **Administrator** permission to configure manual commands.",
    );
    return true;
  }

  let config;

  try {
    config = loadConfig();
  } catch (error) {
    console.error("[Ysabelle ManualCmd] Failed to load configuration:", error);

    await message.reply("I couldn't load the manual command configuration.");
    return true;
  }

  config.settings ||= {};
  config.settings.manualCommands ||= {};

  const settings = config.settings.manualCommands;
  settings.chatRoleIds ||= [];
  settings.replyRoleIds ||= [];
  settings.adminsBypass ??= true;
  settings.logMessageContent ??= true;

  const args = content.trim().split(/\s+/);
  const action = args[1]?.toLowerCase();

  const save = () => saveConfig(config);

  if (!action || action === "help") {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Ysabelle Manual Command Configuration")
          .setDescription(
            [
              "**Permissions**",
              "`!manualcmd status` — View current settings",
              "`!manualcmd chatrole @Role` — Allow a role to use `!chat`",
              "`!manualcmd replyrole @Role` — Allow a role to use `!reply`",
              "`!manualcmd clearchatroles` — Clear `!chat` role restrictions",
              "`!manualcmd clearreplyroles` — Clear `!reply` role restrictions",
              "",
              "**Audit logging**",
              "`!manualcmd audit #channel` — Set the audit channel",
              "`!manualcmd audit off` — Disable audit logging",
              "`!manualcmd content on` — Log command text",
              "`!manualcmd content off` — Hide command text in audit logs",
              "",
              "**Administrator bypass**",
              "`!manualcmd adminbypass on` — Administrators bypass role restrictions",
              "`!manualcmd adminbypass off` — Administrators must also have an allowed role",
            ].join("\n"),
          ),
      ],
    });

    return true;
  }

  if (action === "status") {
    const chatRoles = settings.chatRoleIds.length
      ? settings.chatRoleIds.map((id) => `<@&${id}>`).join(", ")
      : "No roles configured (administrators only if bypass is enabled)";

    const replyRoles = settings.replyRoleIds.length
      ? settings.replyRoleIds.map((id) => `<@&${id}>`).join(", ")
      : "No roles configured (administrators only if bypass is enabled)";

    const auditChannel = settings.auditChannelId
      ? `<#${settings.auditChannelId}>`
      : "Disabled";

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("Manual Command Settings")
          .addFields(
            { name: "!chat allowed roles", value: chatRoles },
            { name: "!reply allowed roles", value: replyRoles },
            { name: "Audit channel", value: auditChannel, inline: true },
            {
              name: "Log command text",
              value: settings.logMessageContent ? "ON" : "OFF",
              inline: true,
            },
            {
              name: "Administrator bypass",
              value: settings.adminsBypass ? "ON" : "OFF",
              inline: true,
            },
          )
          .setTimestamp(),
      ],
    });

    return true;
  }

  if (action === "chatrole" || action === "replyrole") {
    const role = message.mentions.roles.first();

    if (!role) {
      await message.reply(
        `Mention a role. Example: \`!manualcmd ${action} @YourRole\``,
      );
      return true;
    }

    const key = action === "chatrole" ? "chatRoleIds" : "replyRoleIds";

    if (settings[key].includes(role.id)) {
      await message.reply(`${role} is already allowed to use this command.`);
      return true;
    }

    settings[key].push(role.id);
    save();

    await message.reply(
      `${role} can now use **${action === "chatrole" ? "!chat" : "!reply"}**.`,
    );

    return true;
  }

  if (action === "clearchatroles" || action === "clearreplyroles") {
    const key = action === "clearchatroles" ? "chatRoleIds" : "replyRoleIds";

    settings[key] = [];
    save();

    await message.reply(
      `Cleared the configured role restrictions for **${action === "clearchatroles" ? "!chat" : "!reply"}**. ${
        settings.adminsBypass
          ? "Only administrators can use it until you add allowed roles."
          : "No roles are allowed until you add them."
      }`,
    );

    return true;
  }

  if (action === "audit") {
    const target = args[2]?.toLowerCase();

    if (target === "off") {
      delete settings.auditChannelId;
      save();

      await message.reply("Manual command audit logging is now **OFF**.");
      return true;
    }

    const channel =
      message.mentions.channels.first() ||
      message.guild.channels.cache.get(args[2]?.replace(/[<#>]/g, ""));

    if (!channel || !channel.isTextBased() || !channel.guild) {
      await message.reply(
        "Mention a text channel in this server. Example: `!manualcmd audit #staff-logs`, or use `!manualcmd audit off`.",
      );
      return true;
    }

    settings.auditChannelId = channel.id;
    save();

    await message.reply(
      `Manual command audit logs will now be sent to ${channel}.`,
    );

    return true;
  }

  if (action === "content") {
    const value = args[2]?.toLowerCase();

    if (!["on", "off"].includes(value)) {
      await message.reply(
        "Use `!manualcmd content on` or `!manualcmd content off`.",
      );
      return true;
    }

    settings.logMessageContent = value === "on";
    save();

    await message.reply(
      `Logging command text is now **${value.toUpperCase()}**.`,
    );

    return true;
  }

  if (action === "adminbypass") {
    const value = args[2]?.toLowerCase();

    if (!["on", "off"].includes(value)) {
      await message.reply(
        "Use `!manualcmd adminbypass on` or `!manualcmd adminbypass off`.",
      );
      return true;
    }

    settings.adminsBypass = value === "on";
    save();

    await message.reply(
      `Administrator bypass is now **${value.toUpperCase()}**.`,
    );

    return true;
  }

  await message.reply(
    "Unknown option. Use `!manualcmd help` to see available commands.",
  );

  return true;
}

async function handleManualCommand(message, client, content) {
  const isChat = /^!chat(?:\s|$)/i.test(content);
  const isReply = /^!reply(?:\s|$)/i.test(content);

  if (!isChat && !isReply) {
    return false;
  }

  const commandName = isChat ? "!chat" : "!reply";

  let config;

  try {
    config = loadConfig();
  } catch (error) {
    console.error("[Ysabelle Audit] Failed to load configuration:", error);

    await message
      .reply(
        "I couldn't load my command configuration. Please try again later.",
      )
      .catch(() => {});

    return true;
  }

  // Capture details before deleting the command message.
  const originalContent = content;

  const originalRoles =
    message.member?.roles.cache
      .filter((role) => role.id !== message.guild.id)
      .map((role) => `${role.name} (${role.id})`)
      .join(", ") || "No roles found";

  if (!canUseManualCommand(message, config, commandName)) {
    await logManualCommandAudit({
      message,
      client,
      commandName,
      status: "DENIED",
      details: "User does not have an allowed role.",
      config,
      originalContent,
      originalRoles,
    });

    await message
      .reply("You don't have permission to use this command.")
      .catch(() => {});

    return true;
  }

  const commandText = isChat
    ? content.replace(/^!chat\b/i, "").trim()
    : content.replace(/^!reply\b/i, "").trim();

  if (!commandText) {
    await logManualCommandAudit({
      message,
      client,
      commandName,
      status: "FAILED",
      details: "No message text provided.",
      config,
      originalContent,
      originalRoles,
    });

    await message
      .reply(
        isChat
          ? "Usage: `!chat your message here`"
          : "Reply to a message, then type `!reply your message here`.",
      )
      .catch(() => {});

    return true;
  }

  let targetMessage = null;

  if (isReply) {
    if (!message.reference?.messageId) {
      await logManualCommandAudit({
        message,
        client,
        commandName,
        status: "FAILED",
        details: "No original message was selected.",
        config,
        originalContent,
        originalRoles,
      });

      await message
        .reply(
          "Reply to the message you want to respond to, then type `!reply your message here`.",
        )
        .catch(() => {});

      return true;
    }

    try {
      targetMessage = await message.channel.messages.fetch(
        message.reference.messageId,
      );
    } catch (error) {
      await logManualCommandAudit({
        message,
        client,
        commandName,
        status: "FAILED",
        details: "Could not fetch the original message.",
        config,
        originalContent,
        originalRoles,
      });

      await message
        .reply(
          "I couldn't find that message. Check my permissions and try again.",
        )
        .catch(() => {});

      return true;
    }
  }

  try {
    // Send successfully before deleting the command.
    if (isChat) {
      await message.channel.send({
        content: commandText,
        allowedMentions: { parse: [] },
      });
    } else {
      await targetMessage.reply({
        content: commandText,
        allowedMentions: { parse: [] },
      });
    }

    // If deletion fails, the sent message remains posted.
    await message.delete();

    await logManualCommandAudit({
      message,
      client,
      commandName,
      status: "SUCCESS",
      details: isChat
        ? "Message posted normally in the channel."
        : "Message posted as a reply to the selected message.",
      targetMessage,
      config,
      originalContent,
      originalRoles,
    });
  } catch (error) {
    console.error(`[Ysabelle ${commandName}]`, error.message || error);

    await logManualCommandAudit({
      message,
      client,
      commandName,
      status: "FAILED",
      details: error.message || "Unknown error.",
      targetMessage,
      config,
      originalContent,
      originalRoles,
    });

    await message.channel
      .send(
        "I couldn't complete that command. Check my permissions and try again.",
      )
      .catch(() => {});
  }

  return true;
}

/* =========================================================
   EVENT REGISTRATION
   Prevents duplicate registration on the same client.
   ========================================================= */

function registerAutoReply(client) {
  if (registeredClients.has(client)) {
    console.warn(
      "[Ysabelle AutoReply] Listener already registered; skipping duplicate.",
    );
    return;
  }

  registeredClients.add(client);

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild || message.webhookId) {
      return;
    }

    const content = message.content.trim();

    if (!content) return;

    // Manual commands bypass the AI handler.
    // Configuration commands must be handled before !chat and !reply.
    const configHandled = await handleManualConfigCommand(
      message,
      client,
      content,
    );

    if (configHandled) return;

    // Manual message commands bypass the AI handler.
    const handled = await handleManualCommand(message, client, content);

    if (handled) return;

    // All other messages continue through the existing AI handler.
    try {
      await handleMessage(message, client);
    } catch (error) {
      console.error("[Ysabelle AutoReply]", error);
    }
  });

  console.log("[Ysabelle Chat] Manual message reposting loaded.");
  console.log("[Ysabelle Reply] Manual message replies loaded.");
  console.log(
    "[Ysabelle AutoReply] Automatic reply and mention controls loaded.",
  );
}

module.exports = { registerAutoReply };
