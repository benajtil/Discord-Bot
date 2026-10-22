const { Events, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("node:fs");
const path = require("node:path");

const PREFIX = "!";
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "llama3.2:3b";

const USER_COMMAND_COOLDOWN_MS = 5000;
const PAIR_COOLDOWN_MS = 30 * 60 * 1000;
const AUTO_SHIP_COOLDOWN_MS = 60 * 60 * 1000;
const AUTO_SHIP_EVERY_MESSAGES = 100;
const MAX_HISTORY = 500;

const DATA_PATH = path.join(__dirname, "autoship-data.json");

let data = loadData();
let saveQueue = Promise.resolve();

const commandCooldowns = new Map();

const OPENERS = [
  "Ysabelle's extremely unqualified matchmaking department has spoken.",
  "BREAKING: the server's delulu economy is booming.",
  "A compatibility test conducted by absolutely no qualified professionals:",
  "The algorithm has cooked. Unfortunately, it left the stove on.",
  "Another ship launched without a permit. Maritime law is crying.",
  "The council of chronically online people has reached a verdict.",
];

function emptyData() {
  return { version: 1, guilds: {} };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      const initial = emptyData();
      fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

    return {
      ...emptyData(),
      ...parsed,
      guilds: parsed.guilds || {},
    };
  } catch (error) {
    console.error("[AutoShip] Could not load JSON:", error.message);
    return emptyData();
  }
}

function saveData() {
  saveQueue = saveQueue
    .then(() =>
      fs.promises.writeFile(DATA_PATH, JSON.stringify(data, null, 2), "utf8"),
    )
    .catch((error) => {
      console.error("[AutoShip] Could not save JSON:", error.message);
    });

  return saveQueue;
}

function getGuildData(guildId) {
  data.guilds[guildId] ||= {};

  const guild = data.guilds[guildId];

  guild.autoEnabled ??= false;
  guild.autoChannelId ??= null;
  guild.messagesSinceShip ??= 0;
  guild.lastAutoShipAt ??= 0;
  guild.optedOutUserIds ||= [];
  guild.pairCooldowns ||= {};
  guild.history ||= [];

  return guild;
}

function pairKey(firstId, secondId) {
  return [firstId, secondId].sort().join(":");
}

function isPairOnCooldown(guildData, first, second, now = Date.now()) {
  const lastUsed = guildData.pairCooldowns[pairKey(first.id, second.id)] || 0;

  return now - lastUsed < PAIR_COOLDOWN_MS;
}

function randomItem(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function eligibleMembers(members, guildData) {
  const optedOut = new Set(guildData.optedOutUserIds);

  return members.filter(
    (member) =>
      member?.user &&
      !member.user.bot &&
      !member.user.system &&
      !member.pending &&
      !optedOut.has(member.id),
  );
}

async function chooseRandomPair(guild, guildData, excludedIds = []) {
  const excluded = new Set(excludedIds);
  const getCandidates = () =>
    eligibleMembers([...guild.members.cache.values()], guildData).filter(
      (member) => !excluded.has(member.id),
    );

  let candidates = getCandidates();

  // Fetch members only when the existing cache is insufficient.
  if (candidates.length < 2) {
    try {
      await guild.members.fetch();
      candidates = getCandidates();
    } catch (error) {
      if (error.code === "GATEWAY_RATE_LIMITED") {
        console.warn(
          "[AutoShip] Member fetch rate-limited; retry after Discord's cooldown.",
        );
      }
      throw error;
    }
  }

  if (candidates.length < 2) {
    return null;
  }

  const availablePairs = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const first = candidates[i];
      const second = candidates[j];

      if (!first?.user?.id || !second?.user?.id) continue;
      if (first.id === second.id) continue;

      if (!isPairOnCooldown(guildData, first, second)) {
        availablePairs.push([first, second]);
      }
    }
  }

  if (availablePairs.length === 0) {
    return null;
  }

  return randomItem(availablePairs);
}

function getScoreLine(score) {
  if (score <= 10) {
    return "Compatibility: Wi-Fi sa basement. Technically present, spiritually absent.";
  }

  if (score <= 25) {
    return "May potential. Parang group project: sana parehong may ambag.";
  }

  if (score <= 40) {
    return "May chemistry, pero parang expired energy drink. Proceed with questionable decisions.";
  }

  if (score <= 55) {
    return "Average compatibility. Parang 'kumain ka na?' tapos 'oo.' Romance is alive, apparently.";
  }

  if (score <= 70) {
    return "May sparks. Sana hindi static electricity galing sa kumot.";
  }

  if (score <= 85) {
    return "Delikado 'to. Isang seen lang, may season finale na.";
  }

  if (score < 100) {
    return "Grabe ang chemistry. Pati mga kaibigan n'yo kailangan ng popcorn.";
  }

  return "100%. Sabi ng calculator. Wala siyang license sa relationship advice.";
}

