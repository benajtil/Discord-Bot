const {
  Events,
  PermissionsBitField,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const MEME_FILE = path.join(ROOT, "meme-data.json");
const ROAST_FILE = path.join(ROOT, "roast-data.json");
const ROASTS_FILE = path.join(ROOT, "roasts.json");
const CONFIG_FILE = path.join(ROOT, "entertainment-config.json");
const HISTORY_FILE = path.join(DATA_DIR, "entertainment-history.json");

const { createCanvas } = require("@napi-rs/canvas");
const DEFAULT_CONFIG = {
  enabled: true,
  darkHumor: true,
  automaticReactions: true,
  reactionChance: 30,
  reactionCooldownSeconds: 60,
  commandCooldownSeconds: 5,
  shipCooldownSeconds: 30,
  memeCategory: "general",
  disabledChannels: [],
  disabledUsers: [],
  aiMode: "hybrid",
  maxHistoryEntries: 200,
  nsfwEnabled: false,
};

const FALLBACK_MEMES = {
  general: [
    "The confidence is impressive. The evidence has left the server.",
    "Somewhere, a brain cell just submitted its resignation.",
    "This conversation needs adult supervision. Unfortunately, we're the adults.",
  ],
  gaming: [
    "Skill issue detected. Diagnosis confirmed by absolutely nobody qualified.",
    "GG. Good grief.",
    "Respawn the brain first, then the character.",
  ],
  school: [
    "The deadline is approaching. Panic is not a study method.",
    "The assignment has become a historical document.",
  ],
  relationship: [
    "Cupid needs a performance review.",
    "The red flags are doing a synchronized dance routine.",
  ],
  reaction_phrases: [
    {
      phrases: ["skill issue"],
      responses: ["Skill issue detected. Diagnosis confirmed."],
      category: "gaming",
    },
    {
      phrases: ["crush ko", "may crush ako", "i have a crush"],
      responses: ["The romance department has opened a case."],
      category: "relationship",
    },
    {
      phrases: ["exam", "finals", "assignment", "deadline"],
      responses: [
        "Academic boss fight detected. Recommended equipment: sleep and notes.",
      ],
      category: "school",
    },
    {
      phrases: ["suko na ako", "i give up", "pagod na ako"],
      responses: [
        "Take a breath first. The chaos can wait. You don't have to solve everything at once.",
      ],
      category: "support",
    },
  ],
};

const FALLBACK_ROASTS = [
  "{user}, your brain has 47 tabs open and somehow the music is coming from a tab you cannot find.",
  "{user}, you bring side-quest energy to a main-quest emergency.",
  "{user}, your common sense is currently marked as temporarily unavailable.",
];

const FALLBACK_SHIP_OPENERS = [
  "The council has reviewed this suspicious pairing.",
  "Two usernames. One questionable cinematic universe.",
  "The matchmaking algorithm needs a vacation.",
];

const FALLBACK_SHIP_OUTCOMES = [
  "They would either rule the server or get banned from the group chat.",
  "One brings the chaos; the other files the incident report.",
  "Their love language is sending memes at unreasonable hours.",
  "The chemistry is suspicious. The evidence is mostly memes.",
];

const cooldowns = new Map();
const recentShipPairs = new Map();
const recentRoasts = new Map();

let registeredClient = null;
let config = { ...DEFAULT_CONFIG };
let memeData = FALLBACK_MEMES;
let roastData = {
  roasts: FALLBACK_ROASTS,
  ship_openers: FALLBACK_SHIP_OPENERS,
  ship_outcomes: FALLBACK_SHIP_OUTCOMES,
};
let roastDataset = [];
let history = { reactions: [], ships: [], roasts: [] };

function ensureJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(
      `[Ysabelle] Cannot read ${path.basename(file)}:`,
      error.message,
    );
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temp, file);
    return true;
  } catch (error) {
    console.error(
      `[Ysabelle] Cannot save ${path.basename(file)}:`,
      error.message,
    );
    return false;
  }
}

function saveConfig() {
  return writeJson(CONFIG_FILE, config);
}

