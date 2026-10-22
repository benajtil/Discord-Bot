const {
  Events,
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "../../data");
const DATA_FILE = path.join(DATA_DIR, "confessions.json");
const CONFESSION_CHANNEL_ID = process.env.CONFESSION_CHANNEL_ID;

const MAX_CONFESSION_LENGTH = 1500;
const MAX_REPLY_LENGTH = 1000;
const MAX_RECORDS = 5000;

const commands = [
  new SlashCommandBuilder()
    .setName("confess")
    .setDescription("Submit an anonymous confession"),

  new SlashCommandBuilder()
    .setName("confession-info")
    .setDescription("Privately look up a confession's identity")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("The confession number, such as 001")
        .setRequired(true),
    ),
];

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ nextId: 1, confessions: [] }, null, 2),
      "utf8",
    );
  }
}

function loadData() {
  ensureDataFile();

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (
      !parsed ||
      !Array.isArray(parsed.confessions) ||
      !Number.isInteger(parsed.nextId)
    ) {
      throw new Error("Invalid confession data structure");
    }

    return parsed;
  } catch (error) {
    console.error("[Confessions] Failed to load data:", error.message);
    throw error;
  }
}

function saveData(data) {
  ensureDataFile();

  const temporaryFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporaryFile, DATA_FILE);
}

function formatId(id) {
  return String(id).padStart(3, "0");
}

function findConfession(data, id) {
  const numericId = Number(id);

  if (!Number.isSafeInteger(numericId) || numericId < 1) {
    return null;
  }

  return data.confessions.find((item) => item.id === numericId) || null;
}

async function hasRoleAboveBot(interaction) {
  if (!interaction.guild) return false;

  const botMember =
    interaction.guild.members.me ||
    (await interaction.guild.members.fetchMe().catch(() => null));

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!botMember || !member) return false;

  return member.roles.highest.position > botMember.roles.highest.position;
}

async function rejectIfRoleTooLow(interaction) {
  const allowed = await hasRoleAboveBot(interaction);

  if (allowed) return false;

  const response = {
    content:
      "You need a role positioned above Ysabelle's highest role to use Anonymous Confessions.",
    ephemeral: true,
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(response).catch(() => {});
  } else {
    await interaction.reply(response).catch(() => {});
  }

  return true;
}

async function getConfessionChannel(client) {
  if (!CONFESSION_CHANNEL_ID) {
    throw new Error("CONFESSION_CHANNEL_ID is missing from .env");
  }

  const channel = await client.channels
    .fetch(CONFESSION_CHANNEL_ID)
    .catch(() => null);

  if (!channel || !channel.isTextBased() || !channel.guild) {
    throw new Error("The configured confession channel is unavailable");
  }

  return channel;
}

function buildConfessionEmbed(id, content) {
  return new EmbedBuilder()
    .setColor(0xe879b9)
    .setTitle(`💌 Anonymous Confession #${formatId(id)}`)
    .setDescription(content)
    .setFooter({
      text: "Submitted anonymously • Be kind to one another",
    })
    .setTimestamp();
}

function buildReplyEmbed(confessionId, content) {
  return new EmbedBuilder()
    .setColor(0xb49ae8)
    .setTitle(`💬 Anonymous Reply to #${formatId(confessionId)}`)
    .setDescription(content)
    .setFooter({
      text: `Reply to confession #${formatId(confessionId)}`,
    })
    .setTimestamp();
}

function replyButton(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confessions:reply:${id}`)
      .setLabel("Reply anonymously")
      .setEmoji("💬")
      .setStyle(ButtonStyle.Secondary),
  );
}

function confessionModal() {
  const modal = new ModalBuilder()
    .setCustomId("confessions:submit")
    .setTitle("Anonymous Confession");

  const input = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("What would you like to confess?")
    .setPlaceholder("Write your confession here...")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(3)
    .setMaxLength(MAX_CONFESSION_LENGTH)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return modal;
}

function replyModal(id) {
  const modal = new ModalBuilder()
    .setCustomId(`confessions:reply-submit:${id}`)
    .setTitle(`Reply to Confession #${formatId(id)}`);

  const input = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("Your anonymous reply")
    .setPlaceholder("Write your reply here...")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(MAX_REPLY_LENGTH)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  return modal;
}

async function handleConfessCommand(interaction) {
  if (await rejectIfRoleTooLow(interaction)) return;

  await interaction.showModal(confessionModal());
}

