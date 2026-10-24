const {
  Events,
  REST,
  Routes,
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
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

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

  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (
    !data ||
    !Array.isArray(data.confessions) ||
    !Number.isSafeInteger(data.nextId) ||
    data.nextId < 1
  ) {
    throw new Error("Invalid confession data structure.");
  }

  return data;
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

async function registerSlashCommands(client) {
  if (!CLIENT_ID || !GUILD_ID || !process.env.DISCORD_TOKEN) {
    console.error(
      "[Confessions] Slash commands were not registered. Check CLIENT_ID, GUILD_ID, and DISCORD_TOKEN in .env.",
    );
    return;
  }

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    const route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);

    const existingCommands = await rest.get(route);
    const confessionCommands = commands.map((command) => command.toJSON());

    const mergedCommands = [
      ...existingCommands.filter(
        (existing) =>
          !confessionCommands.some((command) => command.name === existing.name),
      ),
      ...confessionCommands,
    ];

    await rest.put(route, { body: mergedCommands });

    console.log("[Confessions] Slash commands registered.");
  } catch (error) {
    console.error("[Confessions] Slash-command registration failed:", error);
  }
}

async function getConfessionChannel(client, guildId) {
  if (!CONFESSION_CHANNEL_ID) {
    throw new Error("CONFESSION_CHANNEL_ID is missing from .env.");
  }

  const channel = await client.channels
    .fetch(CONFESSION_CHANNEL_ID)
    .catch(() => null);

  if (
    !channel ||
    !channel.isTextBased() ||
    !channel.guild ||
    channel.guild.id !== guildId
  ) {
    throw new Error(
      "The configured confession channel is unavailable or belongs to another server.",
    );
  }

  return channel;
}
async function postConfessionInvitation(client) {
  try {
    const channel = await getConfessionChannel(client, GUILD_ID);

    const messages = await channel.messages.fetch({ limit: 50 });

    const existing = messages.find(
      (message) =>
        message.author.id === client.user.id &&
        message.components.some((row) =>
          row.components.some(
            (component) => component.customId === "confessions:open",
          ),
        ),
    );

    if (existing) {
      console.log("[Confessions] Invitation message already exists.");
      return;
    }

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe879b9)
          .setTitle("💌 Got something to confess?")
          .setDescription(
            "Have a secret, crush, confession, or something you want to get off your chest?\n\n" +
              "Click the button below to submit your confession anonymously.\n\n" +
              "You can also use `/confess`.",
          )
          .setFooter({
            text: "Your identity stays hidden from other members.",
          }),
      ],
      components: [confessionInviteButton()],
      allowedMentions: { parse: [] },
    });

    console.log("[Confessions] Invitation message posted.");
  } catch (error) {
    console.error("[Confessions] Could not post invitation:", error);
  }
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
  await interaction.showModal(confessionModal());
}

async function handleConfessionSubmit(interaction) {
  await interaction.deferReply({ flags: 64 });

  const content = interaction.fields.getTextInputValue("content").trim();

  if (content.length < 3 || content.length > MAX_CONFESSION_LENGTH) {
    return interaction.editReply("Your confession has an invalid length.");
  }

  let channel;
  let data;

  try {
    channel = await getConfessionChannel(
      interaction.client,
      interaction.guildId,
    );
    data = loadData();
  } catch (error) {
    console.error("[Confessions] Setup or data error:", error.message);

    return interaction.editReply(
      "The confession system is temporarily unavailable. Please contact an administrator.",
    );
  }

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

  data.confessions.push(record);
  data.nextId += 1;

  try {
    saveData(data);
  } catch (error) {
    console.error("[Confessions] Could not save record:", error);

    return interaction.editReply(
      "Ysabelle couldn't save your confession. Nothing was published.",
    );
  }

  try {
    const publicMessage = await channel.send({
      embeds: [buildConfessionEmbed(id, content)],
      components: [replyButton(id)],
      allowedMentions: { parse: [] },
    });

    record.messageId = publicMessage.id;
    saveData(data);

    await interaction.editReply(
      `Your confession #${formatId(id)} has been posted anonymously.`,
    );
  } catch (error) {
    console.error("[Confessions] Submission error:", error);

    await interaction.editReply(
      "Ysabelle couldn't finish publishing your confession. Please contact an administrator if the record was created.",
    );
  }
}