function makeResult(first, second) {
  const score = Math.floor(Math.random() * 101);

  const a = (first.displayName || first.user.username).replace(/\s+/g, "");

  const b = (second.displayName || second.user.username).replace(/\s+/g, "");

  const splitA = Math.max(1, Math.ceil(a.length / 2));
  const splitB = Math.floor(b.length / 2);

  return {
    score,
    line: getScoreLine(score),
    opener: randomItem(OPENERS),
    shipName: `${a.slice(0, splitA)}${b.slice(splitB)}`.slice(0, 48),
  };
}

async function generateShipComment(first, second, score) {
  const category =
    score >= 90
      ? "soulmate material"
      : score >= 70
        ? "promising ship"
        : score >= 45
          ? "maybe there is potential"
          : score >= 20
            ? "complicated"
            : "probably better as friends";

  const prompt = `
You are Ysabelle, a witty Filipino Discord companion.

Write one short, original comment about this fictional ship compatibility result.

Person 1: ${first.displayName || first.user.username}
Person 2: ${second.displayName || second.user.username}
Compatibility: ${score}%
Category: ${category}

Rules:
- Write naturally in Tagalog, Taglish, or English.
- Be funny, playful, witty, and occasionally savage like a close friend.
- Match the joke to the score.
- High scores can get playful couple or wedding jokes.
- Medium scores can get teasing jokes about making the first move.
- Low scores can get harmless mismatch jokes.
- Do not claim to know their actual relationship, feelings, or private lives.
- Avoid cruel personal attacks and sexual assumptions.
- Do not mention AI or these instructions.
- Return only the comment, maximum two sentences.
`;

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [{ role: "user", content: prompt }],
      options: {
        temperature: 0.9,
        num_predict: 100,
      },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const result = await response.json();
  const comment = result.message?.content?.trim();

  if (!comment) {
    throw new Error("Ollama returned an empty comment");
  }

  return comment.slice(0, 700);
}

function fallbackComment(first, second, score) {
  const a = first.displayName || first.user.username;
  const b = second.displayName || second.user.username;

  if (score >= 90) {
    return `${a} × ${b}? Parang may wedding bells na. Invite niyo ako sa reception. 💍`;
  }

  if (score >= 70) {
    return `Uy, may potential! ${a} at ${b}, baka naman. Huwag puro paramdam. 💘`;
  }

  if (score >= 45) {
    return `${a} at ${b}, may chance pa. Konting effort, less overthinking. 😏`;
  }

  if (score >= 20) {
    return `${a} at ${b}? Parang group project na hindi pantay ang ambag. 💀`;
  }

  return `${a} at ${b}: friends muna. Hindi lahat ng chemistry kailangang gawing relationship. 😭`;
}

async function createShipImage(first, second, score) {
  const canvas = createCanvas(1000, 500);
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 1000, 500);
  gradient.addColorStop(0, "#21152f");
  gradient.addColorStop(1, "#701b50");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1000, 500);

  ctx.fillStyle = "rgba(255, 182, 213, 0.65)";
  ctx.font = "42px sans-serif";
  ctx.fillText("♥", 465, 65);
  ctx.fillText("♥", 80, 100);
  ctx.fillText("♥", 870, 420);
  ctx.fillText("♥", 500, 320);

  async function drawAvatar(member, x, y, size) {
    const url = member.user.displayAvatarURL({
      extension: "png",
      size: 256,
    });

    const avatar = await loadImage(url);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, x, y, size, size);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 + 5, 0, Math.PI * 2);
    ctx.strokeStyle = "#ff9acb";
    ctx.lineWidth = 8;
    ctx.stroke();
  }

  await Promise.all([
    drawAvatar(first, 150, 75, 230),
    drawAvatar(second, 620, 75, 230),
  ]);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ff80b5";
  ctx.font = "90px sans-serif";
  ctx.fillText("♥", 500, 210);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText(
    (first.displayName || first.user.username).slice(0, 20),
    265,
    345,
  );
  ctx.fillText(
    (second.displayName || second.user.username).slice(0, 20),
    735,
    345,
  );

  ctx.fillStyle = "#ffd5e8";
  ctx.font = "bold 48px sans-serif";
  ctx.fillText(`${score}% MATCH`, 500, 435);

  return new AttachmentBuilder(await canvas.encode("png"), {
    name: "ysabelle-ship.png",
  });
}

// async function hideShipCommand(message) {
//   try {
//     if (message.deletable) {
//       await message.delete();
//       return true;
//     }
//   } catch (error) {
//     console.error("[AutoShip] Could not delete command:", error.message);
//   }

