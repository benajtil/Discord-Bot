const fs = require("node:fs");
const path = require("node:path");

const DATA_PATH = path.join(__dirname, "language-data.json");

const LANGUAGES = {
  english: {
    label: "English",
    confirmation: "Language changed to English.",
  },
  tagalog: {
    label: "Tagalog",
    confirmation: "Pinalitan na ang wika sa Tagalog.",
  },
  taglish: {
    label: "Taglish",
    confirmation:
      "Language changed to Taglish. Halo na ulit ang English at Tagalog.",
  },
};

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Failed to load language data:", error);
    }
    return {};
  }
}

const data = loadData();

function saveData() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function normalizeLanguage(value) {
  const aliases = {
    en: "english",
    eng: "english",
    english: "english",
    tl: "tagalog",
    fil: "tagalog",
    filipino: "tagalog",
    tagalog: "tagalog",
    taglish: "taglish",
    mixed: "taglish",
  };

  return aliases[value?.toLowerCase()] || null;
}

function getLanguage(guildId) {
  return data[guildId]?.language || "taglish";
}

function setLanguage(guildId, language) {
  data[guildId] ??= {};
  data[guildId].language = language;
  saveData();
}

function handleLanguageCommand(message) {
  if (!message.guild || message.author.bot) return false;

  const prefix = "!";
  const args = message.content.trim().split(/\s+/);

  if (
    args[0].toLowerCase() !== `${prefix}language` &&
    args[0].toLowerCase() !== `${prefix}lang`
  ) {
    return false;
  }

  const requested = normalizeLanguage(args[1]);

  if (!args[1] || ["help", "list"].includes(args[1].toLowerCase())) {
    message.reply(
      "**Ysabelle Language Settings**\n" +
        "`!language english` — English only\n" +
        "`!language tagalog` — Tagalog\n" +
        "`!language taglish` — Mix English and Tagalog\n" +
        "`!language` — Show the current language\n\n" +
        `Current language: **${LANGUAGES[getLanguage(message.guild.id)].label}**`,
    );
    return true;
  }

  if (!requested) {
    message.reply(
      "Unknown language. Choose `english`, `tagalog`, or `taglish`.",
    );
    return true;
  }

  setLanguage(message.guild.id, requested);
  message.reply(LANGUAGES[requested].confirmation);
  return true;
}

module.exports = {
  handleLanguageCommand,
  getLanguage,
  setLanguage,
  LANGUAGES,
};