function saveHistory() {
  const max = Math.max(20, Number(config.maxHistoryEntries) || 200);
  history.reactions = history.reactions.slice(-max);
  history.ships = history.ships.slice(-max);
  history.roasts = (history.roasts || []).slice(-max);
  return writeJson(HISTORY_FILE, history);
}

function loadRoastDataset() {
  if (!fs.existsSync(ROASTS_FILE)) return [];

  const data = readJson(ROASTS_FILE, []);

  if (!Array.isArray(data)) {
    console.error("[Ysabelle] roasts.json must contain a JSON array.");
    return [];
  }

  const valid = data.filter(
    (item) =>
      item &&
      Number.isInteger(item.number) &&
      typeof item.roast === "string" &&
      item.roast.trim().length > 0 &&
      typeof item.nsfw === "boolean",
  );

  if (valid.length !== data.length) {
    console.warn("[Ysabelle] Some invalid roast entries were ignored.");
  }

  return valid;
}

function loadFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  ensureJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  ensureJsonFile(MEME_FILE, FALLBACK_MEMES);
  ensureJsonFile(ROAST_FILE, {
    roasts: FALLBACK_ROASTS,
    ship_openers: FALLBACK_SHIP_OPENERS,
    ship_outcomes: FALLBACK_SHIP_OUTCOMES,
  });
  ensureJsonFile(HISTORY_FILE, {
    reactions: [],
    ships: [],
    roasts: [],
  });

  config = { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, DEFAULT_CONFIG) };

  if (!Array.isArray(config.disabledChannels)) config.disabledChannels = [];
  if (!Array.isArray(config.disabledUsers)) config.disabledUsers = [];
  if (typeof config.nsfwEnabled !== "boolean") config.nsfwEnabled = false;

  memeData = readJson(MEME_FILE, FALLBACK_MEMES);
  roastData = readJson(ROAST_FILE, {
    roasts: FALLBACK_ROASTS,
    ship_openers: FALLBACK_SHIP_OPENERS,
    ship_outcomes: FALLBACK_SHIP_OUTCOMES,
  });

  history = readJson(HISTORY_FILE, {
    reactions: [],
    ships: [],
    roasts: [],
  });

  if (!Array.isArray(history.reactions)) history.reactions = [];
  if (!Array.isArray(history.ships)) history.ships = [];
  if (!Array.isArray(history.roasts)) history.roasts = [];

  roastDataset = loadRoastDataset();
  saveConfig();
  saveHistory();
}

function cleanText(value, maxLength = 1800) {
  return String(value ?? "")
    .replace(/@everyone/gi, "@ everyone")
    .replace(/@here/gi, "@ here")
    .slice(0, maxLength);
}

function randomItem(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function pickUniqueItem(items, recentItems = []) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const fresh = items.filter((item) => !recentItems.includes(item));
  return randomItem(fresh.length ? fresh : items);
}

function isAdmin(member) {
  return Boolean(
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    member?.permissions?.has(PermissionsBitField.Flags.ManageGuild),
  );
}

function isCommand(content) {
  return /^!/.test(content.trim());
}

function getCooldownKey(type, message, targetId = "") {
  if (type === "reaction") return `reaction:${message.channelId}`;
  if (type === "ship") return `ship:${message.guildId}:${message.author.id}`;
  return `${type}:${message.author.id}:${targetId}`;
}

function isCoolingDown(key) {
  return Date.now() < (cooldowns.get(key) || 0);
}

function setCooldown(key, seconds) {
  cooldowns.set(key, Date.now() + Math.max(0, seconds) * 1000);
}

function checkAndSetCooldown(key, seconds) {
  if (isCoolingDown(key)) return false;
  setCooldown(key, seconds);
  return true;
}

async function reply(message, text) {
  return message.reply({
    content: cleanText(text),
    allowedMentions: { parse: [] },
  });
}

function recordReaction(message, kind, text) {
  history.reactions.push({
    at: new Date().toISOString(),
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    kind,
    text: cleanText(text, 500),
  });
  saveHistory();
}

function getCategory(category) {
  const requested = String(
    category || config.memeCategory || "general",
  ).toLowerCase();

  if (Array.isArray(memeData[requested]) && memeData[requested].length) {
    return { name: requested, items: memeData[requested] };
  }

  return {
    name: "general",
    items:
      Array.isArray(memeData.general) && memeData.general.length
        ? memeData.general
        : FALLBACK_MEMES.general,
  };
}