async function handleReplyButton(interaction, id) {
  const data = loadData();
  const record = findConfession(data, id);

  if (
    !record ||
    record.guildId !== interaction.guildId ||
    record.channelId !== interaction.channelId
  ) {
    return interaction.reply({
      content: "That confession could not be found in this channel.",
      ephemeral: 64,
    });
  }

  await interaction.showModal(replyModal(record.id));
}
function confessionInviteButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("confessions:open")
      .setLabel("Make a confession")
      .setEmoji("💌")
      .setStyle(ButtonStyle.Primary),
  );
}

async function handleReplySubmit(interaction, id) {
  await interaction.deferReply({ ephemeral: true });

  const content = interaction.fields.getTextInputValue("content").trim();

  if (!content || content.length > MAX_REPLY_LENGTH) {
    return interaction.editReply("Your reply has an invalid length.");
  }

  let data;

  try {
    data = loadData();
  } catch (error) {
    console.error("[Confessions] Could not load reply data:", error);

    return interaction.editReply(
      "The confession system is temporarily unavailable.",
    );
  }

  const record = findConfession(data, id);

  if (!record || record.guildId !== interaction.guildId) {
    return interaction.editReply("That confession could not be found.");
  }

  let channel;

  try {
    channel = await getConfessionChannel(
      interaction.client,
      interaction.guildId,
    );
  } catch {
    return interaction.editReply(
      "The confession channel is no longer available.",
    );
  }

  if (channel.id !== record.channelId) {
    return interaction.editReply("The confession channel does not match.");
  }

  try {
    const publicReply = await channel.send({
      embeds: [buildReplyEmbed(record.id, content)],
      allowedMentions: { parse: [] },
      messageReference: record.messageId || undefined,
      failIfNotExists: false,
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
      "Ysabelle couldn't publish or save your reply. Please contact an administrator if a public reply appeared.",
    );
  }
}

async function handleConfessionInfo(interaction) {
  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    return interaction.reply({
      content: "Only server administrators can use this command.",
      flags: 64,
    });
  }

  await interaction.deferReply({ flags: 64 });

  let data;

  try {
    data = loadData();
  } catch (error) {
    console.error("[Confessions] Identity lookup failed:", error);
    return interaction.editReply("The confession records could not be loaded.");
  }

  const id = interaction.options.getString("id", true);
  const record = findConfession(data, id);

  if (!record || record.guildId !== interaction.guildId) {
    return interaction.editReply("No confession with that ID was found.");
  }

  async function getUsername(userId) {
    try {
      const user = await interaction.client.users.fetch(userId);
      return `${user.username} (\`${user.id}\`)`;
    } catch {
      return `Unknown user (\`${userId}\`)`;
    }
  }

  const submitter = await getUsername(record.authorId);

  const lines = [
    `**Confession:** #${formatId(record.id)}`,
    `**Submitter:** ${submitter}`,
    `**Submitted:** <t:${Math.floor(new Date(record.createdAt).getTime() / 1000)}:F>`,
    `**Replies:** ${record.replies.length}`,
  ];

  if (record.replies.length) {
    lines.push("", "**Reply identities:**");

    for (const [index, reply] of record.replies.entries()) {
      const username = await getUsername(reply.authorId);

      lines.push(
        `${index + 1}. ${username} — <t:${Math.floor(new Date(reply.createdAt).getTime() / 1000)}:F>`,
      );
    }
  }

  return interaction.editReply({
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

    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === "confessions:open") {
      return interaction.showModal(confessionModal());
    }

    const match = interaction.customId.match(/^confessions:reply:(\d+)$/);

    if (match) {
      return handleReplyButton(interaction, Number(match[1]));
    }

    return;
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
        flags: 64,
      };

      if (interaction.deferred) {
        await interaction.editReply(response).catch(() => {});
      } else if (interaction.isRepliable() && !interaction.replied) {
        await interaction.reply(response).catch(() => {});
      }
    }
  });

  client.once(Events.ClientReady, async () => {
    await registerSlashCommands(client);
    await postConfessionInvitation(client);
  });

  console.log("[Confessions] Handler registered.");
}

module.exports = {
  commands,
  registerConfessions,
};