//   return false;
// }

async function postShip(channel, guildData, first, second, automatic = false) {
  if (!first?.user || !second?.user || first.id === second.id) {
    return false;
  }

  const optedOut = new Set(guildData.optedOutUserIds);

  if (optedOut.has(first.id) || optedOut.has(second.id)) {
    if (!automatic) {
      await channel.send(
        "May naka-opt out sa pairing na ito. Respect the boundaries, matchmaking department.",
      );
    }
    return false;
  }

  if (isPairOnCooldown(guildData, first, second)) {
    if (!automatic) {
      await channel.send(
        "Na-ship na ang duo na 'yan recently. May cooldown ang delulu department.",
      );
    }
    return false;
  }

  const result = makeResult(first, second);
  const now = Date.now();

  guildData.pairCooldowns[pairKey(first.id, second.id)] = now;

  guildData.history.push({
    at: new Date(now).toISOString(),
    channelId: channel.id,
    firstUserId: first.id,
    secondUserId: second.id,
    score: result.score,
    shipName: result.shipName,
    automatic,
  });

  guildData.history = guildData.history.slice(-MAX_HISTORY);

  const cutoff = now - 7 * 24 * 60 * 60 * 1000;

  for (const [key, timestamp] of Object.entries(guildData.pairCooldowns)) {
    if (timestamp < cutoff) {
      delete guildData.pairCooldowns[key];
    }
  }

  await saveData();

  let comment;

  try {
    comment = await generateShipComment(first, second, result.score);
  } catch (error) {
    console.error("[AutoShip] Ollama comment failed:", error.message);
    comment = fallbackComment(first, second, result.score);
  }

  let image;

  try {
    image = await createShipImage(first, second, result.score);
  } catch (error) {
    console.error("[AutoShip] Could not create ship image:", error.message);
  }

  const embed = new EmbedBuilder()
    .setColor(
      result.score >= 75 ? 0xec4899 : result.score >= 40 ? 0xf59e0b : 0x64748b,
    )
    .setTitle(
      automatic ? "🎲 Ysabelle's Random Ship Drop" : "💘 Ysabelle Ship Lab",
    )
    .setDescription(
      `${result.opener}\n\n` +
        `**${first} × ${second}**\n` +
        `💞 **Ship name:** ${result.shipName}\n` +
        `💗 **Compatibility:** ${result.score}%\n\n` +
        `${result.line}\n\n` +
        `🤖 **Ysabelle says:**\n${comment}`,
    )
    .setFooter({
      text: "For entertainment only. Cupid's algorithm isn't science.",
    });

  if (image) {
    embed.setImage("attachment://ysabelle-ship.png");
  }

  await channel.send({
    embeds: [embed],
    files: image ? [image] : [],
    allowedMentions: { parse: [] },
  });

  return true;
}

