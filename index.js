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
} = require("discord.js");

const { QuickDB } = require("quick.db");
const {
  Canvas,
  loadImage,
  loadFont: registerFont,
} = require("canvas-constructor/napi-rs");
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
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();
client.aliases = new Collection();

const cooldowns = new Map();
const COOLDOWN_SECONDS = 1;

const fontDirectory = path.join(__dirname, "fonts");
const vampireFont = path.join(fontDirectory, "Vampire Wars.ttf");
const quicksandFont = path.join(fontDirectory, "Quicksand-SemiBold.ttf");

// ─────────────────────────────────────────────
// Fonts
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Background configuration
// ─────────────────────────────────────────────

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
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

// ─────────────────────────────────────────────
// Avatar loading
// ─────────────────────────────────────────────

async function loadUserAvatar(user) {
  const avatarUrl = user.displayAvatarURL({
    extension: "png",
    size: 256,
    forceStatic: true,
  });

  console.log("Loading avatar for:", user.username);

  const response = await fetch(avatarUrl);

  if (!response.ok) {
    throw new Error(`Could not download avatar: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const avatar = await loadNapiImage(buffer);

  console.log(`Avatar loaded: ${avatar.width}x${avatar.height}`);

  return avatar;
}

// ─────────────────────────────────────────────
// Complete welcome image renderer
// Uses @napi-rs/canvas for ALL drawing.
// ─────────────────────────────────────────────

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

  // Draw the background.
  ctx.drawImage(background, 0, 0, width, height);

  // Dark overlay to make text easier to read.
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, width, height);

  // Avatar position and dimensions.
  const centerX = 150;
  const centerY = 150;
  const radius = 110;
  const borderWidth = 4;

  // Draw the white border first.
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + borderWidth, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();

  // Clip the avatar to a circle and draw it.
  ctx.save();

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  // drawImage receives the actual loaded image object.
  ctx.drawImage(
    avatar,
    centerX - radius,
    centerY - radius,
    radius * 2,
    radius * 2,
  );

  ctx.restore();

  // Text styling.
  const fontName = fs.existsSync(quicksandFont)
    ? "Quicksand-SemiBold"
    : "Arial";

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // WELCOME heading.
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = `22px "${fontName}"`;
  ctx.fillText("WELCOME", 317, 68);

  // Member display name.
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

  // Divider.
  ctx.fillStyle = "rgba(255, 255, 255, 0.30)";
  ctx.fillRect(295, 138, width - 325, 2);

  // Member number.
  ctx.fillStyle = "rgba(255, 255, 255, 0.90)";
  ctx.font = `22px "${fontName}"`;
  ctx.fillText(`Member #${memberCount}`, 295, 175);

  // Join date.
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = `18px "${fontName}"`;
  ctx.fillText(`Joined ${joinedDate}`, 295, 210);

  // Server name.
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.fillText(String(serverName).slice(0, 42), 295, 245);

  return canvas.toBuffer("image/png");
}

// ─────────────────────────────────────────────
// Other helpers
// ─────────────────────────────────────────────

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
    .setFooter({
      text: `Member #${member.guild.memberCount}`,
    })
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

// ─────────────────────────────────────────────
// Embed welcome event
// ─────────────────────────────────────────────

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
      allowedMentions: {
        users: [member.id],
      },
    });
  } catch (error) {
    console.error("Embed welcome error:", error);
  }
});

// ─────────────────────────────────────────────
// Generated image welcome event
// ─────────────────────────────────────────────

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const channelId = await db.get(`welcomeimg_${member.guild.id}`);
    if (!channelId) return;

    if (!backgroundLinks.length) {
      console.warn("No valid image backgrounds are configured.");
      return;
    }

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
      allowedMentions: {
        users: [member.id],
      },
    });
  } catch (error) {
    console.error("Image welcome error:", error);
  }
});

// ─────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────

async function sendHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle("Ysabelle • Command Guide")
    .setColor(0x8b5cf6)
    .setDescription("Kator6's welcome configuration and utility commands.")
    .addFields(
      {
        name: "General",
        value: [
          "`!help` — Show this help message",
          "`!ping` — Check bot response",
          "`!server` — Show server information",
          "`!userinfo [@member]` — Show member information",
        ].join("\n"),
      },
      {
        name: "Welcome setup • Manage Server",
        value: [
          "`!setwelcome #channel` — Set embed welcome channel",
          "`!setwelcomeimage #channel` — Set image-card channel",
          "`!welcomedesc <text>` — Set the embed description",
          "`!welcomethumbnail <URL>` — Set thumbnail template",
          "`!welcomebanner <URL>` — Set optional embed banner",
          "`!welcomeoff` — Disable embed welcomes",
          "`!welcomeimageoff` — Disable image welcomes",
          "`!welcometest` — Preview the embed welcome",
          "`!welcomeimagetest` — Preview the image card",
        ].join("\n"),
      },
      {
        name: "Template variables",
        value:
          "`?user`, `?tag`, `?mention`, `?server`, `?rank`, `?useravatar`, `?serveravatar`",
      },
    )
    .setFooter({
      text: "Only trusted staff should configure welcome settings.",
    });

  return message.reply({ embeds: [embed] });
}

// ─────────────────────────────────────────────
// Message commands
// ─────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

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

  const input = message.content.slice(PREFIX.length).trim();
  if (!input) return;

  const [rawCommand, ...args] = input.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const rest = input.slice(rawCommand.length).trim();

  try {
    if (command === "help") return sendHelp(message);

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
        allowedMentions: {
          users: [message.author.id],
        },
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

      return message.channel.send({
        files: [attachment],
      });
    }
  } catch (error) {
    console.error(`Command "${command}" failed:`, error);

    return message
      .reply("Something went wrong. Check the terminal for the error.")
      .catch(() => {});
  }
});

// ─────────────────────────────────────────────
// Keep-alive HTTP server
// ─────────────────────────────────────────────

const server = http.createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain",
  });

  res.end("Ysabelle is online.");
});

server.listen(PORT, () => {
  console.log(`Keep-alive server listening on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("Keep-alive server error:", error);
});

// ─────────────────────────────────────────────
// Ready and login
// ─────────────────────────────────────────────

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setStatus("dnd");
  console.log(`Logged in as ${readyClient.user.tag}`);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in your .env file.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
