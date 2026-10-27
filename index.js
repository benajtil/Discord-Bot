require("dotenv").config();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

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
  ],
});
const {
  registerEntertainment,
} = require("./handlers/entertainment/meme-reactions");
const registerMemory = require("./memory");
const { registerAutoDelete } = require("./handlers/autodelete/autodelete");
const { registerAutoShip } = require("./handlers/entertainment/autoship");
const { registerAutoReply } = require("./handlers/autoreply/autoreply");
const { handleWarnCommand } = require("./handlers/moderation/warn");
const { registerConfessions } = require("./handlers/entertainment/confessions");
const { createGiveawayModule } = require("./handlers/giveaway/giveaway");
registerAutoShip(client);
registerAutoDelete(client);
registerMemory(client, db, PREFIX);
require("./farewell")(client, db, PREFIX, DEVELOPER_ID);
registerAutoReply(client);
registerConfessions(client);
registerEntertainment(client);
client.commands = new Collection();
client.aliases = new Collection();

const cooldowns = new Map();
const COOLDOWN_SECONDS = 1;

const fontDirectory = path.join(__dirname, "fonts");
const vampireFont = path.join(fontDirectory, "Vampire Wars.ttf");
const quicksandFont = path.join(fontDirectory, "Quicksand-SemiBold.ttf");
const giveawayModule = createGiveawayModule(client, db, PREFIX);
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

