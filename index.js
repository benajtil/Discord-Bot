require("dotenv").config();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Agent, setGlobalDispatcher } = require("undici");

setGlobalDispatcher(
  new Agent({
    connect: {
      timeout: 30000,
    },
  }),
);

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  AttachmentBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const { QuickDB } = require("quick.db");
const { loadFont: registerFont } = require("canvas-constructor/napi-rs");
const { createCanvas, loadImage: loadNapiImage } = require("@napi-rs/canvas");
const moment = require("moment");
const config = require("./config.json");
const db = new QuickDB();

const PREFIX = config.prefix || "!";
const DEVELOPER_ID = config.developerID || "";
const PORT = Number(process.env.PORT) || 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const {
  registerEntertainment,
} = require("./handlers/entertainment/meme-reactions");

const registerMemory = require("./memory");
const createOwnerOnly = require("./handlers/owner-only");
const { registerAutoDelete } = require("./handlers/autodelete/autodelete");
const { registerAutoShip } = require("./handlers/entertainment/autoship");
const { registerAutoReply } = require("./handlers/autoreply/autoreply");
const { handleWarnCommand } = require("./handlers/moderation/warn");
const { registerConfessions } = require("./handlers/entertainment/confessions");
const createGiveawayModule = require("./handlers/giveaway");
const createXpLevelStaff = require("./handlers/xp-level-staff");
const funGames = require("./handlers/entertainment/fun-games");
registerAutoShip(client);
registerAutoDelete(client);
registerMemory(client, db, PREFIX);
require("./farewell")(client, db, PREFIX, DEVELOPER_ID);
registerAutoReply(client);
registerConfessions(client);
registerEntertainment(client);
const xpLevelStaff = createXpLevelStaff(client, {
  welcomeDb: db,
});

const ownerOnly = createOwnerOnly(client, {
  xpDb: xpLevelStaff.db,
});
client.commands = new Collection();
client.aliases = new Collection();

const cooldowns = new Map();
const COOLDOWN_SECONDS = 1;

const fontDirectory = path.join(__dirname, "fonts");
const vampireFont = path.join(fontDirectory, "Vampire Wars.ttf");
const quicksandFont = path.join(fontDirectory, "Quicksand-SemiBold.ttf");

const giveawayModule = createGiveawayModule(client, db, PREFIX);

// Task and Role Progression System.
// The handler must exist at ./handlers/task-role-system.
const createTaskRoleSystem = require("./handlers/task-role-system");
const taskRoleSystem = createTaskRoleSystem(client);

// --------------------------------------------------
// Fonts
// --------------------------------------------------

try {
  if (fs.existsSync(vampireFont)) {
    registerFont(vampireFont, "Vampire Wars");
  }

  if (fs.existsSync(quicksandFont)) {
    registerFont(quicksandFont, "Quicksand-SemiBold");
  }
} catch (error) {
  console.error("Could not register custom fonts:", error);
}

