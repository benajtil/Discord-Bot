const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

// Ysabelle API Entertainment System
// Requires Node.js 18+ and a QuickDB instance.

const API = {
  trivia: "https://the-trivia-api.com/v2/questions?limit=10",
  riddle: "https://riddles-api.vercel.app/random",
  chaos: "https://official-joke-api.appspot.com/random_joke",
};

const COLORS = {
  chaos: 0x8e44ad,
  trivia: 0x3498db,
  riddle: 0xe67e22,
  points: 0x2ecc71,
};

const COOLDOWN_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;
const RECENT_LIMIT = 30;
const MAX_API_RETRIES = 4;

const recent = {
  trivia: [],
  riddle: [],
  chaos: [],
};

const triviaPool = [];
const activeChallenges = new Map();
const cooldowns = new Map();

const command = new SlashCommandBuilder()
  .setName("fun")
  .setDescription("Play Ysabelle's API-powered entertainment games.")

  .addSubcommand((sub) =>
    sub.setName("chaos").setDescription("Get a random joke from the internet."),
  )

  .addSubcommand((sub) =>
    sub.setName("trivia").setDescription("Start a random trivia challenge."),
  )

  .addSubcommand((sub) =>
    sub.setName("riddle").setDescription("Get a random riddle."),
  )

  .addSubcommand((sub) =>
    sub
      .setName("answer")
      .setDescription("Answer the active trivia or riddle.")
      .addStringOption((option) =>
        option
          .setName("answer")
          .setDescription("Your answer")
          .setRequired(true)
          .setMaxLength(200),
      ),
  )

  .addSubcommand((sub) =>
    sub.setName("points").setDescription("Check your entertainment points."),
  )

  .addSubcommand((sub) =>
    sub
      .setName("leaderboard")
      .setDescription("See the server's fun points leaderboard."),
  );

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function remember(type, key) {
  const list = recent[type];
  const normalizedKey = normalize(key);

  if (!normalizedKey) return false;
  if (list.includes(normalizedKey)) return false;

  list.push(normalizedKey);

  while (list.length > RECENT_LIMIT) {
    list.shift();
  }

  return true;
}

async function fetchJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "YsabelleDiscordBot/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getChallengeKey(interaction) {
  return `${interaction.guildId}:${interaction.channelId}`;
}

function getCooldownKey(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function checkCooldown(interaction) {
  const key = getCooldownKey(interaction);
  const now = Date.now();
  const lastUsed = cooldowns.get(key) || 0;
  const remaining = COOLDOWN_MS - (now - lastUsed);

  if (remaining > 0) {
    return Math.ceil(remaining / 1000);
  }

  cooldowns.set(key, now);
  return 0;
}

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function getPoints(db, guildId, userId) {
  return (await db.get(`fun_points_${guildId}_${userId}`)) || 0;
}

async function addPoints(db, guildId, userId, amount) {
  const key = `fun_points_${guildId}_${userId}`;
  const current = (await db.get(key)) || 0;
  const updated = current + amount;

  await db.set(key, updated);

  const membersKey = `fun_points_members_${guildId}`;
  const members = (await db.get(membersKey)) || {};

  members[userId] = updated;

  await db.set(membersKey, members);

  return updated;
}

async function rewardDailyOnce(db, guildId, userId, game, amount) {
  const date = todayInManila();
  const claimKey = `fun_reward_${guildId}_${userId}_${game}_${date}`;

  if (await db.get(claimKey)) {
    return {
      awarded: false,
      total: await getPoints(db, guildId, userId),
    };
  }

  // Mark the daily claim, then award points.
  await db.set(claimKey, true);
  const total = await addPoints(db, guildId, userId, amount);

  return {
    awarded: true,
    total,
  };
}

async function getTriviaQuestion() {
  // Use already-fetched questions first to reduce API requests.
  for (let i = 0; i < triviaPool.length; i++) {
    const question = triviaPool.shift();
    const key = question.question?.text;

    if (key && remember("trivia", key)) {
      return question;
    }
  }

  // Fetch a batch if our pool is empty or its questions are stale.
  const questions = await fetchJSON(API.trivia);

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("The trivia API returned no questions.");
  }

  for (const question of questions) {
    if (question?.question?.text && question.correctAnswer) {
      triviaPool.push(question);
    }
  }

  for (let i = 0; i < triviaPool.length; i++) {
    const question = triviaPool.shift();

    if (remember("trivia", question.question.text)) {
      return question;
    }
  }

  // If everything was recently used, accept a new API result
  // rather than leaving the user without a game.
  const fallback = await fetchJSON(API.trivia);

  if (!Array.isArray(fallback) || !fallback[0]) {
    throw new Error("No trivia questions are available.");
  }

  return fallback[0];
}