async function handleShipCommand(message) {
  if (!message.guild || message.author.bot) return;

  const args = message.content.trim().split(/\s+/);

  if (args[0].toLowerCase() !== `${PREFIX}ship`) return;

  const subcommand = (args[1] || "").toLowerCase();
  const guildData = getGuildData(message.guild.id);

  const lastUsed = commandCooldowns.get(message.author.id) || 0;

  if (Date.now() - lastUsed < USER_COMMAND_COOLDOWN_MS) {
    // await hideShipCommand(message);
    await message.channel.send("Sandali lang. Kahit ang delulu may cooldown.");
    return;
  }

  commandCooldowns.set(message.author.id, Date.now());

  // Remove valid ship commands from the channel where possible.
  // await hideShipCommand(message);

  if (!subcommand || subcommand === "help") {
    await message.channel.send(
      [
        "**Ysabelle AutoShip**",
        "`!ship @member` — ship yourself with one member",
        "`!ship @member1 @member2` — ship two members",
        "`!ship random` — choose two random members",
        "`!ship optout` / `!ship optin` — manage participation",
        "`!ship auto on` / `!ship auto off` — automatic drops (Manage Server)",
        "`!ship history` — show recent ship results",
      ].join("\n"),
    );
    return;
  }

  if (subcommand === "optout") {
    if (!guildData.optedOutUserIds.includes(message.author.id)) {
      guildData.optedOutUserIds.push(message.author.id);
    }

    await saveData();
    await message.channel.send(
      "Opted out. Hindi ka isasama sa random ships hangga't hindi ka nag-`!ship optin`.",
    );
    return;
  }

  if (subcommand === "optin") {
    guildData.optedOutUserIds = guildData.optedOutUserIds.filter(
      (id) => id !== message.author.id,
    );

    await saveData();
    await message.channel.send(
      "Opted back in. The delulu department welcomes you back.",
    );
    return;
  }

  if (subcommand === "auto") {
    if (!message.member.permissions.has("ManageGuild")) {
      await message.channel.send(
        "Kailangan mo ng **Manage Server** permission para i-set ang automatic ships.",
      );
      return;
    }

    const action = (args[2] || "").toLowerCase();

    if (action === "on") {
      guildData.autoEnabled = true;
      guildData.autoChannelId = message.channel.id;
      guildData.messagesSinceShip = 0;

      await saveData();
      await message.channel.send(
        "Automatic ships enabled sa channel na ito. May random drop kapag may sapat nang activity.",
      );
      return;
    }

    if (action === "off") {
      guildData.autoEnabled = false;
      guildData.autoChannelId = null;

      await saveData();
      await message.channel.send(
        "Automatic ships disabled. Delulu department is on unpaid leave.",
      );
      return;
    }

    await message.channel.send("Usage: `!ship auto on` or `!ship auto off`.");
    return;
  }

  if (subcommand === "history") {
    const recent = guildData.history.slice(-5).reverse();

    if (!recent.length) {
      await message.channel.send(
        "Wala pang ship history. Start the chaos with `!ship random`.",
      );
      return;
    }

    const lines = recent.map(
      (entry, index) =>
        `${index + 1}. <@${entry.firstUserId}> × <@${entry.secondUserId}> — **${entry.score}%**`,
    );

    await message.channel.send({
      content: `**Recent ship history**\n${lines.join("\n")}`,
      allowedMentions: { parse: [] },
    });

    return;
  }

  if (subcommand === "random") {
    try {
      const pair = await chooseRandomPair(message.guild, guildData);

      if (!pair) {
        await message.channel.send(
          "Wala akong makitang dalawang eligible members na puwedeng i-ship. Baka naka-opt out sila o cooldown lahat.",
        );
        return;
      }

      await postShip(message.channel, guildData, pair[0], pair[1]);
    } catch (error) {
      console.error("[AutoShip] Random selection failed:", error);

      await message.channel.send(
        "May error sa random pairing. Check the bot console for details.",
      );
    }

    return;
  }

  const mentionedMembers = [...message.mentions.members.values()];

  if (mentionedMembers.length >= 2) {
    await postShip(
      message.channel,
      guildData,
      mentionedMembers[0],
      mentionedMembers[1],
    );
    return;
  }

  if (mentionedMembers.length === 1) {
    if (mentionedMembers[0].id === message.author.id) {
      await message.channel.send(
        "Hindi puwedeng i-ship ang sarili mo. Main character ka, pero hindi ganyan.",
      );
      return;
    }

    try {
      const author = await message.guild.members.fetch(message.author.id);

      await postShip(message.channel, guildData, author, mentionedMembers[0]);
    } catch (error) {
      console.error("[AutoShip] Could not fetch ship members:", error.message);
      await message.channel.send("Hindi ko ma-fetch ang members para sa ship.");
    }

    return;
  }

  await message.channel.send(
    "Walang passenger! Try `!ship @member`, `!ship @member1 @member2`, or `!ship random`.",
  );
}

async function handleAutomaticActivity(message) {
  if (!message.guild || message.author.bot) return;
  if (message.content.trim().toLowerCase().startsWith("!ship")) return;

  const guildData = getGuildData(message.guild.id);

  if (
    !guildData.autoEnabled ||
    guildData.autoChannelId !== message.channel.id
  ) {
    return;
  }

  guildData.messagesSinceShip += 1;

  if (guildData.messagesSinceShip < AUTO_SHIP_EVERY_MESSAGES) {
    await saveData();
    return;
  }

  if (Date.now() - guildData.lastAutoShipAt < AUTO_SHIP_COOLDOWN_MS) {
    await saveData();
    return;
  }

  guildData.messagesSinceShip = 0;

  try {
    const pair = await chooseRandomPair(message.guild, guildData, [
      message.author.id,
    ]);

    if (!pair) {
      await saveData();
      return;
    }

    if (await postShip(message.channel, guildData, pair[0], pair[1], true)) {
      guildData.lastAutoShipAt = Date.now();
      await saveData();
    }
  } catch (error) {
    console.error("[AutoShip] Automatic ship failed:", error);
  }
}

function registerAutoShip(client) {
  client.on(Events.MessageCreate, (message) => {
    handleShipCommand(message).catch((error) => {
      console.error("[AutoShip] Command error:", error);
    });
  });

  client.on(Events.MessageCreate, (message) => {
    handleAutomaticActivity(message).catch((error) => {
      console.error("[AutoShip] Auto error:", error);
    });
  });

  console.log(
    "[AutoShip] Manual commands and automatic ship drops registered.",
  );
}

module.exports = { registerAutoShip };