// --------------------------------------------------
// Background configuration
// --------------------------------------------------

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
async function registerWithRetry(registerFunction, name, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`[${name}] Registration attempt ${attempt}/${attempts}...`);

      await registerFunction();

      console.log(`[${name}] Registration completed.`);
      return true;
    } catch (error) {
      console.error(
        `[${name}] Registration attempt ${attempt}/${attempts} failed:`,
        error,
      );

      if (attempt === attempts) {
        console.error(
          `[${name}] Registration failed after ${attempts} attempts.`,
        );
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  return false;
}
async function registerFunGamesSlashCommand() {
  try {
    const commands = client.application.commands;
    const existingCommands = await commands.fetch();

    const existingFunCommand = existingCommands.find(
      (cmd) => cmd.name === "fun",
    );

    if (existingFunCommand) {
      await existingFunCommand.edit(funGames.command.toJSON());
      console.log("[Ysabelle] Updated /fun command.");
    } else {
      await commands.create(funGames.command.toJSON());
      console.log("[Ysabelle] Registered /fun command.");
    }
  } catch (error) {
    console.error("[Ysabelle] Failed to register /fun command:", error);
  }
}
async function registerGiveawaySlashCommand() {
  try {
    const commandData = giveawayModule.slashCommand.toJSON();
    const existingCommands = await client.application.commands.fetch();

    const existing = existingCommands.find(
      (command) => command.name === "giveaway",
    );

    if (existing) {
      await client.application.commands.edit(existing.id, commandData);
    } else {
      await client.application.commands.create(commandData);
    }

    console.log("[Giveaway] Registered /giveaway");
  } catch (error) {
    console.error("[Giveaway] Slash command registration failed:", error);
  }
}

async function registerTaskRoleSlashCommands() {
  try {
    if (!taskRoleSystem) {
      throw new Error(
        "Task role system was not initialized. Check the module import.",
      );
    }

    const commands = [
      {
        name: "tasks",
        builder: taskRoleSystem.slashCommand,
      },
      {
        name: "tasksetup",
        builder: taskRoleSystem.setupSlashCommand,
      },
    ];

    for (const item of commands) {
      if (!item.builder || typeof item.builder.toJSON !== "function") {
        throw new Error(
          `The "${item.name}" command builder is missing. ` +
            `Check handlers/task-role-system/index.js and its exports.`,
        );
      }
    }

    const existingCommands = await client.application.commands.fetch();

    for (const item of commands) {
      const commandData = item.builder.toJSON();

      const existing = existingCommands.find(
        (command) => command.name === commandData.name,
      );

      if (existing) {
        await client.application.commands.edit(existing.id, commandData);
      } else {
        await client.application.commands.create(commandData);
      }

      console.log(`[Task System] Registered /${commandData.name}`);
    }
  } catch (error) {
    console.error("[Task System] Slash command registration failed:", error);
  }
}
// --------------------------------------------------
// Register XP, Level & Staff slash commands
// --------------------------------------------------

async function registerXpLevelStaffSlashCommands() {
  if (!xpLevelStaff || !Array.isArray(xpLevelStaff.commands)) {
    throw new Error("XP & Staff commands were not initialized.");
  }

  const maxAttempts = 3;
  const commands = client.application.commands;

  for (const builder of xpLevelStaff.commands) {
    if (!builder || typeof builder.toJSON !== "function") {
      console.error("[XP & Staff] Invalid command builder. Skipping.");
      continue;
    }

    const commandData = builder.toJSON();
    let registered = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(
          `[XP & Staff] Registering /${commandData.name} (${attempt}/${maxAttempts})...`,
        );

        // Refresh the remote commands before deciding whether to create or edit.
        const existingCommands = await commands.fetch();

        const existing = existingCommands.find(
          (command) => command.name === commandData.name,
        );

        if (existing) {
          await commands.edit(existing.id, commandData);
        } else {
          await commands.create(commandData);
        }

        console.log(`[XP & Staff] Registered /${commandData.name}`);
        registered = true;
        break;
      } catch (error) {
        console.error(
          `[XP & Staff] /${commandData.name} attempt ${attempt}/${maxAttempts} failed:`,
          error,
        );

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    if (!registered) {
      console.error(
        `[XP & Staff] Could not register /${commandData.name} after ${maxAttempts} attempts.`,
      );
    }

    // Small pause between commands to avoid sending requests too quickly.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log("[XP & Staff] Command registration process finished.");
}

const backgroundFile = path.join(__dirname, "JSON", "link.json");
let backgroundLinks = [];

try {
  const data = JSON.parse(fs.readFileSync(backgroundFile, "utf8"));

  backgroundLinks = Array.isArray(data.link)
    ? data.link.filter((source) => {
        if (typeof source !== "string") return false;
        if (isValidHttpUrl(source)) return true;

        const localPath = path.resolve(__dirname, source);

        return (
          !path.isAbsolute(source) &&
          localPath.startsWith(__dirname + path.sep) &&
          fs.existsSync(localPath) &&
          fs.statSync(localPath).isFile()
        );
      })
    : [];

  console.log(`Loaded ${backgroundLinks.length} welcome background(s).`);
} catch (error) {
  console.error("Could not load JSON/link.json:", error);
}

async function loadBackground(source) {
  if (isValidHttpUrl(source)) {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(`Could not download background: ${response.status}`);
    }

    return loadNapiImage(Buffer.from(await response.arrayBuffer()));
  }

  const localPath = path.resolve(__dirname, source);

  if (
    path.isAbsolute(source) ||
    !localPath.startsWith(__dirname + path.sep) ||
    !fs.existsSync(localPath)
  ) {
    throw new Error(`Invalid or missing background image: ${source}`);
  }

  return loadNapiImage(fs.readFileSync(localPath));
}

// --------------------------------------------------
// Avatar loading
// --------------------------------------------------

async function loadUserAvatar(user) {
  const avatarUrl = user.displayAvatarURL({
    extension: "png",
    size: 256,
    forceStatic: true,
  });

  const response = await fetch(avatarUrl);

  if (!response.ok) {
    throw new Error(`Could not download avatar: ${response.status}`);
  }

  return loadNapiImage(Buffer.from(await response.arrayBuffer()));
}

// --------------------------------------------------
// Welcome image renderer
// --------------------------------------------------

async function createWelcomeImage({
  background,
  avatar,
  displayName,
  memberCount,
  joinedDate,
  serverName,
}) {
  const width = 900;
  const height = 300;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(background, 0, 0, width, height);

  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, width, height);

  const centerX = 150;
  const centerY = 150;
  const radius = 110;
  const borderWidth = 4;

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + borderWidth, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(
    avatar,
    centerX - radius,
    centerY - radius,
    radius * 2,
    radius * 2,
  );

  ctx.restore();

  const fontName = fs.existsSync(quicksandFont)
    ? "Quicksand-SemiBold"
    : "Arial";

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = `22px "${fontName}"`;
  ctx.fillText("WELCOME", 317, 68);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `44px "${fontName}"`;

  let safeName = String(displayName || "New Member");
  const maxNameWidth = 550;

  while (
    safeName.length > 1 &&
    ctx.measureText(safeName).width > maxNameWidth
  ) {
    safeName = safeName.slice(0, -1);
  }

  ctx.fillText(safeName, 295, 128);

  ctx.fillStyle = "rgba(255, 255, 255, 0.30)";
  ctx.fillRect(295, 138, width - 325, 2);

  ctx.fillStyle = "rgba(255, 255, 255, 0.90)";
  ctx.font = `22px "${fontName}"`;
  ctx.fillText(`Member #${memberCount}`, 295, 175);

  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = `18px "${fontName}"`;
  ctx.fillText(`Joined ${joinedDate}`, 295, 210);
  ctx.fillText(String(serverName).slice(0, 42), 295, 245);

  return canvas.toBuffer("image/png");
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function isStaff(message) {
  return (
    message.author.id === DEVELOPER_ID ||
    message.member?.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function replaceWelcomeVariables(text, member) {
  const values = {
    user: member.displayName,
    server: member.guild.name,
    tag: member.user.tag || member.user.username,
    mention: `<@${member.user.id}>`,
    rank: String(member.guild.memberCount),
  };

  return text.replace(
    /`?\?(user|server|tag|mention|rank)`?/gi,
    (match, key) => values[key.toLowerCase()] ?? match,
  );
}

function replaceUrlVariables(text, member) {
  return text
    .replace(
      /`?\?useravatar`?/gi,
      member.user.displayAvatarURL({
        extension: "png",
        size: 512,
      }),
    )
    .replace(
      /`?\?serveravatar`?/gi,
      member.guild.iconURL({
        extension: "png",
        size: 512,
      }) || "",
    );
}

function makeEmbed(description, member, thumbnailUrl, bannerUrl) {
  const embed = new EmbedBuilder()
    .setTitle(`Welcome to ${member.guild.name}`)
    .setDescription(description)
    .setColor(0x8b5cf6)
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp();

  if (thumbnailUrl && isValidHttpUrl(thumbnailUrl)) {
    embed.setThumbnail(thumbnailUrl);
  } else {
    embed.setThumbnail(
      member.user.displayAvatarURL({
        extension: "png",
        size: 512,
      }),
    );
  }

  if (bannerUrl && isValidHttpUrl(bannerUrl)) {
    embed.setImage(bannerUrl);
  }

  return embed;
}

function chooseBackground() {
  return backgroundLinks[Math.floor(Math.random() * backgroundLinks.length)];
}

// --------------------------------------------------
// Private help embed
// --------------------------------------------------

const HELP_CATEGORIES = {
  general: {
    label: "General",
    emoji: "📌",
    description: "Basic commands and server information.",
    fields: [
      {
        name: "General Commands",
        value: [
          "`!help` — Show the private command guide",
          "`/ysabelle-help` — Open the interactive guide",
          "`!ping` — Check bot latency",
          "`!server` — View server information",
          "`!userinfo [@member]` — View member information",
        ].join("\n"),
      },
    ],
  },

  welcome: {
    label: "Welcome & Farewell",
    emoji: "👋",
    description: "Configure welcome messages, images, and farewell features.",
    fields: [
      {
        name: "Welcome Setup",
        value: [
          "`!setwelcome #channel` — Set the embed welcome channel",
          "`!setwelcomeimage #channel` — Set the image welcome channel",
          "`!welcomedesc <text>` — Customize welcome text",
          "`!welcomethumbnail <URL>` — Set the thumbnail",
          "`!welcomebanner <URL>` — Set the banner",
          "`!welcomeoff` — Disable embed welcomes",
          "`!welcomeimageoff` — Disable image welcomes",
          "`!welcometest` — Test an embed welcome",
          "`!welcomeimagetest` — Test a welcome image",
        ].join("\n"),
      },
      {
        name: "Template Variables",
        value: [
          "`?user` — Member display name",
          "`?tag` — Username or user tag",
          "`?mention` — Mention the member",
          "`?server` — Server name",
          "`?rank` — Current server member count",
          "`?useravatar` — Member avatar URL",
          "`?serveravatar` — Server icon URL",
        ].join("\n"),
      },
      {
        name: "Farewell",
        value:
          "Farewell commands depend on the features enabled in your installed farewell handler.",
      },
    ],
  },

  giveaway: {
    label: "Giveaway",
    emoji: "🎁",
    description:
      "Giveaways with activity checks, entry requirements, keyword progress, and winner selection.",
    fields: [
      {
        name: "Slash Commands",
        value: [
          "`/giveaway create` — Configure a giveaway",
          "`/giveaway status` — Check the current giveaway",
          "`/giveaway end` — End and choose whether to select winners",
          "`/giveaway reroll` — Select additional eligible winner(s)",
        ].join("\n"),
      },
      {
        name: "Prefix Commands",
        value: [
          "`!giveaway status` — View giveaway status",
          "`!giveaway progress` — Check your giveaway progress",
          "`!giveaway leaderboard` — View activity rankings",
          "`!giveaway end` — End and select winner(s)",
          "`!giveaway end none` — End without selecting winners",
          "`!giveaway role @Role` — Require a role to enter",
          "`!giveaway role off` — Remove the role requirement",
          "`!giveaway role status` — View the role requirement",
        ].join("\n"),
      },
      {
        name: "Activity Requirements",
        value: [
          "`!giveaway activity messages <number>` — Set the message target",
          "`!giveaway activity period <24h–30d>` — Set the tracking period",
          "`!giveaway activity mode total` — Use total messages in the period",
          "`!giveaway activity mode daily` — Require activity each day",
          "`!giveaway activity on` — Enable activity checks",
          "`!giveaway activity off` — Disable activity checks",
          "`!giveaway activity status` — View activity settings",
        ].join("\n"),
      },
      {
        name: "Keyword Progress",
        value: [
          "`!giveaway keyword set <keyword>` — Set the keyword",
          "`!giveaway keyword target @member` — Set the target member",
          "`!giveaway keyword days <number>` — Set the streak target",
          "`!giveaway keyword window <start> <end>` — Set the Manila-time credit window",
          "`!giveaway keyword status` — View keyword progress settings",
          "`!giveaway keyword on` — Enable keyword tracking",
          "`!giveaway keyword off` — Disable keyword tracking",
          "",
          "**Important:** Keyword credit tracks progress; it is not a giveaway entry requirement. Members can still enter if they pass the actual role and activity checks.",
          "Keyword credit requires the configured keyword and the required mention or reply to the target during the credit window. Credit is limited to once per member per Manila calendar day.",
        ].join("\n"),
      },
      {
        name: "How to Enter",
        value: [
          "1. Open the active giveaway.",
          "2. Click the **Enter Giveaway** button.",
          "3. Meet the configured role and activity requirements.",
          "4. Use the progress button to check your current progress.",
          "",
          "The keyword streak is a separate progress feature and does not automatically disqualify someone from entering.",
        ].join("\n"),
      },
      {
        name: "Ending & Winners",
        value: [
          "`/giveaway end` — Choose a winner mode",
          "`select` — Select eligible winner(s)",
          "`none` — End without selecting winners",
          "`/giveaway reroll` — Choose replacement/additional eligible winner(s)",
          "",
          "Automatic ending selects eligible winner(s). If there are no eligible candidates, no winner can be selected.",
        ].join("\n"),
      },
    ],
  },

  memory: {
    label: "Conversation Memory",
    emoji: "🧠",
    description: "Manage Ysabelle's saved conversation history and facts.",
    fields: [
      {
        name: "Memory Commands",
        value: [
          "`!memory help` — View memory help",
          "`!memory on` — Enable memory storage",
          "`!memory off` — Disable new memory storage",
          "`!memory show` — View recent history",
          "`!memory remember <fact>` — Save a fact",
          "`!memory facts` — View saved facts",
          "`!memory forget <number>` — Delete a saved fact",
          "`!memory clear` — Clear saved history",
          "`!memory channel` — View channel history, if supported",
          "`!memory channelclear` — Clear channel history, if supported",
        ].join("\n"),
      },
    ],
  },

  chat: {
    label: "Chat & AI",
    emoji: "💬",
    description:
      "Manual chat, reply permissions, AI providers, and tone settings.",
    fields: [
      {
        name: "Manual Chat & Reply",
        value: [
          "`!chat <message>` — Send a message through the bot, if authorized",
          "`!reply <message>` — Send a manual reply, if authorized",
          "`!manualcmd help` — Show manual-command help",
          "`!manualcmd status` — View configuration",
          "`!manualcmd chatrole @role` — Allow a role to use chat",
          "`!manualcmd replyrole @role` — Allow a role to use reply",
          "`!manualcmd clearchatroles` — Clear chat roles",
          "`!manualcmd clearreplyroles` — Clear reply roles",
          "`!manualcmd audit` — View audit settings",
        ].join("\n"),
      },
      {
        name: "AI & Personality",
        value: [
          "`!aimode auto` — Use automatic provider selection, if supported",
          "`!aimode ollama` — Use Ollama, if supported",
          "`!aimode gemini` — Use Gemini, if supported",
          "`!tone english` — Prefer English, if supported",
          "`!tone tagalog` — Prefer Tagalog, if supported",
          "`!tone taglish` — Prefer Taglish, if supported",
        ].join("\n"),
      },
    ],
  },
  tasks: {
    label: "Tasks & Contribution",
    emoji: "📋",
    description:
      "Complete tasks, earn contribution points, submit proof, and manage server roles.",
    fields: [
      {
        name: "Member Commands",
        value: [
          "`/tasks list` — View available tasks",
          "`/tasks progress` — Check task and contribution progress",
          "`/tasks submit` — Submit task proof for review",
          "`/tasks roles` — View contribution role tiers",
          "`/tasks stats` — View contribution statistics",
        ].join("\n"),
      },
      {
        name: "Task Management",
        value: [
          "`/tasksetup task-add` — Create a task",
          "`/tasksetup task-edit` — Edit a task",
          "`/tasksetup task-delete` — Delete a task",
          "`/tasksetup task-list` — View configured tasks",
          "`/tasksetup status` — View system settings",
        ].join("\n"),
      },
      {
        name: "Reviews & Role Management",
        value: [
          "`/tasks submissions` — View submitted task proof",
          "`/tasks review` — Approve or reject a submission",
          "`/tasks grant-role` — Grant an approval-based role",
          "`/tasksetup review-channel` — Configure the review channel",
          "`/tasksetup log-channel` — Configure the log channel",
          "`/tasksetup reviewer-role` — Manage reviewer roles",
          "`/tasksetup reset` — Reset a setting",
        ].join("\n"),
      },
      {
        name: "How It Works",
        value: [
          "• Complete tasks to earn contribution points.",
          "• Some tasks can track activity automatically.",
          "• Tasks requiring proof must be reviewed by staff.",
          "• Contribution roles and chat XP levels are separate systems.",
          "• Setup commands require the appropriate permissions.",
        ].join("\n"),
      },
    ],
  },

  xpstaff: {
    label: "XP, Levels & Staff",
    emoji: "⭐",
    description:
      "Earn XP through chat activity, level up, and apply for staff when eligible.",
    fields: [
      {
        name: "XP & Levels",
        value: [
          "`/level` — View your level and XP",
          "`/xpleaderboard` — View the XP leaderboard",
          "`/tasks progress` — Check task progress and contribution information",
          "",
          "**Default settings**",
          "• 5 XP per qualifying message",
          "• 60-second XP cooldown",
          "• Level 5 required to apply for staff",
        ].join("\n"),
      },
      {
        name: "Staff Applications",
        value: [
          "`/staffapply` — Apply for staff if eligible",
          "`/staffapplications` — View pending applications (authorized reviewers)",
          "`/staffreview` — Approve or reject an application (authorized reviewers)",
          "",
          "Staff applications may require a reason and relevant experience.",
          "Approval does not automatically grant staff permissions. An administrator must assign the staff role.",
        ].join("\n"),
      },
      {
        name: "XP & Staff Configuration",
        value: [
          "`/xpstaff settings` — Configure XP and staff eligibility",
          "`/xpstaff status` — View XP and staff settings",
          "",
          "Administrators can configure XP per message, cooldown, minimum staff level, and the application channel.",
        ].join("\n"),
      },
      {
        name: "Important Information",
        value: [
          "• XP is earned separately from task contribution points.",
          "• Repeated or very short messages may not qualify for XP.",
          "• Reaching the required level makes you eligible to apply; it does not guarantee acceptance.",
          "• Staff applications are reviewed by authorized members.",
        ].join("\n"),
      },
    ],
  },
  entertainment: {
    label: "Meme & Entertainment",
    emoji: "😂",
    description: "Meme, roast, shipping, and entertainment features.",
    fields: [
      {
        name: "Entertainment Commands",
        value: [
          "`!meme` — Send a random meme, if supported",
          "`!meme gaming` — Gaming memes, if supported",
          "`!meme school` — School memes, if supported",
          "`!meme relationship` — Relationship memes, if supported",
          "`!roast @member` — Roast a member, if supported",
          "`!ship @member1 @member2` — Ship two members, if supported",
          "`!entertainment help` — Show entertainment help, if supported",
        ].join("\n"),
      },
      {
        name: "NSFW Settings",
        value: [
          "`!nsfw status` — Check NSFW settings, if supported",
          "`!nsfw on` / `!nsfw off` — Change settings, if supported",
        ].join("\n"),
      },
    ],
  },

  autoship: {
    label: "AutoShip",
    emoji: "💞",
    description:
      "Random pairings, manual shipping, and chaotic relationship entertainment.",
    fields: [
      {
        name: "AutoShip Features",
        value: [
          "`!ship @member1 @member2` — Manually ship two members, if supported",
          "",
          "• Automatic random ship drops",
          "• Manual member pairings",
          "• Random eligible member selection",
          "• Ship history and cooldown tracking",
          "• Channel-based ship messages, if configured",
          "• Duplicate-pair protection, if enabled",
          "",
          "Automatic drops and manual shipping may use separate cooldowns.",
          "Use your AutoShip handler's help command for the exact configuration syntax.",
        ].join("\n"),
      },
    ],
  },

  autodelete: {
    label: "AutoDelete",
    emoji: "🧹",
    description: "Automatic message cleanup and deletion timers.",
    fields: [
      {
        name: "AutoDelete Features",
        value: [
          "• Automatically delete configured messages",
          "• Configure cleanup timing, if supported",
          "• Random-minute deletion intervals, if enabled",
          "• View the current configuration, if supported",
          "",
          "Use the AutoDelete handler's help command for the exact commands and settings.",
        ].join("\n"),
      },
    ],
  },

  confessions: {
    label: "Confessions",
    emoji: "💜",
    description: "Anonymous confession features.",
    fields: [
      {
        name: "Confession Commands",
        value: [
          "`/confess` — Submit a confession, if registered",
          "",
          "Moderation and management commands depend on your confession handler and permissions.",
        ].join("\n"),
      },
    ],
  },

  moderation: {
    label: "Moderation & Security",
    emoji: "🛡️",
    description: "Moderation and access controls.",
    fields: [
      {
        name: "Moderation",
        value: [
          "`!warn @member <reason>` — Issue a warning, if supported",
          "`!autodelete` — Configure message cleanup, if supported",
        ].join("\n"),
      },
      {
        name: "Permissions & Privacy",
        value: [
          "• Some commands require Manage Server permission.",
          "• Manual chat and reply commands follow configured role permissions.",
          "• Giveaway management requires Manage Server permission.",
          "• Memory settings affect stored conversation data.",
          "• Never share your bot token or private credentials.",
        ].join("\n"),
      },
    ],
  },
};

function buildHelpEmbed(user, category = "general") {
  const page = HELP_CATEGORIES[category] || HELP_CATEGORIES.general;

  return new EmbedBuilder()
    .setTitle(`${page.emoji} Ysabelle • ${page.label}`)
    .setColor(0x8b5cf6)
    .setDescription(
      [
        `Hello, ${user.username}!`,
        "",
        page.description,
        "",
        `**Prefix:** \`${PREFIX}\``,
        "Choose a category from the menu below to browse commands.",
      ].join("\n"),
    )
    .addFields(page.fields)
    .setFooter({
      text: `Ysabelle • Kator6 | Category: ${page.label}`,
    })
    .setTimestamp();
}

function buildHelpMenu(selectedCategory = "general") {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ysabelle_help_category")
    .setPlaceholder("Choose a feature to view its commands")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      Object.entries(HELP_CATEGORIES).map(([value, page]) => ({
        label: page.label,
        value,
        emoji: page.emoji,
        description: page.description.slice(0, 100),
        default: value === selectedCategory,
      })),
    );

  return [new ActionRowBuilder().addComponents(menu)];
}

// --------------------------------------------------
// Register /ysabelle-help without replacing other commands
// --------------------------------------------------

async function registerHelpCommand() {
  try {
    const helpData = new SlashCommandBuilder()
      .setName("ysabelle-help")
      .setDescription("Open Ysabelle's private command guide")
      .toJSON();

    const existingCommands = await client.application.commands.fetch();

    const existingHelp = existingCommands.find(
      (command) => command.name === "ysabelle-help",
    );

    if (existingHelp) {
      await client.application.commands.edit(existingHelp.id, helpData);
      console.log("Updated global command: /ysabelle-help");
    } else {
      const created = await client.application.commands.create(helpData);
      console.log(`Created global command: /${created.name}`);
    }

    const registeredCommands = await client.application.commands.fetch();

    console.log(
      "Globally registered commands:",
      registeredCommands.map((command) => `/${command.name}`),
    );
  } catch (error) {
    console.error("Failed to register /ysabelle-help:", error);
  }
}
// --------------------------------------------------
// Slash commands and interactions
// --------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ysabelle_help_category"
    ) {
      const selectedCategory = interaction.values[0];

      if (!HELP_CATEGORIES[selectedCategory]) {
        await interaction.reply({
          content: "That help category is not available.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.update({
        embeds: [buildHelpEmbed(interaction.user, selectedCategory)],
        components: buildHelpMenu(selectedCategory),
      });

      return;
    }
    if (interaction.commandName === "fun") {
      await funGames.handleSlashCommand(interaction, db);
      return;
    }
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "giveaway") {
        await giveawayModule.handleSlashCommand(interaction);
        return;
      }

      if (interaction.commandName === "tasks") {
        await taskRoleSystem.handleSlashCommand(interaction);
        return;
      }

      if (interaction.commandName === "tasksetup") {
        await taskRoleSystem.handleSetupSlashCommand(interaction);
        return;
      }
      const xpStaffCommands = [
        "help",
        "level",
        "xpleaderboard",
        "staffapply",
        "staffapplications",
        "staffreview",
        "xpstaff",
        "xpvoice",
        "levelup-channel",
      ];

      if (xpStaffCommands.includes(interaction.commandName)) {
        await xpLevelStaff.handleSlashCommand(interaction);
        return;
      }

      if (interaction.commandName === "ysabelle-help") {
        await interaction.reply({
          embeds: [buildHelpEmbed(interaction.user, "general")],
          components: buildHelpMenu("general"),
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (error) {
    console.error("[Ysabelle] Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: "Something went wrong while processing that command.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }
});

// --------------------------------------------------
// Embed welcome event
// --------------------------------------------------

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    // Initialize the task system for the joining member.
    await taskRoleSystem.handleMemberJoin(member).catch((error) => {
      console.error("[Task System] Member initialization failed:", error);
    });

    const channelId = await db.get(`welcome_${member.guild.id}`);
    if (!channelId) return;

    const [savedText, thumbnailTemplate, bannerTemplate] = await Promise.all([
      db.get(`desc_${member.guild.id}`),
      db.get(`thumbnail_${member.guild.id}`),
      db.get(`image_${member.guild.id}`),
    ]);

    const text =
      savedText ||
      "Hey ?mention! Welcome to **?server**. You're member **#?rank**. Have fun and enjoy Kator6!";

    const description = replaceWelcomeVariables(text, member);
    const thumbnail = thumbnailTemplate
      ? replaceUrlVariables(thumbnailTemplate, member)
      : null;
    const banner = bannerTemplate
      ? replaceUrlVariables(bannerTemplate, member)
      : null;

    const channel = await member.guild.channels
      .fetch(channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.send) {
      console.warn("Configured embed welcome channel is unavailable.");
      return;
    }

    await channel.send({
      embeds: [makeEmbed(description, member, thumbnail, banner)],
      allowedMentions: { users: [member.id] },
    });
  } catch (error) {
    console.error("Embed welcome error:", error);
  }
});

