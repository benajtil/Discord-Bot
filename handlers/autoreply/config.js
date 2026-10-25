const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.resolve(__dirname, "../../ysabelle_personality.json");

function defaultConfig() {
  return {
    settings: {
      autoReplyEnabled: true,
      mentionRepliesEnabled: true,
      replyMode: "mention",
      replyChance: 0.25,
      defaultLanguage: "taglish",
      defaultPersonality: "friendly",
      aiMode: "auto",
      replyChannels: [],
      manualCommands: {
        chatRoleIds: [],
        replyRoleIds: [],
        auditChannelId: null,
        adminsBypass: true,
        logMessageContent: true,
      },
    },
    personalities: {},
    replyExamples: [],
    learnedExamples: [],
  };
}

function loadConfig() {
  let config = defaultConfig();

  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    config = {
      ...config,
      ...JSON.parse(raw),
      settings: {
        ...config.settings,
        ...(JSON.parse(raw).settings || {}),
      },
    };
  }

  config.settings ||= {};
  config.settings.replyChannels ||= [];
  config.settings.manualCommands ||= {};

  const manual = config.settings.manualCommands;

  manual.chatRoleIds ||= [];
  manual.replyRoleIds ||= [];
  manual.auditChannelId ??= null;
  manual.adminsBypass ??= true;
  manual.logMessageContent ??= true;

  config.personalities ||= {};
  config.replyExamples ||= [];
  config.learnedExamples ||= [];

  return config;
}

function saveConfig(config) {
  const tempPath = `${CONFIG_PATH}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), "utf8");

  fs.renameSync(tempPath, CONFIG_PATH);
}

function updateConfig(callback) {
  const config = loadConfig();
  callback(config);
  saveConfig(config);
  return config;
}

module.exports = {
  CONFIG_PATH,
  defaultConfig,
  loadConfig,
  saveConfig,
  updateConfig,
};