async function handleConfessionSubmit(interaction) {
  if (await rejectIfRoleTooLow(interaction)) return;

  await interaction.deferReply({ ephemeral: true });

  const content = interaction.fields.getTextInputValue("content").trim();

  if (content.length < 3 || content.length > MAX_CONFESSION_LENGTH) {
    return interaction.editReply("Your confession has an invalid length.");
  }

  let channel;

  try {
    channel = await getConfessionChannel(interaction.client);
  } catch (error) {
    console.error("[Confessions] Channel error:", error.message);
    return interaction.editReply(
      "The confession channel is not configured correctly. Please contact an administrator.",
    );
  }

  const data = loadData();

  if (data.confessions.length >= MAX_RECORDS) {
    return interaction.editReply(
      "The confession record limit has been reached. Please contact an administrator.",
    );
  }

  const id = data.nextId;
  const record = {
    id,
    guildId: interaction.guildId,
    channelId: channel.id,
    messageId: null,
    authorId: interaction.user.id,
    content,
    createdAt: new Date().toISOString(),
    replies: [],
  };

  const embed = buildConfessionEmbed(id, content);

  try {
    const publicMessage = await channel.send({
      embeds: [embed],
      components: [replyButton(id)],
      allowedMentions: { parse: [] },
    });

    record.messageId = publicMessage.id;
    data.confessions.push(record);
    data.nextId += 1;
    saveData(data);

    await interaction.editReply(
      `Your confession #${formatId(id)} has been posted anonymously.`,
    );
  } catch (error) {
    console.error("[Confessions] Submission error:", error);

    return interaction.editReply(
      "Ysabelle couldn't finish publishing your confession. Please try again later.",
    );
  }
}

async function handleReplyButton(interaction, id) {
  if (await rejectIfRoleTooLow(interaction)) return;

  const data = loadData();
  const record = findConfession(data, id);

  if (!record || record.guildId !== interaction.guildId) {
    return interaction.reply({
      content: "That confession could not be found.",
      ephemeral: true,
    });
  }

  await interaction.showModal(replyModal(record.id));
}

async function handleReplySubmit(interaction, id) {
  if (await rejectIfRoleTooLow(interaction)) return;

  await interaction.deferReply({ ephemeral: true });

  const content = interaction.fields.getTextInputValue("content").trim();

  if (!content || content.length > MAX_REPLY_LENGTH) {
    return interaction.editReply("Your reply has an invalid length.");
  }

  const data = loadData();
  const record = findConfession(data, id);

  if (!record || record.guildId !== interaction.guildId) {
    return interaction.editReply("That confession could not be found.");
  }

  let channel;

  try {
    channel = await interaction.client.channels.fetch(record.channelId);
  } catch {
    channel = null;
  }

  if (!channel || !channel.isTextBased()) {
    return interaction.editReply(
      "The confession channel is no longer available.",
    );
  }

  try {
    const publicReply = await channel.send({
      embeds: [buildReplyEmbed(record.id, content)],
      allowedMentions: { parse: [] },
      reply: record.messageId
        ? { messageReference: record.messageId, failIfNotExists: false }
        : undefined,
    });

    record.replies.push({
      messageId: publicReply.id,
      authorId: interaction.user.id,
      content,
      createdAt: new Date().toISOString(),
    });

    saveData(data);

    await interaction.editReply(
      `Your anonymous reply to confession #${formatId(record.id)} has been posted.`,
    );
  } catch (error) {
    console.error("[Confessions] Reply error:", error);

    await interaction.editReply(
      "Ysabelle couldn't publish your reply. Please try again later.",
    );
  }
}

async function handleConfessionInfo(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Only server administrators can use this command.",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const id = interaction.options.getString("id", true);
  const data = loadData();
  const record = findConfession(data, id);

  if (!record || record.guildId !== interaction.guildId) {
    return interaction.editReply("No confession with that ID was found.");
  }

  const lines = [
    `**Confession:** #${formatId(record.id)}`,
    `**Submitter ID:** \`${record.authorId}\``,
    `**Submitted:** <t:${Math.floor(new Date(record.createdAt).getTime() / 1000)}:F>`,
    `**Replies:** ${record.replies.length}`,
  ];

  if (record.replies.length) {
    lines.push(
      "",
      "**Reply identities:**",
      ...record.replies.map(
        (reply, index) =>
          `${index + 1}. User ID: \`${reply.authorId}\` — <t:${Math.floor(new Date(reply.createdAt).getTime() / 1000)}:F>`,
      ),
    );
  }

  await interaction.editReply({
    content: lines.join("\n"),
    allowedMentions: { parse: [] },
  });
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "confess") {
      return handleConfessCommand(interaction);
    }

    if (interaction.commandName === "confession-info") {
      return handleConfessionInfo(interaction);
    }
  }

  if (interaction.isButton()) {
    const match = interaction.customId.match(/^confessions:reply:(\d+)$/);

    if (match) {
      return handleReplyButton(interaction, Number(match[1]));
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === "confessions:submit") {
      return handleConfessionSubmit(interaction);
    }

    const match = interaction.customId.match(
      /^confessions:reply-submit:(\d+)$/,
    );

    if (match) {
      return handleReplySubmit(interaction, Number(match[1]));
    }
  }
}

function registerConfessions(client) {
  ensureDataFile();

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction);
    } catch (error) {
      console.error("[Confessions] Interaction error:", error);

      const response = {
        content: "Something went wrong while processing that interaction.",
        ephemeral: true,
      };

      if (interaction.deferred) {
        await interaction.editReply(response).catch(() => {});
      } else if (interaction.isRepliable() && !interaction.replied) {
        await interaction.reply(response).catch(() => {});
      }
    }
  });

  console.log("[Confessions] Handler registered.");
}

module.exports = {
  commands,
  registerConfessions,
};