// --------------------------------------------------
// Generated image welcome event
// --------------------------------------------------

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const channelId = await db.get(`welcomeimg_${member.guild.id}`);
    if (!channelId) return;
    if (!backgroundLinks.length) return;

    const channel = await member.guild.channels
      .fetch(channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased() || !channel.send) {
      console.warn("Configured image welcome channel is unavailable.");
      return;
    }

    const [background, avatar] = await Promise.all([
      loadBackground(chooseBackground()),
      loadUserAvatar(member.user),
    ]);

    const imageBuffer = await createWelcomeImage({
      background,
      avatar,
      displayName: member.displayName,
      memberCount: member.guild.memberCount,
      joinedDate: moment().format("MMM D, YYYY"),
      serverName: member.guild.name,
    });

    const attachment = new AttachmentBuilder(imageBuffer, {
      name: "ysabelle-welcome.png",
    });

    await channel.send({
      content: `Welcome to **${member.guild.name}**, <@${member.id}>!`,
      files: [attachment],
      allowedMentions: { users: [member.id] },
    });
  } catch (error) {
    console.error("Image welcome error:", error);
  }
});

// --------------------------------------------------
// Prefix commands and task activity tracking
// --------------------------------------------------

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  await funGames.handleChallengeReply(message, db);
  if (await ownerOnly.handleMessage(message)) return;
  // Track task activity.
  try {
    await taskRoleSystem.handleMessageCreate(message);
  } catch (error) {
    console.error("[Task System] Message tracking failed:", error);
  }

  const content = message.content.trim();

  const hasPrefix = content.startsWith(PREFIX);
  const input = hasPrefix ? content.slice(PREFIX.length).trim() : "";

  const [rawCommand = "", ...args] = input.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const rest = input.slice(rawCommand.length).trim();

  // Handle !level before the regular prefix-command flow.
  // This must be outside the non-prefix-message condition.
  if (hasPrefix && command === "level") {
    try {
      await xpLevelStaff.handlePrefixCommand(message);
    } catch (error) {
      console.error("[XP & Staff] !level failed:", error);

      await message
        .reply("Unable to load your level right now. Please try again.")
        .catch(() => {});
    }
    return;
  }

  // Track XP for regular messages only.
  if (!hasPrefix) {
    try {
      await xpLevelStaff.handleMessageCreate(message);
    } catch (error) {
      console.error("[XP & Staff] Message tracking failed:", error);
    }
    return;
  }

  // Ignore messages containing only the prefix.
  if (!input) return;

  // Giveaway prefix commands.
  try {
    if (await giveawayModule.handlePrefix(message)) return;
  } catch (error) {
    console.error("[Giveaway] Prefix command failed:", error);
    return;
  }

  // Help command.
  if (command === "help") {
    await message.delete().catch(() => {});

    const reply = await message.channel
      .send({
        content: `${message.author}, use \`/ysabelle-help\` to open Ysabelle's private command guide.`,
        allowedMentions: {
          users: [message.author.id],
        },
      })
      .catch(() => null);

    if (reply) {
      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 5000);
    }

    return;
  }

  // Command cooldown.
  const now = Date.now();
  const expiry = cooldowns.get(message.author.id);

  if (expiry && now < expiry) {
    return message
      .reply(`Please wait ${Math.ceil((expiry - now) / 1000)} second(s).`)
      .catch(() => {});
  }

  cooldowns.set(message.author.id, now + COOLDOWN_SECONDS * 1000);

  setTimeout(() => {
    if (cooldowns.get(message.author.id) <= Date.now()) {
      cooldowns.delete(message.author.id);
    }
  }, COOLDOWN_SECONDS * 1000);

  try {
    // Ping command.
    if (command === "ping") {
      return message.reply(`Pong! ${client.ws.ping} ms`);
    }

    // Server information.
    if (command === "server") {
      const owner = await message.guild.fetchOwner();

      const embed = new EmbedBuilder()
        .setTitle(message.guild.name)
        .setColor(0x8b5cf6)
        .setDescription(
          [
            `**Members:** ${message.guild.memberCount}`,
            `**Created:** <t:${Math.floor(message.guild.createdTimestamp / 1000)}:D>`,
            `**Owner:** <@${owner.id}>`,
          ].join("\n"),
        );

      const icon = message.guild.iconURL();
      if (icon) embed.setThumbnail(icon);

      return message.reply({ embeds: [embed] });
    }

    // User information.
    if (command === "userinfo") {
      const target =
        message.mentions.members.first() ||
        (args[0]
          ? await message.guild.members.fetch(args[0]).catch(() => null)
          : message.member);

      if (!target) {
        return message.reply("I couldn't find that member.");
      }

      const embed = new EmbedBuilder()
        .setTitle(`User Information • ${target.displayName}`)
        .setColor(0x8b5cf6)
        .setThumbnail(target.user.displayAvatarURL({ size: 512 }))
        .addFields(
          {
            name: "Server display name",
            value: target.displayName,
            inline: true,
          },
          {
            name: "Username",
            value: target.user.tag || target.user.username,
            inline: true,
          },
          {
            name: "User ID",
            value: target.id,
            inline: true,
          },
          {
            name: "Joined server",
            value: target.joinedTimestamp
              ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`
              : "Unknown",
            inline: true,
          },
          {
            name: "Account created",
            value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:D>`,
            inline: true,
          },
        );

      return message.reply({ embeds: [embed] });
    }

    // Warning commands.
    if (await handleWarnCommand(message)) return;

    // Welcome setup commands.
    const setupCommands = [
      "setwelcome",
      "setwelcomeimage",
      "welcomedesc",
      "welcomethumbnail",
      "welcomebanner",
      "welcomeoff",
      "welcomeimageoff",
      "welcometest",
      "welcomeimagetest",
    ];

    if (!setupCommands.includes(command)) return;

    if (!isStaff(message)) {
      return message.reply(
        "You need the **Manage Server** permission to do that.",
      );
    }

    const guildId = message.guild.id;

    // Set welcome channel.
    if (command === "setwelcome" || command === "setwelcomeimage") {
      const channel =
        message.mentions.channels.first() ||
        (args[0]
          ? await message.guild.channels.fetch(args[0]).catch(() => null)
          : null);

      if (!channel || channel.type !== ChannelType.GuildText) {
        return message.reply(
          "Please mention a text channel, for example `!setwelcome #welcome`.",
        );
      }

      const key =
        command === "setwelcome"
          ? `welcome_${guildId}`
          : `welcomeimg_${guildId}`;

      await db.set(key, channel.id);

      return message.reply(
        `Saved ${
          command === "setwelcome" ? "embed" : "image-card"
        } welcome channel: ${channel}.`,
      );
    }

    // Set welcome description.
    if (command === "welcomedesc") {
      if (!rest) {
        return message.reply(
          "Provide a description. Example: `!welcomedesc Hey ?mention! Welcome to ?server. You're member #?rank!`",
        );
      }

      if (rest.length > 4000) {
        return message.reply(
          "Please keep the description under 4,000 characters.",
        );
      }

      await db.set(`desc_${guildId}`, rest);
      return message.reply("Welcome description saved.");
    }

    // Set welcome thumbnail or banner URL.
    if (command === "welcomethumbnail" || command === "welcomebanner") {
      if (!isValidHttpUrl(args[0])) {
        return message.reply("Please provide a valid HTTP or HTTPS image URL.");
      }

      const key =
        command === "welcomethumbnail"
          ? `thumbnail_${guildId}`
          : `image_${guildId}`;

      await db.set(key, args[0]);

      return message.reply(
        `${command === "welcomethumbnail" ? "Thumbnail" : "Banner"} URL saved.`,
      );
    }

    // Disable welcome messages.
    if (command === "welcomeoff" || command === "welcomeimageoff") {
      const key =
        command === "welcomeoff"
          ? `welcome_${guildId}`
          : `welcomeimg_${guildId}`;

      await db.delete(key);

      return message.reply(
        `${
          command === "welcomeoff" ? "Embed" : "Image-card"
        } welcomes disabled.`,
      );
    }

    // Test the welcome embed.
    if (command === "welcometest") {
      const welcomeText =
        (await db.get(`desc_${guildId}`)) ||
        "Hey ?mention! Welcome to **?server**. You're member **#?rank**. Have fun!";

      const description = replaceWelcomeVariables(welcomeText, message.member);

      const thumbnailTemplate = await db.get(`thumbnail_${guildId}`);
      const bannerTemplate = await db.get(`image_${guildId}`);

      const thumbnail = thumbnailTemplate
        ? replaceUrlVariables(thumbnailTemplate, message.member)
        : null;

      const banner = bannerTemplate
        ? replaceUrlVariables(bannerTemplate, message.member)
        : null;

      return message.channel.send({
        embeds: [makeEmbed(description, message.member, thumbnail, banner)],
        allowedMentions: {
          users: [message.author.id],
        },
      });
    }

    // Test the welcome image card.
    if (command === "welcomeimagetest") {
      if (!backgroundLinks.length) {
        return message.reply(
          "No backgrounds found. Check `JSON/link.json` and make sure the image file exists.",
        );
      }

      const [background, avatar] = await Promise.all([
        loadBackground(chooseBackground()),
        loadUserAvatar(message.author),
      ]);

      const imageBuffer = await createWelcomeImage({
        background,
        avatar,
        displayName: message.member.displayName,
        memberCount: message.guild.memberCount,
        joinedDate: moment(message.member.joinedAt || Date.now()).format(
          "MMM D, YYYY",
        ),
        serverName: message.guild.name,
      });

      const attachment = new AttachmentBuilder(imageBuffer, {
        name: "ysabelle-welcome-test.png",
      });

      return message.channel.send({
        files: [attachment],
      });
    }
  } catch (error) {
    console.error(`[Command: ${command}] Failed:`, error);

    return message
      .reply("Something went wrong. Check the terminal for the error.")
      .catch(() => {});
  }
});