function buildHelpEmbed(user) {
  return new EmbedBuilder()
    .setTitle("💜 Ysabelle • Private Command Guide")
    .setColor(0x8b5cf6)
    .setDescription(
      [
        `Hello, ${user.username}!`,
        "",
        "This guide is visible only to you when opened privately.",
        "",
        `**Prefix:** \`${PREFIX}\``,
        "**Slash commands:** Type `/` to find registered commands.",
        "Replace placeholders such as `@member`, `#channel`, and `<text>` with actual values.",
      ].join("\n"),
    )
    .addFields(
      {
        name: "📌 General",
        value: [
          "`!help` — Show this command guide",
          "`/ysabelle-help` — Open this guide privately",
          "`!ping` — Check bot latency, if registered",
          "`!server` — View server information, if registered",
          "`!userinfo [@member]` — View member information, if registered",
        ].join("\n"),
      },
      {
        name: "👋 Welcome Setup",
        value: [
          "`!setwelcome #channel` — Set the embed welcome channel",
          "`!setwelcomeimage #channel` — Set the image welcome channel",
          "`!welcomedesc <text>` — Set the welcome message",
          "`!welcomethumbnail <URL>` — Set the welcome thumbnail",
          "`!welcomebanner <URL>` — Set the welcome banner",
          "`!welcomeoff` — Disable embed welcomes",
          "`!welcomeimageoff` — Disable image welcomes",
          "`!welcometest` — Test the embed welcome",
          "`!welcomeimagetest` — Test the image welcome",
        ].join("\n"),
      },
      {
        name: "🚪 Farewell",
        value: [
          "`!setleave #channel` — Set the farewell channel, if implemented",
          "`!leavedesc <text>` — Customize farewell text, if implemented",
          "`!leaveoff` — Disable farewells, if implemented",
          "`!leavetest` — Test farewell messages, if implemented",
        ].join("\n"),
      },
      {
        name: "📝 Welcome Template Variables",
        value: [
          "`?user` — Member display name",
          "`?tag` — Username or user tag",
          "`?mention` — Mention the member",
          "`?server` — Server name",
          "`?rank` — Current member count",
          "`?useravatar` — Member avatar URL",
          "`?serveravatar` — Server icon URL",
        ].join("\n"),
      },
      {
        name: "🎁 Giveaway Setup",
        value: [
          "`/giveaway create` — Create a giveaway",
          "`/giveaway prize <text>` — Set the prize",
          "`/giveaway channel #channel` — Select the channel",
          "`/giveaway ends <date/time>` — Set the deadline",
          "`/giveaway winners <number>` — Set winner count",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🔐 Giveaway Requirements",
        value: [
          "`/giveaway requirement-messages <count> <days>` — Message requirement",
          "`/giveaway requirement-days <count> <days>` — Active-day requirement",
          "`/giveaway requirement-role @role` — Require a role",
        ].join("\n"),
        inline: false,
      },
      {
        name: "⚙️ Giveaway Management",
        value: [
          "`/giveaway preview` — Preview settings",
          "`/giveaway publish` — Publish the giveaway",
          "`/giveaway status` — Check status",
          "`/giveaway end` — End the giveaway",
          "`/giveaway reroll` — Select another winner",
          "`/giveaway reset` — Reset giveaway data",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🎉 Joining & Eligibility",
        value: [
          "React with 🎉 to enter.",
          "Ineligible reactions are removed, and the missing requirement is explained.",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🧠 Conversation Memory",
        value: [
          "`!memory help` — Show memory commands",
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
      {
        name: "💬 Manual Chat & Reply",
        value: [
          "`!chat <message>` — Post a message through the bot, if authorized",
          "`!reply <message>` — Send a manual reply through the bot, if authorized",
          "`!manualcmd help` — Show manual-command settings help",
          "`!manualcmd status` — View manual-command configuration",
          "`!manualcmd chatrole @role` — Assign a role allowed to use chat",
          "`!manualcmd replyrole @role` — Assign a role allowed to use reply",
          "`!manualcmd clearchatroles` — Clear assigned chat roles",
          "`!manualcmd clearreplyroles` — Clear assigned reply roles",
          "`!manualcmd audit` — View manual-command audit settings",
          "`!manualcmd content` — View content settings, if supported",
          "`!manualcmd adminbypass` — Configure administrator bypass, if supported",
        ].join("\n"),
      },
      {
        name: "🤖 AI & Personality",
        value: [
          "`!aimode auto` — Automatic AI provider selection, if implemented",
          "`!aimode ollama` — Select Ollama, if implemented",
          "`!aimode gemini` — Select Gemini, if implemented",
          "`!tone english` — English responses, if implemented",
          "`!tone tagalog` — Tagalog responses, if implemented",
          "`!tone taglish` — Taglish responses, if implemented",
          "AI provider and personality commands depend on your current AI handler.",
        ].join("\n"),
      },
      {
        name: "😂 Meme & Roast",
        value: [
          "`!meme` — Send a random meme, if registered",
          "`!meme gaming` — Gaming memes, if supported",
          "`!meme school` — School memes, if supported",
          "`!meme relationship` — Relationship memes, if supported",
          "`!roast @member` — Roast a member, if registered",
          "`!ship @member1 @member2` — Ship two members, if supported",
          "`!nsfw status` — Check NSFW setting, if supported",
          "`!nsfw on/off` — Change NSFW setting, if supported",
          "`!entertainment help` — Entertainment guide, if supported",
        ].join("\n"),
      },
      {
        name: "💞 AutoShip",
        value: [
          "AutoShip handler is registered.",
          "Manual ship commands and automatic ship drops depend on the commands configured in your AutoShip module.",
          "Check that module's help output for the exact syntax.",
        ].join("\n"),
      },
      {
        name: "🧹 AutoDelete",
        value: [
          "AutoDelete handler is registered.",
          "Use the AutoDelete command's own help output to see supported cleanup settings.",
          "Available options depend on your installed handler.",
        ].join("\n"),
      },
      {
        name: "💜 Confessions",
        value: [
          "`/confess` — Submit an anonymous confession, if registered",
          "Identity lookup and confession-management commands depend on your permissions and confession handler.",
        ].join("\n"),
      },
      {
        name: "🛡️ Moderation",
        value: [
          "`!warn @member <reason>` — Issue a warning, if registered",
          "`!autodelete` — Configure automatic message cleanup, if supported",
          "Other moderation commands depend on your installed modules.",
        ].join("\n"),
      },
      {
        name: "🔐 Permissions & Privacy",
        value: [
          "Some commands are restricted to administrators or assigned roles.",
          "Manual chat and reply access follows your manual-command configuration.",
          "Giveaway management requires Manage Server permission in the provided module.",
          "Memory controls may affect what conversation data is stored.",
          "Never share your bot token or private credentials.",
        ].join("\n"),
      },
    )
    .setFooter({ text: "Ysabelle • Kator6 | Command Guide" })
    .setTimestamp();
}

// --------------------------------------------------
// Register /help without replacing other commands
// --------------------------------------------------

async function registerHelpCommand() {
  try {
    const helpData = new SlashCommandBuilder()
      .setName("ysabelle-help")
      .setDescription("Open Ysabelle's private command guide")
      .toJSON();

    // Fetch existing global commands without deleting other commands.
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

    // Verify what is registered globally.
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
// Slash commands
// --------------------------------------------------

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "giveaway") {
        await giveawayModule.handleSlashCommand(interaction);
        return;
      }

      if (interaction.commandName === "ysabelle-help") {
        await interaction.reply({
          embeds: [buildHelpEmbed(interaction.user)],
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
// Prefix commands
// --------------------------------------------------

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const input = message.content.slice(PREFIX.length).trim();
  if (!input) return;

  const [rawCommand, ...args] = input.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const rest = input.slice(rawCommand.length).trim();
  if (await giveawayModule.handlePrefix(message)) return;

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
    if (command === "ping") {
      return message.reply(`Pong! ${client.ws.ping} ms`);
    }

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

    if (command === "userinfo") {
      const target =
        message.mentions.members.first() ||
        (args[0]
          ? await message.guild.members.fetch(args[0]).catch(() => null)
          : message.member);

      if (!target) return message.reply("I couldn't find that member.");

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
          { name: "User ID", value: target.id, inline: true },
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

    if (await handleWarnCommand(message)) return;

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
        `Saved ${command === "setwelcome" ? "embed" : "image-card"} welcome channel: ${channel}.`,
      );
    }

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

    if (command === "welcomeoff" || command === "welcomeimageoff") {
      const key =
        command === "welcomeoff"
          ? `welcome_${guildId}`
          : `welcomeimg_${guildId}`;

      await db.delete(key);

      return message.reply(
        `${command === "welcomeoff" ? "Embed" : "Image-card"} welcomes disabled.`,
      );
    }

    if (command === "welcometest") {
      const text =
        (await db.get(`desc_${guildId}`)) ||
        "Hey ?mention! Welcome to **?server**. You're member **#?rank**. Have fun!";

      const description = replaceWelcomeVariables(text, message.member);
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
        allowedMentions: { users: [message.author.id] },
      });
    }

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

      return message.channel.send({ files: [attachment] });
    }
  } catch (error) {
    console.error(`Command "${command}" failed:`, error);

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
  await registerGiveawaySlashCommand();
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