function getRandomMeme(category) {
  return (
    randomItem(getCategory(category).items) ||
    randomItem(FALLBACK_MEMES.general)
  );
}

function getAllowedRoasts() {
  if (roastDataset.length > 0) {
    return roastDataset.filter(
      (item) => config.nsfwEnabled || item.nsfw === false,
    );
  }

  // The fallback list contains original, non-explicit roasts.
  return FALLBACK_ROASTS.map((roast, index) => ({
    number: index + 1,
    roast,
    nsfw: false,
  }));
}

function getRoast(targetName) {
  const allowed = getAllowedRoasts();
  if (!allowed.length) return null;

  const recent = recentRoasts.get(targetName) || [];
  const selected = pickUniqueItem(
    allowed,
    recent.map((item) => item.number),
  );

  if (!selected) return null;

  recent.push(selected);
  recentRoasts.set(targetName, recent.slice(-5));

  return cleanText(selected.roast.replace(/\{user\}/gi, targetName), 1000);
}

function getMentionedMembers(message) {
  return [...message.mentions.members.values()].filter(
    (member) => member && !member.user.bot,
  );
}

function chooseRandomShipMember(message) {
  const members = message.guild?.members?.cache;
  if (!members) return null;

  const candidates = [...members.values()].filter(
    (member) =>
      !member.user.bot &&
      !member.user.system &&
      member.id !== message.author.id,
  );

  return randomItem(candidates);
}

function getShipText(firstName, secondName) {
  const pairKey = [firstName, secondName].sort().join(":");
  const previous = recentShipPairs.get(pairKey) || 0;

  if (Date.now() - previous < 60000) return null;
  recentShipPairs.set(pairKey, Date.now());

  const openers = roastData.ship_openers || FALLBACK_SHIP_OPENERS;
  const outcomes = roastData.ship_outcomes || FALLBACK_SHIP_OUTCOMES;
  const percentage = Math.floor(Math.random() * 101);

  history.ships.push({
    at: new Date().toISOString(),
    firstName,
    secondName,
    percentage,
  });
  saveHistory();

  return `${randomItem(openers)}\n**${firstName} × ${secondName}: ${percentage}% compatibility**\n${randomItem(outcomes)}`;
}

async function generateAiRoast(targetName) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || config.aiMode === "local") return null;

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
          temperature: 1.1,
          max_tokens: 100,
          messages: [
            {
              role: "system",
              content:
                "Write one short chaotic English-Taglish gaming roast. Keep it playful and absurd. Do not use slurs, threats, or target sensitive traits. Do not encourage self-harm. Return only the roast in at most two sentences.",
            },
            {
              role: "user",
              content: `Write a playful roast for the display name "${cleanText(targetName, 60)}".`,
            },
          ],
        }),
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content?.trim();
    return output ? cleanText(output, 500) : null;
  } catch (error) {
    console.error("[Ysabelle] AI roast failed:", error.message);
    return null;
  }
}

function getHelpText() {
  return [
    "**Ysabelle's Chaotic Entertainment**",
    "`!meme [general|gaming|school|relationship]` — random meme",
    "`!meme category <category>` — change default category (admin)",
    "`!roast @user` — roast a member",
    "`!nsfw on/off/status` — control adult roast dataset (admin for on/off)",
    "`!ship @user1 @user2` — ship two members",
    "`!ship @user` — pair with a random member",
    "`!darkhumor on/off` — admin setting",
    "`!reactionchance 0-30` — admin setting",
    "`!reactioncooldown 10-600` — admin setting",
    "`!reactionmode on/off` — admin setting",
    "`!reactionchannel #channel/off` — toggle channel restrictions",
    "`!entertainment status/help/reset` — entertainment settings",
    "`!memeimages [general|gaming|school|relationship]` — generate a meme image",
  ].join("\n");
}