// --------------------------------------------------
// Keep-alive HTTP server
// --------------------------------------------------

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Ysabelle is online.");
});

server.listen(PORT, () => {
  console.log(`Keep-alive server listening on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("Keep-alive server error:", error);
});

// --------------------------------------------------
// Ready and login
// --------------------------------------------------

if (!process.env.DISCORD_TOKEN) {
  console.error(
    "[Ysabelle] DISCORD_TOKEN is missing from environment variables.",
  );
  process.exit(1);
}

client.once("ready", async () => {
  console.log(`[Ysabelle] Logged in as ${client.user.tag}`);

  await registerWithRetry(registerFunGamesSlashCommand, "Fun Games");

  await registerWithRetry(registerGiveawaySlashCommand, "Giveaway");

  await registerWithRetry(registerHelpCommand, "Help");

  await registerWithRetry(registerTaskRoleSlashCommands, "Task System");

  await registerXpLevelStaffSlashCommands();
  console.log("[Ysabelle] Slash-command registration process finished.");
});

client.on("shardDisconnect", (event, shardId) => {
  console.error(
    `[Ysabelle] Disconnected: shard=${shardId}, code=${event.code}`,
  );
});

client.on("shardReconnecting", (shardId) => {
  console.warn(`[Ysabelle] Reconnecting: shard=${shardId}`);
});

client.on("shardResume", (shardId) => {
  console.log(`[Ysabelle] Connection resumed: shard=${shardId}`);
});

client.on("shardError", (error, shardId) => {
  console.error(`[Ysabelle] Shard ${shardId} error:`, error);
});

client.on("error", (error) => {
  console.error("[Ysabelle] Discord client error:", error);
});

setInterval(() => {
  const shard = client.ws.shards.first();

  console.log("[Ysabelle Health]", {
    loggedIn: client.isReady(),
    user: client.user?.tag ?? "Not logged in",
    websocketStatus: shard?.status ?? "No shard",
    ping: shard?.ping ?? -1,
    uptime: process.uptime(),
  });
}, 60_000);

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("[Ysabelle] Discord login failed:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[Ysabelle] Unhandled promise rejection:", error);
});