async function getRiddle() {
  for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
    const data = await fetchJSON(API.riddle);

    if (!data?.riddle || !data?.answer) {
      throw new Error("The riddle API returned invalid data.");
    }

    if (remember("riddle", data.riddle)) {
      return data;
    }
  }

  // A repeated item is preferable to a broken command if the API
  // has a small selection or keeps returning the same item.
  return fetchJSON(API.riddle);
}

async function getJoke() {
  for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
    const data = await fetchJSON(API.chaos);

    if (!data?.setup || !data?.punchline) {
      throw new Error("The joke API returned invalid data.");
    }

    const key = `${data.setup} ${data.punchline}`;

    if (remember("chaos", key)) {
      return data;
    }
  }

  return fetchJSON(API.chaos);
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function makeEmbed(title, description, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: "Ysabelle Entertainment • Powered by APIs",
    })
    .setTimestamp();
}

async function startTrivia(interaction, db) {
  const question = await getTriviaQuestion();
  const questionText = question.question.text;
  const correctAnswer = question.correctAnswer;

  const options = shuffle([
    correctAnswer,
    ...(question.incorrectAnswers || []),
  ]).slice(0, 4);

  const letters = ["A", "B", "C", "D"];
  const choices = options
    .map((option, index) => `**${letters[index]}.** ${option}`)
    .join("\n");

  activeChallenges.set(getChallengeKey(interaction), {
    type: "trivia",
    answer: correctAnswer,
    acceptedAnswers: [normalize(correctAnswer)],
    createdAt: Date.now(),
    createdBy: interaction.user.id,
    solved: false,
    reward: 5,
  });

  const embed = makeEmbed(
    "🧠 Trivia Challenge",
    `**${questionText}**\n\n${choices}\n\n` +
      "Use `/fun answer` to submit your answer.",
    COLORS.trivia,
  );

  if (question.category) {
    embed.addFields({
      name: "Category",
      value: String(question.category).slice(0, 100),
      inline: true,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function startRiddle(interaction) {
  const data = await getRiddle();

  activeChallenges.set(getChallengeKey(interaction), {
    type: "riddle",
    answer: data.answer,
    acceptedAnswers: [normalize(data.answer)],
    createdAt: Date.now(),
    createdBy: interaction.user.id,
    solved: false,
    reward: 8,
  });

  const embed = makeEmbed(
    "🕵️ Riddle Challenge",
    `${data.riddle}\n\n` + "Think carefully and use `/fun answer` to answer.",
    COLORS.riddle,
  );

  await interaction.reply({ embeds: [embed] });
}

async function showChaos(interaction, db) {
  const joke = await getJoke();

  const embed = makeEmbed(
    "🌀 Ysabelle's Chaos",
    `**${joke.setup}**\n\n${joke.punchline}`,
    COLORS.chaos,
  );

  if (joke.type) {
    embed.addFields({
      name: "Joke type",
      value: String(joke.type).slice(0, 100),
      inline: true,
    });
  }

  const reward = await rewardDailyOnce(
    db,
    interaction.guildId,
    interaction.user.id,
    "chaos",
    1,
  );

  embed.addFields({
    name: "Fun points",
    value: reward.awarded
      ? "You earned **1 point** for today's Chaos command!"
      : "You already claimed today's Chaos point.",
    inline: false,
  });

  await interaction.reply({ embeds: [embed] });
}

async function submitAnswer(interaction, db) {
  const key = getChallengeKey(interaction);
  const challenge = activeChallenges.get(key);

  if (!challenge) {
    await interaction.reply({
      content:
        "There is no active trivia or riddle in this channel. " +
        "Start one with `/fun trivia` or `/fun riddle`.",
      ephemeral: true,
    });
    return;
  }

  if (challenge.solved) {
    await interaction.reply({
      content: "This challenge has already been solved.",
      ephemeral: true,
    });
    return;
  }

  const submitted = normalize(interaction.options.getString("answer", true));

  if (!submitted) {
    await interaction.reply({
      content: "Please enter a valid answer.",
      ephemeral: true,
    });
    return;
  }

  const accepted = challenge.acceptedAnswers || [normalize(challenge.answer)];

  const correct = accepted.some((answer) => answer && answer === submitted);

  if (!correct) {
    await interaction.reply({
      content: "❌ Not quite! Try again.",
      ephemeral: true,
    });
    return;
  }

  challenge.solved = true;
  activeChallenges.delete(key);

  const total = await addPoints(
    db,
    interaction.guildId,
    interaction.user.id,
    challenge.reward,
  );

  const embed = makeEmbed(
    "✅ Correct Answer!",
    `<@${interaction.user.id}> solved the ${challenge.type}!\n\n` +
      `**Answer:** ${challenge.answer}\n` +
      `**Points earned:** +${challenge.reward}\n` +
      `**Your total:** ${total} fun points`,
    COLORS.points,
  );

  await interaction.reply({ embeds: [embed] });
}

async function showPoints(interaction, db) {
  const total = await getPoints(db, interaction.guildId, interaction.user.id);

  const embed = makeEmbed(
    "⭐ Your Fun Points",
    `<@${interaction.user.id}> has **${total} fun points**.`,
    COLORS.points,
  );

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

async function showLeaderboard(interaction, db) {
  const membersKey = `fun_points_members_${interaction.guildId}`;
  const members = (await db.get(membersKey)) || {};

  const leaderboard = Object.entries(members)
    .map(([userId, points]) => ({
      userId,
      points: Number(points) || 0,
    }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  if (!leaderboard.length) {
    await interaction.reply({
      content: "The leaderboard is empty. Play a game to earn points!",
      ephemeral: true,
    });
    return;
  }

  const lines = leaderboard.map((entry, index) => {
    const medal = ["🥇", "🥈", "🥉"][index] || `**${index + 1}.**`;

    return `${medal} <@${entry.userId}> — **${entry.points} points**`;
  });

  const embed = makeEmbed(
    "🏆 Fun Points Leaderboard",
    lines.join("\n"),
    COLORS.points,
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleSlashCommand(interaction, db) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Please use this command inside a server.",
      ephemeral: true,
    });
    return;
  }

  const cooldown = checkCooldown(interaction);

  if (cooldown > 0) {
    await interaction.reply({
      content: `Slow down! Try again in ${cooldown} second(s).`,
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      case "chaos":
        await showChaos(interaction, db);
        break;

      case "trivia":
        await startTrivia(interaction, db);
        break;

      case "riddle":
        await startRiddle(interaction);
        break;

      case "answer":
        await submitAnswer(interaction, db);
        break;

      case "points":
        await showPoints(interaction, db);
        break;

      case "leaderboard":
        await showLeaderboard(interaction, db);
        break;

      default:
        await interaction.reply({
          content: "Unknown entertainment command.",
          ephemeral: true,
        });
    }
  } catch (error) {
    console.error("[Ysabelle Entertainment]", error);

    const message =
      "I couldn't reach an entertainment API right now. " +
      "Please try again in a little while.";

    if (interaction.replied || interaction.deferred) {
      await interaction
        .followUp({
          content: message,
          ephemeral: true,
        })
        .catch(() => {});
    } else {
      await interaction
        .reply({
          content: message,
          ephemeral: true,
        })
        .catch(() => {});
    }
  }
}

module.exports = {
  command,
  handleSlashCommand,
};