function createMemeImage(category, text, username) {
  const width = 1000;
  const height = 600;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const palettes = {
    general: ["#171426", "#542c91"],
    gaming: ["#101b35", "#176b87"],
    school: ["#422006", "#b45309"],
    relationship: ["#4a102f", "#be185d"],
  };

  const colors = palettes[category] || palettes.general;
  const gradient = ctx.createLinearGradient(0, 0, width, height);

  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Decorative circles
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";

  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc(
      Math.random() * width,
      Math.random() * height,
      25 + Math.random() * 90,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  // Header
  ctx.fillStyle = "#d8b4fe";
  ctx.font = "bold 25px Arial";
  ctx.textAlign = "left";
  ctx.fillText(`YSABELLE  /  ${(category || "general").toUpperCase()}`, 55, 65);

  // Main meme text with automatic wrapping
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";

  ctx.font = "bold 48px Arial";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (ctx.measureText(candidate).width > width - 120 && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) lines.push(line);

  // Fit long captions into the image
  let fontSize = 48;

  while (fontSize > 25) {
    ctx.font = `bold ${fontSize}px Arial`;

    if (
      lines.length * (fontSize * 1.25) <= 390 &&
      lines.every((item) => ctx.measureText(item).width <= width - 120)
    ) {
      break;
    }

    fontSize -= 2;
  }

  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineHeight = fontSize * 1.25;
  const totalHeight = lines.length * lineHeight;
  let y = 300 - totalHeight / 2 + lineHeight / 2;

  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";

  lines.forEach((item, index) => {
    ctx.fillText(item, width / 2 + 3, y + index * lineHeight + 3);
  });

  ctx.fillStyle = "#ffffff";

  lines.forEach((item, index) => {
    ctx.fillText(item, width / 2, y + index * lineHeight);
  });

  // Footer
  ctx.textAlign = "left";
  ctx.font = "20px Arial";
  ctx.fillStyle = "#ddd6fe";
  ctx.fillText(`Made for ${String(username).slice(0, 45)}`, 55, 550);

  ctx.textAlign = "right";
  ctx.fillText("KATOR6 • MEME DEPARTMENT", width - 55, 550);

  return canvas.toBuffer("image/png");
}
function createMemeEmbed(category, text, member) {
  const styles = {
    general: {
      color: 0x8b5cf6,
      emoji: "🎭",
      title: "THE CHAOS DEPARTMENT",
    },
    gaming: {
      color: 0x06b6d4,
      emoji: "🎮",
      title: "GAMING INCIDENT REPORT",
    },
    school: {
      color: 0xf59e0b,
      emoji: "📚",
      title: "ACADEMIC DAMAGE REPORT",
    },
    relationship: {
      color: 0xec4899,
      emoji: "💘",
      title: "ROMANTIC DISASTER REPORT",
    },
  };

  const style = styles[category] || styles.general;

  return new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({
      name: `YSABELLE  •  ${style.title}`,
      iconURL: member?.user?.displayAvatarURL(),
    })
    .setDescription(
      [
        `### ${style.emoji} ${category.toUpperCase()} MEME`,
        "",
        `> ${cleanText(text, 1500)}`,
      ].join("\n"),
    )
    .setFooter({
      text: "KATOR6 • MEME DEPARTMENT",
    })
    .setTimestamp();
}
function getRandomMemeFile() {
  const memesDirectory = path.join(__dirname, "memes");

  if (!fs.existsSync(memesDirectory)) {
    return null;
  }

  const supportedExtensions = /\.(png|jpe?g|webp|gif)$/i;
  const files = [];

  function scanDirectory(directory) {
    for (const entry of fs.readdirSync(directory, {
      withFileTypes: true,
    })) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && supportedExtensions.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  scanDirectory(memesDirectory);

  if (!files.length) {
    return null;
  }

  return files[Math.floor(Math.random() * files.length)];
}
async function handleCommand(message) {
  const parts = message.content.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  if (command === "!nsfw") {
    const subcommand = (args[0] || "status").toLowerCase();

    if (subcommand === "status") {
      return reply(
        message,
        `NSFW roasts are currently **${config.nsfwEnabled ? "ON" : "OFF"}**.`,
      );
    }

    if (!["on", "off"].includes(subcommand)) {
      return reply(
        message,
        "Usage: `!nsfw on`, `!nsfw off`, or `!nsfw status`.",
      );
    }

    if (!isAdmin(message.member)) {
      return reply(
        message,
        "Only server administrators can change the NSFW setting.",
      );
    }

    config.nsfwEnabled = subcommand === "on";
    saveConfig();

    return reply(
      message,
      `NSFW roasts are now **${config.nsfwEnabled ? "ON" : "OFF"}**.`,
    );
  }
  if (command === "!randommeme") {
    const key = getCooldownKey("randommeme", message);

    if (!checkAndSetCooldown(key, config.commandCooldownSeconds)) {
      return reply(message, "The meme vault is reloading. Try again shortly.");
    }

    const imagePath = getRandomMemeFile();

    if (!imagePath) {
      return reply(
        message,
        "No meme images found! Add PNG, JPG, WEBP, or GIF files to `handlers/entertainment/memes/`.",
      );
    }

    const filename = path.basename(imagePath);

    const attachment = new AttachmentBuilder(imagePath, {
      name: filename,
    });

    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setAuthor({
            name: "YSABELLE • THE MEME VAULT",
            iconURL: message.client.user.displayAvatarURL(),
          })
          .setDescription(
            "### 🎲 RANDOM MEME DROP\nThe vault has selected its victim.",
          )
          .setImage(`attachment://${filename}`)
          .setFooter({
            text: `Requested by ${message.member.displayName}`,
          })
          .setTimestamp(),
      ],
      files: [attachment],
      allowedMentions: { parse: [] },
    });
  }
  if (command === "!meme") {
    if ((args[0] || "").toLowerCase() === "category") {
      if (!isAdmin(message.member))
        return reply(message, "Admin-only setting.");

      const category = (args[1] || "").toLowerCase();
      const available = ["general", "gaming", "school", "relationship"];

      if (!available.includes(category)) {
        return reply(message, `Available categories: ${available.join(", ")}.`);
      }

      config.memeCategory = category;
      saveConfig();
      return reply(message, `Default meme category set to **${category}**.`);
    }

    const key = getCooldownKey("meme", message);
    if (!checkAndSetCooldown(key, config.commandCooldownSeconds)) {
      return reply(
        message,
        "Easy, chaos goblin. The meme machine is cooling down.",
      );
    }

    const category = args[0] || config.memeCategory;
    const result = getCategory(category);
    const text = getRandomMeme(category);

    recordReaction(message, `meme:${result.name}`, text);

    return message.channel.send({
      embeds: [createMemeEmbed(result.name, text, message.member)],
      allowedMentions: { parse: [] },
    });
  }

  if (command === "!memeimages") {
    const key = getCooldownKey("memeimages", message);

    if (!checkAndSetCooldown(key, config.commandCooldownSeconds)) {
      return reply(
        message,
        "The meme printer is cooling down. Try again shortly.",
      );
    }

    const category = (
      args[0] ||
      config.memeCategory ||
      "general"
    ).toLowerCase();
    const result = getCategory(category);
    const text = getRandomMeme(category);

    const imageBuffer = createMemeImage(
      result.name,
      text,
      message.member.displayName || message.author.username,
    );

    const attachment = new AttachmentBuilder(imageBuffer, {
      name: "ysabelle-meme.png",
    });

    recordReaction(message, `meme-image:${result.name}`, text);

    return message.channel.send({
      content: `🎨 **YSABELLE'S MEME PRINTER**  ·  ${result.name.toUpperCase()}`,
      files: [attachment],
      allowedMentions: { parse: [] },
    });
  }

  if (command === "!roast") {
    const targets = getMentionedMembers(message);
    if (!targets.length)
      return reply(message, "Mention a real server member: `!roast @user`.");

    const target = targets[0];
    if (target.id === message.author.id) {
      return reply(
        message,
        "Self-roasting is a private appointment. Nominate someone else.",
      );
    }

    const key = getCooldownKey("roast", message, target.id);
    if (!checkAndSetCooldown(key, config.commandCooldownSeconds)) {
      return reply(
        message,
        "That roast is cooling down. Let the ashes settle.",
      );
    }

    let text = null;

    // When the external dataset exists, respect its NSFW flag and use it.
    // AI-generated roasts are only used when the dataset is unavailable.
    if (roastDataset.length === 0 && config.aiMode !== "local") {
      text = await generateAiRoast(target.displayName || target.user.username);
    }

    if (!text) {
      text = getRoast(target.displayName || target.user.username);
    }

    if (!text) {
      return reply(
        message,
        "No eligible roasts found. Check your roasts.json file.",
      );
    }

    history.roasts.push({
      at: new Date().toISOString(),
      targetId: target.id,
      nsfw: config.nsfwEnabled,
      text: cleanText(text, 500),
    });
    saveHistory();

    return reply(message, text);
  }

  if (command === "!ship") {
    const mentioned = getMentionedMembers(message);
    const first = mentioned[0] || message.member;
    const second = mentioned[1] || chooseRandomShipMember(message);

    if (!first || !second) {
      return reply(message, "I couldn't find two eligible server members.");
    }

    if (first.id === second.id) {
      return reply(
        message,
        "Self-ship detected. Relationship status: complicated.",
      );
    }

    if (first.user.bot || second.user.bot) {
      return reply(message, "The ship engine only pairs human server members.");
    }

    const key = getCooldownKey("ship", message);
    if (!checkAndSetCooldown(key, config.shipCooldownSeconds)) {
      return reply(message, "The matchmaking department is on break.");
    }

    const result = getShipText(
      first.displayName || first.user.username,
      second.displayName || second.user.username,
    );

    return reply(
      message,
      result || "This pair was just analyzed. Try again later.",
    );
  }

  if (command === "!entertainment") {
    const subcommand = (args[0] || "help").toLowerCase();

    if (subcommand === "help") return reply(message, getHelpText());

    if (subcommand === "status") {
      return reply(
        message,
        [
          "**Entertainment Settings**",
          `Enabled: **${config.enabled ? "ON" : "OFF"}**`,
          `Dark humor: **${config.darkHumor ? "ON" : "OFF"}**`,
          `Automatic reactions: **${config.automaticReactions ? "ON" : "OFF"}**`,
          `Reaction chance: **${config.reactionChance}%**`,
          `Reaction cooldown: **${config.reactionCooldownSeconds}s**`,
          `Default meme category: **${config.memeCategory}**`,
          `AI mode: **${config.aiMode}**`,
          `NSFW roasts: **${config.nsfwEnabled ? "ON" : "OFF"}**`,
          `External roast entries: **${roastDataset.length}**`,
        ].join("\n"),
      );
    }

    if (!isAdmin(message.member))
      return reply(message, "That setting is admin-only.");

    if (subcommand === "reset") {
      config = { ...DEFAULT_CONFIG };
      saveConfig();
      return reply(message, "Entertainment settings reset to defaults.");
    }

    return reply(message, getHelpText());
  }

  if (command === "!darkhumor") {
    if (!isAdmin(message.member)) return reply(message, "Admin-only setting.");
    const value = (args[0] || "").toLowerCase();
    if (!["on", "off"].includes(value)) {
      return reply(message, "Use `!darkhumor on` or `!darkhumor off`.");
    }
    config.darkHumor = value === "on";
    saveConfig();
    return reply(message, `Dark humor is now **${value.toUpperCase()}**.`);
  }

  if (command === "!reactionchance") {
    if (!isAdmin(message.member)) return reply(message, "Admin-only setting.");
    const value = Number(args[0]);
    if (!Number.isInteger(value) || value < 0 || value > 30) {
      return reply(message, "Choose a whole number from 0 to 30.");
    }
    config.reactionChance = value;
    saveConfig();
    return reply(message, `Automatic reaction chance set to **${value}%**.`);
  }

  if (command === "!reactioncooldown") {
    if (!isAdmin(message.member)) return reply(message, "Admin-only setting.");
    const value = Number(args[0]);
    if (!Number.isInteger(value) || value < 10 || value > 600) {
      return reply(message, "Choose a cooldown from 10 to 600 seconds.");
    }
    config.reactionCooldownSeconds = value;
    saveConfig();
    return reply(message, `Reaction cooldown set to **${value} seconds**.`);
  }

  if (command === "!reactionmode") {
    if (!isAdmin(message.member)) return reply(message, "Admin-only setting.");
    const value = (args[0] || "").toLowerCase();
    if (!["on", "off"].includes(value)) {
      return reply(message, "Use `!reactionmode on` or `!reactionmode off`.");
    }
    config.automaticReactions = value === "on";
    saveConfig();
    return reply(
      message,
      `Automatic reactions are now **${value.toUpperCase()}**.`,
    );
  }

  if (command === "!reactionchannel") {
    if (!isAdmin(message.member)) return reply(message, "Admin-only setting.");

    if ((args[0] || "").toLowerCase() === "off") {
      config.disabledChannels = [];
      saveConfig();
      return reply(message, "Channel restrictions cleared.");
    }

    const channel = message.mentions.channels.first();
    if (!channel) {
      return reply(
        message,
        "Use `!reactionchannel #channel` or `!reactionchannel off`.",
      );
    }

    const index = config.disabledChannels.indexOf(channel.id);
    if (index >= 0) {
      config.disabledChannels.splice(index, 1);
      saveConfig();
      return reply(message, `Automatic reactions enabled in ${channel}.`);
    }

    config.disabledChannels.push(channel.id);
    saveConfig();
    return reply(message, `Automatic reactions disabled in ${channel}.`);
  }

  return null;
}

async function handleAutomaticReaction(message) {
  if (!config.enabled || !config.darkHumor || !config.automaticReactions)
    return;
  if (config.reactionChance <= 0) return;
  if (!message.guild || !message.member) return;
  if (message.author.bot || message.webhookId || isCommand(message.content))
    return;
  if (config.disabledChannels.includes(message.channelId)) return;
  if (config.disabledUsers.includes(message.author.id)) return;

  const key = getCooldownKey("reaction", message);
  if (isCoolingDown(key)) return;

  const normalized = message.content.toLowerCase();
  const entries = Array.isArray(memeData.reaction_phrases)
    ? memeData.reaction_phrases
    : FALLBACK_MEMES.reaction_phrases;

  const match = entries.find(
    (entry) =>
      entry &&
      Array.isArray(entry.phrases) &&
      entry.phrases.some((phrase) =>
        normalized.includes(String(phrase).toLowerCase()),
      ),
  );

  if (!match || Math.random() * 100 >= config.reactionChance) return;

  const responses =
    Array.isArray(match.responses) && match.responses.length
      ? match.responses
      : getCategory(match.category).items;

  const text = randomItem(responses);
  if (!text) return;

  setCooldown(key, config.reactionCooldownSeconds);

  try {
    await reply(message, text);
    recordReaction(message, `automatic:${match.category || "general"}`, text);
  } catch (error) {
    console.error("[Ysabelle] Automatic reaction failed:", error.message);
  }
}

async function handleMessage(message) {
  if (
    !message?.content ||
    !message.guild ||
    message.author?.bot ||
    message.webhookId
  ) {
    return;
  }

  if (isCommand(message.content)) {
    const command = message.content.trim().split(/\s+/)[0].toLowerCase();
    const knownCommands = new Set([
      "!meme",
      "!randommeme",
      "!memeimages",
      "!roast",
      "!ship",
      "!nsfw",
      "!entertainment",
      "!darkhumor",
      "!reactionchance",
      "!reactioncooldown",
      "!reactionmode",
      "!reactionchannel",
    ]);

    if (knownCommands.has(command)) {
      try {
        await handleCommand(message);
      } catch (error) {
        console.error("[Ysabelle] Command failed:", error);
        await reply(
          message,
          "The entertainment engine crashed. Check the bot console.",
        );
      }
      return;
    }
  }

  try {
    await handleAutomaticReaction(message);
  } catch (error) {
    console.error("[Ysabelle] Reaction handler failed:", error);
  }
}

function registerEntertainment(client) {
  if (!client || typeof client.on !== "function") {
    throw new TypeError(
      "registerEntertainment(client) requires a Discord.js client.",
    );
  }

  if (registeredClient === client) {
    console.warn("[Ysabelle] Entertainment listener already registered.");
    return;
  }

  if (registeredClient) {
    registeredClient.removeListener(Events.MessageCreate, handleMessage);
  }

  loadFiles();
  registeredClient = client;
  client.on(Events.MessageCreate, handleMessage);

  console.log("[Ysabelle] Meme and Reaction Engine registered.");
}

module.exports = {
  registerEntertainment,
  handleMessage,
};
