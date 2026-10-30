const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const { createTaskDatabase } = require("./db");
const { DEFAULT_TASKS, DEFAULT_ROLE_TIERS } = require("./config/defaults");

function createTaskRoleSystem(client, options = {}) {
  const config = {
    databasePath:
      options.databasePath ||
      process.env.TASKS_DATABASE_PATH ||
      "./data/task-role-system.sqlite",
    reviewChannelId:
      options.reviewChannelId || process.env.TASK_REVIEW_CHANNEL_ID || "",
    logChannelId:
      options.logChannelId || process.env.TASK_ROLE_LOG_CHANNEL_ID || "",
    staffRoleIds: (
      options.staffRoleIds ||
      process.env.TASK_REVIEWER_ROLE_IDS ||
      ""
    )
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    tasks: options.tasks || DEFAULT_TASKS,
    roleTiers: options.roleTiers || DEFAULT_ROLE_TIERS,
    minMessageLength: Number(
      options.minMessageLength || process.env.TASK_MIN_MESSAGE_LENGTH || 8,
    ),
    messageCooldownMs: Number(
      options.messageCooldownMs ||
        process.env.TASK_MESSAGE_COOLDOWN_MS ||
        60000,
    ),
  };

  const db = createTaskDatabase(config.databasePath);
  const lastCountedMessage = new Map();

  const slashCommand = new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("View tasks, contribution points, and role progression")
    .addSubcommand((s) =>
      s.setName("list").setDescription("View available tasks"),
    )
    .addSubcommand((s) =>
      s.setName("progress").setDescription("View your task and role progress"),
    )
    .addSubcommand((s) =>
      s
        .setName("submit")
        .setDescription("Submit proof for a task that needs review")
        .addStringOption((o) =>
          o
            .setName("task_id")
            .setDescription("Task ID shown in /tasks list")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("proof")
            .setDescription("Short explanation or link to proof")
            .setRequired(true)
            .setMaxLength(1000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("review")
        .setDescription("Approve or reject a task submission")
        .addIntegerOption((o) =>
          o
            .setName("submission_id")
            .setDescription("Submission number")
            .setRequired(true)
            .setMinValue(1),
        )
        .addStringOption((o) =>
          o
            .setName("decision")
            .setDescription("Decision")
            .setRequired(true)
            .addChoices(
              { name: "Approve", value: "approve" },
              { name: "Reject", value: "reject" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("note")
            .setDescription("Optional note to the member")
            .setRequired(false)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((s) =>
      s.setName("submissions").setDescription("List pending task submissions"),
    )
    .addSubcommand((s) =>
      s.setName("roles").setDescription("View role progression tiers"),
    )
    .addSubcommand((s) =>
      s
        .setName("stats")
        .setDescription("View a member contribution summary")
        .addUserOption((o) =>
          o
            .setName("member")
            .setDescription("Member to inspect")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("grant-role")
        .setDescription("Admin approval: assign an approval-only role tier")
        .addUserOption((o) =>
          o
            .setName("member")
            .setDescription("Member receiving the role")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("tier")
            .setDescription("Approval-only role tier name")
            .setRequired(true),
        ),
    )
    .setDMPermission(false);

  const setupSlashCommand = new SlashCommandBuilder()
    .setName("tasksetup")
    .setDescription(
      "Configure Ysabelle task-system channels and reviewer roles",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("review-channel")
        .setDescription("Choose the task submission review channel")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel for task submissions")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("log-channel")
        .setDescription("Choose the task and role audit log channel")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel for role and review logs")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("reviewer-role")
        .setDescription("Add or remove a role allowed to review submissions")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Add or remove this reviewer role")
            .setRequired(true)
            .addChoices(
              { name: "Add", value: "add" },
              { name: "Remove", value: "remove" },
            ),
        )
        .addRoleOption((o) =>
          o.setName("role").setDescription("Reviewer role").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("status")
        .setDescription("Show the current task-system configuration"),
    )
    .addSubcommand((s) =>
      s
        .setName("reset")
        .setDescription("Clear one task-system setting")
        .addStringOption((o) =>
          o
            .setName("setting")
            .setDescription("Setting to clear")
            .setRequired(true)
            .addChoices(
              { name: "Review channel", value: "review_channel_id" },
              { name: "Log channel", value: "log_channel_id" },
              { name: "Reviewer roles", value: "reviewer_role_ids" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("task-add")
        .setDescription("Create a task for this server")
        .addStringOption((o) =>
          o
            .setName("task_id")
            .setDescription(
              "Unique ID, lowercase letters, numbers, underscores",
            )
            .setRequired(true)
            .setMaxLength(40),
        )
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Task name")
            .setRequired(true)
            .setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName("description")
            .setDescription("What members need to do")
            .setRequired(true)
            .setMaxLength(500),
        )
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Tracking type")
            .setRequired(true)
            .addChoices(
              { name: "Message count", value: "message_count" },
              { name: "Community contribution", value: "contribution" },
              { name: "Special challenge", value: "challenge" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("verification")
            .setDescription("Automatic or staff approval")
            .setRequired(true)
            .addChoices(
              { name: "Automatic", value: "auto" },
              { name: "Staff review", value: "staff" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("period")
            .setDescription("How often the task resets")
            .setRequired(true)
            .addChoices(
              { name: "Daily", value: "daily" },
              { name: "Weekly", value: "weekly" },
              { name: "Lifetime", value: "lifetime" },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName("points")
            .setDescription("Points awarded on completion")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o
            .setName("target")
            .setDescription(
              "Number of qualifying messages; only for message count",
            )
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("task-edit")
        .setDescription("Edit an existing task")
        .addStringOption((o) =>
          o
            .setName("task_id")
            .setDescription("Task ID to edit")
            .setRequired(true)
            .setMaxLength(40),
        )
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("New task name")
            .setRequired(false)
            .setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName("description")
            .setDescription("New description")
            .setRequired(false)
            .setMaxLength(500),
        )
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Tracking type")
            .setRequired(false)
            .addChoices(
              { name: "Message count", value: "message_count" },
              { name: "Community contribution", value: "contribution" },
              { name: "Special challenge", value: "challenge" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("verification")
            .setDescription("Verification method")
            .setRequired(false)
            .addChoices(
              { name: "Automatic", value: "auto" },
              { name: "Staff review", value: "staff" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("period")
            .setDescription("Reset period")
            .setRequired(false)
            .addChoices(
              { name: "Daily", value: "daily" },
              { name: "Weekly", value: "weekly" },
              { name: "Lifetime", value: "lifetime" },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName("points")
            .setDescription("Points awarded")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o
            .setName("target")
            .setDescription("Message target (message-count tasks only)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(10000),
        )
        .addBooleanOption((o) =>
          o
            .setName("enabled")
            .setDescription("Whether members can see and complete this task")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("task-delete")
        .setDescription("Delete a task from this server")
        .addStringOption((o) =>
          o
            .setName("task_id")
            .setDescription("Task ID to delete")
            .setRequired(true)
            .setMaxLength(40),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("task-list")
        .setDescription("List tasks configured for this server"),
    )
    .addSubcommand((s) =>
      s
        .setName("role-add")
        .setDescription("Add a contribution role tier")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Name of the tier")
            .setRequired(true)
            .setMaxLength(100),
        )
        .addIntegerOption((o) =>
          o
            .setName("points")
            .setDescription("Required contribution points")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(1000000),
        )
        .addStringOption((o) =>
          o
            .setName("role_id")
            .setDescription("Discord role ID")
            .setRequired(true)
            .setMaxLength(25),
        )
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("Automatic assignment or staff approval")
            .setRequired(true)
            .addChoices(
              { name: "Automatic", value: "auto" },
              { name: "Staff approval", value: "approval" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("role-edit")
        .setDescription("Edit an existing contribution role tier")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Current tier name")
            .setRequired(true)
            .setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName("new_name")
            .setDescription("New tier name")
            .setRequired(false)
            .setMaxLength(100),
        )
        .addIntegerOption((o) =>
          o
            .setName("points")
            .setDescription("New required points")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(1000000),
        )
        .addStringOption((o) =>
          o
            .setName("role_id")
            .setDescription("New Discord role ID")
            .setRequired(false)
            .setMaxLength(25),
        )
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("Assignment mode")
            .setRequired(false)
            .addChoices(
              { name: "Automatic", value: "auto" },
              { name: "Staff approval", value: "approval" },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("role-delete")
        .setDescription("Delete a contribution role tier")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("Tier name to delete")
            .setRequired(true)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("role-list")
        .setDescription("List configured contribution role tiers"),
    )
    .setDMPermission(false);

  function getSetting(guildId, key) {
    const saved = db.getSetting(guildId, key);
    if (saved !== null) return saved;
    if (key === "review_channel_id") return config.reviewChannelId;
    if (key === "log_channel_id") return config.logChannelId;
    if (key === "reviewer_role_ids") return config.staffRoleIds.join(",");
    return "";
  }

  function getReviewerRoleIds(guildId) {
    return getSetting(guildId, "reviewer_role_ids")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  function getTasks(guildId) {
    const raw = db.getSetting(guildId, "tasks_json");
    if (!raw) return config.tasks;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : config.tasks;
    } catch {
      return config.tasks;
    }
  }

  function saveTasks(guildId, tasks) {
    db.setSetting(guildId, "tasks_json", JSON.stringify(tasks));
  }
  function getRoleTiers(guildId) {
    const raw = db.getSetting(guildId, "role_tiers_json");

    if (!raw) return config.roleTiers;

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : config.roleTiers;
    } catch {
      return config.roleTiers;
    }
  }

  function saveRoleTiers(guildId, tiers) {
    db.setSetting(guildId, "role_tiers_json", JSON.stringify(tiers));
  }
  function periodKey(period) {
    const now = new Date();
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    if (period === "daily") return date.toISOString().slice(0, 10);
    if (period === "weekly") {
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      return date.toISOString().slice(0, 10);
    }
    return "lifetime";
  }

  function isReviewer(member) {
    if (!member) return false;
    if (
      member.permissions?.has(PermissionFlagsBits.Administrator) ||
      member.permissions?.has(PermissionFlagsBits.ManageGuild)
    )
      return true;
    return getReviewerRoleIds(member.guild.id).some((id) =>
      member.roles?.cache?.has(id),
    );
  }

  async function log(guild, message) {
    if (!guild) return;
    const logChannelId = getSetting(guild.id, "log_channel_id");
    if (!logChannelId) return;
    const channel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (channel?.isTextBased())
      await channel.send({ content: message }).catch(() => {});
  }

  async function giveRole(guild, userId, roleId, reason) {
    if (!roleId) return false;
    const role = await guild.roles.fetch(roleId).catch(() => null);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (
      !role ||
      !member ||
      !guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)
    )
      return false;
    if (role.position >= guild.members.me.roles.highest.position) return false;
    if (member.roles.cache.has(roleId)) return true;
    await member.roles.add(role, reason).catch(() => null);
    return member.roles.cache.has(roleId);
  }

  async function syncAutoRoles(guild, userId) {
    const points = db.getPoints(guild.id, userId);
    for (const tier of getRoleTiers(guild.id)) {
      if (tier.mode !== "auto" || !tier.roleId || points < tier.points)
        continue;
      const assigned = await giveRole(
        guild,
        userId,
        tier.roleId,
        `Reached ${tier.points} contribution points`,
      );
      if (assigned)
        await log(
          guild,
          `🏅 <@${userId}> earned <@&${tier.roleId}> (${points} contribution points).`,
        );
    }
  }

  function taskStatus(guildId, userId, task) {
    const key = periodKey(task.period || "lifetime");
    return db.getCompletion(guildId, userId, task.id, key);
  }

  function listEmbed(guildId, userId) {
    const embed = new EmbedBuilder()
      .setTitle("📋 Ysabelle Task Board")
      .setDescription(
        "Complete tasks to earn contribution points. Some tasks are automatic; others require staff review.",
      )
      .setColor(0x5865f2);
    for (const task of getTasks(guildId).filter((t) => t.enabled !== false)) {
      const completion = taskStatus(guildId, userId, task);
      const progress =
        task.type === "message_count"
          ? Math.min(
              db.getCounter(
                guildId,
                userId,
                task.id,
                periodKey(task.period || "daily"),
              ),
              task.target || 1,
            )
          : null;
      const state =
        completion?.status === "approved"
          ? "✅ Completed"
          : completion?.status === "pending"
            ? "🕒 Pending review"
            : progress !== null
              ? `Progress: ${progress}/${task.target || 1}`
              : "Available";
      embed.addFields({
        name: `${task.name} · ${task.points} pts`,
        value: `ID: \`${task.id}\` · ${task.period || "lifetime"} · ${task.verification === "staff" ? "Staff review" : "Automatic"}\n${task.description}\n**${state}**`,
      });
    }
    embed.setFooter({
      text: "Use /tasks submit for tasks that require proof.",
    });
    return embed;
  }

  function progressEmbed(guildId, userId) {
    const points = db.getPoints(guildId, userId);
    const completed = db.countApproved(guildId, userId);
    const pending = db.countPending(guildId, userId);
    const next = getRoleTiers(guildId)
      .filter((t) => t.mode === "auto")
      .sort((a, b) => a.points - b.points)
      .find((t) => points < t.points);
    const embed = new EmbedBuilder()
      .setTitle("📈 Your Contribution Progress")
      .setColor(0x57f287)
      .addFields(
        { name: "Contribution points", value: String(points), inline: true },
        { name: "Approved tasks", value: String(completed), inline: true },
        { name: "Pending review", value: String(pending), inline: true },
        {
          name: "Next automatic role",
          value: next
            ? `${next.name}: ${Math.max(0, next.points - points)} more points`
            : "You have reached all automatic role tiers!",
          inline: false,
        },
      );
    return embed;
  }

  async function submitTask(interaction, taskId, proof) {
    const task = getTasks(interaction.guildId).find(
      (t) => t.id === taskId && t.enabled !== false,
    );
    if (!task)
      return interaction.reply({
        content:
          "I could not find that task ID. Use `/tasks list` to see available tasks.",
        flags: MessageFlags.Ephemeral,
      });
    if (task.verification !== "staff")
      return interaction.reply({
        content:
          "This task is verified automatically; it does not accept manual submissions.",
        flags: MessageFlags.Ephemeral,
      });
    const key = periodKey(task.period || "lifetime");
    const existing = db.getCompletion(
      interaction.guildId,
      interaction.user.id,
      task.id,
      key,
    );
    if (existing?.status === "approved")
      return interaction.reply({
        content: "You already completed this task for the current period.",
        flags: MessageFlags.Ephemeral,
      });
    if (existing?.status === "pending")
      return interaction.reply({
        content: "Your submission is already waiting for staff review.",
        flags: MessageFlags.Ephemeral,
      });
    const submissionId = db.createSubmission({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      taskId: task.id,
      periodKey: key,
      proof,
    });
    const reviewChannelId = getSetting(
      interaction.guildId,
      "review_channel_id",
    );
    if (reviewChannelId) {
      const channel = await interaction.guild.channels
        .fetch(reviewChannelId)
        .catch(() => null);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`Task Submission #${submissionId}`)
          .setColor(0xfee75c)
          .addFields(
            {
              name: "Member",
              value: `<@${interaction.user.id}> (${interaction.user.id})`,
            },
            { name: "Task", value: `${task.name} (\`${task.id}\`)` },
            { name: "Reward", value: `${task.points} contribution points` },
            { name: "Proof", value: proof.slice(0, 1024) },
          )
          .setFooter({
            text: "Review with /tasks review submission_id:<number> decision:<approve|reject>",
          });
        await channel.send({ embeds: [embed] }).catch(() => {});
      }
    }
    await interaction.reply({
      content: `Submission #${submissionId} sent for staff review. You will receive points only if it is approved.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  async function reviewTask(interaction, submissionId, decision, note) {
    if (!isReviewer(interaction.member))
      return interaction.reply({
        content:
          "You need Administrator/Manage Server permission or a configured reviewer role to review submissions.",
        flags: MessageFlags.Ephemeral,
      });
    const submission = db.getSubmission(submissionId, interaction.guildId);
    if (!submission)
      return interaction.reply({
        content: "Submission not found in this server.",
        flags: MessageFlags.Ephemeral,
      });
    if (submission.status !== "pending")
      return interaction.reply({
        content: `This submission has already been ${submission.status}.`,
        flags: MessageFlags.Ephemeral,
      });
    const task = getTasks(interaction.guildId).find(
      (t) => t.id === submission.task_id,
    );
    if (!task)
      return interaction.reply({
        content: "This task no longer exists in the configured task list.",
        flags: MessageFlags.Ephemeral,
      });
    db.reviewSubmission(
      submissionId,
      interaction.guildId,
      decision === "approve" ? "approved" : "rejected",
      interaction.user.id,
      note || "",
    );
    if (decision === "approve") {
      const awarded = db.awardCompletion({
        guildId: submission.guild_id,
        userId: submission.user_id,
        taskId: task.id,
        periodKey: submission.period_key,
        points: task.points,
        submissionId,
      });
      if (!awarded)
        return interaction.reply({
          content:
            "The submission was reviewed, but this task was already credited for that period.",
          flags: MessageFlags.Ephemeral,
        });
      await syncAutoRoles(interaction.guild, submission.user_id);
      const member = await interaction.guild.members
        .fetch(submission.user_id)
        .catch(() => null);
      if (member)
        await member
          .send(
            `Your task submission **${task.name}** was approved. You earned ${task.points} contribution points.${note ? ` Staff note: ${note}` : ""}`,
          )
          .catch(() => {});
    } else {
      const member = await interaction.guild.members
        .fetch(submission.user_id)
        .catch(() => null);
      if (member)
        await member
          .send(
            `Your task submission **${task.name}** was rejected.${note ? ` Staff note: ${note}` : ""}`,
          )
          .catch(() => {});
    }
    await log(
      interaction.guild,
      `📝 Submission #${submissionId} for **${task.name}** was ${decision} by <@${interaction.user.id}>.`,
    );
    return interaction.reply({
      content: `Submission #${submissionId} ${decision}d. ${note ? `Note: ${note}` : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  async function handleSetupSlashCommand(interaction) {
    if (!interaction.inGuild())
      return interaction.reply({
        content: "Use this command inside a server.",
        flags: MessageFlags.Ephemeral,
      });
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content:
          "Only server administrators or members with Manage Server can change task-system settings.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    // List configured role tiers.
    if (sub === "role-list") {
      const tiers = getRoleTiers(guildId);

      const lines = tiers.map((tier) => {
        const role = tier.roleId
          ? `<@&${tier.roleId}> (\`${tier.roleId}\`)`
          : "Role ID not configured";

        const assignment =
          tier.mode === "approval"
            ? "Staff approval required"
            : "Automatic assignment";

        return (
          `**${tier.name}**\n` +
          `Points: ${tier.points} · ${assignment}\n` +
          `Role: ${role}`
        );
      });

      return interaction.reply({
        content: lines.length
          ? lines.join("\n\n").slice(0, 1900)
          : "No role tiers configured.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Add a role tier.
    if (sub === "role-add") {
      const tiers = getRoleTiers(guildId);

      const name = interaction.options.getString("name", true).trim();
      const points = interaction.options.getInteger("points", true);
      const roleId = interaction.options.getString("role_id", true).trim();
      const mode = interaction.options.getString("mode", true);

      if (!/^\d{17,20}$/.test(roleId)) {
        return interaction.reply({
          content: "That doesn't look like a valid Discord role ID.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const role = await interaction.guild.roles
        .fetch(roleId)
        .catch(() => null);

      if (!role) {
        return interaction.reply({
          content: "I couldn't find that role in this server. Check its ID.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (
        tiers.some((tier) => tier.name.toLowerCase() === name.toLowerCase())
      ) {
        return interaction.reply({
          content: `A tier named **${name}** already exists.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (tiers.some((tier) => tier.roleId === roleId)) {
        return interaction.reply({
          content: "That Discord role is already assigned to another tier.",
          flags: MessageFlags.Ephemeral,
        });
      }

      tiers.push({ name, points, roleId, mode });
      saveRoleTiers(guildId, tiers);

      await log(
        interaction.guild,
        `🆕 <@${interaction.user.id}> added role tier **${name}** with ${points} points and role <@&${roleId}> (${mode}).`,
      );

      return interaction.reply({
        content:
          `Created role tier **${name}**.\n` +
          `Required points: **${points}**\n` +
          `Discord role: <@&${roleId}>\n` +
          `Assignment: **${mode === "approval" ? "Staff approval" : "Automatic"}**`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Edit an existing role tier.
    if (sub === "role-edit") {
      const tiers = getRoleTiers(guildId);
      const currentName = interaction.options.getString("name", true).trim();

      const tier = tiers.find(
        (item) => item.name.toLowerCase() === currentName.toLowerCase(),
      );

      if (!tier) {
        return interaction.reply({
          content: `Couldn't find **${currentName}**. Use \`/tasksetup role-list\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const newName = interaction.options.getString("new_name");
      const points = interaction.options.getInteger("points");
      const roleIdInput = interaction.options.getString("role_id");
      const mode = interaction.options.getString("mode");

      if (
        newName === null &&
        points === null &&
        roleIdInput === null &&
        mode === null
      ) {
        return interaction.reply({
          content: "Provide at least one field to update.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (
        newName &&
        tiers.some(
          (item) =>
            item !== tier &&
            item.name.toLowerCase() === newName.trim().toLowerCase(),
        )
      ) {
        return interaction.reply({
          content: `Another tier named **${newName}** already exists.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (roleIdInput !== null) {
        const roleId = roleIdInput.trim();

        if (!/^\d{17,20}$/.test(roleId)) {
          return interaction.reply({
            content: "That doesn't look like a valid Discord role ID.",
            flags: MessageFlags.Ephemeral,
          });
        }

        const role = await interaction.guild.roles
          .fetch(roleId)
          .catch(() => null);

        if (!role) {
          return interaction.reply({
            content: "I couldn't find that role in this server.",
            flags: MessageFlags.Ephemeral,
          });
        }

        if (tiers.some((item) => item !== tier && item.roleId === roleId)) {
          return interaction.reply({
            content: "That role is already assigned to another tier.",
            flags: MessageFlags.Ephemeral,
          });
        }

        tier.roleId = roleId;
      }

      if (newName !== null && newName.trim()) tier.name = newName.trim();
      if (points !== null) tier.points = points;
      if (mode !== null) tier.mode = mode;

      saveRoleTiers(guildId, tiers);

      await log(
        interaction.guild,
        `✏️ <@${interaction.user.id}> updated role tier **${tier.name}**.`,
      );

      return interaction.reply({
        content:
          `Updated **${tier.name}**.\n` +
          `Points: **${tier.points}**\n` +
          `Role: ${tier.roleId ? `<@&${tier.roleId}>` : "Not configured"}\n` +
          `Assignment: **${tier.mode === "approval" ? "Staff approval" : "Automatic"}**`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Delete a role tier.
    if (sub === "role-delete") {
      const tiers = getRoleTiers(guildId);
      const name = interaction.options.getString("name", true).trim();

      const tier = tiers.find(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      );

      if (!tier) {
        return interaction.reply({
          content: `Couldn't find **${name}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      saveRoleTiers(
        guildId,
        tiers.filter((item) => item !== tier),
      );

      await log(
        interaction.guild,
        `🗑️ <@${interaction.user.id}> deleted role tier **${tier.name}**.`,
      );

      return interaction.reply({
        content:
          `Deleted role tier **${tier.name}** from the configuration. ` +
          "This does not remove that role from members who already have it.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === "task-list") {
      const tasks = getTasks(guildId);
      const lines = tasks.map(
        (t) =>
          `**${t.name}** (\`${t.id}\`) — ${t.enabled === false ? "disabled" : "enabled"} · ${t.type} · ${t.verification} · ${t.period || "lifetime"} · ${t.points} pts${t.type === "message_count" ? ` · target ${t.target || 1}` : ""}`,
      );
      return interaction.reply({
        content: lines.length
          ? lines.join("\n").slice(0, 1900)
          : "No tasks configured.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "task-add") {
      const tasks = getTasks(guildId);
      const id = interaction.options
        .getString("task_id", true)
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9_]{2,40}$/.test(id))
        return interaction.reply({
          content:
            "Task ID must use 2–40 lowercase letters, numbers, or underscores.",
          flags: MessageFlags.Ephemeral,
        });
      if (tasks.some((t) => t.id === id))
        return interaction.reply({
          content: `Task ID \`${id}\` already exists.`,
          flags: MessageFlags.Ephemeral,
        });
      const type = interaction.options.getString("type", true);
      const verification = interaction.options.getString("verification", true);
      if (type === "message_count" && verification !== "auto")
        return interaction.reply({
          content:
            "Message-count tasks must use automatic verification. Use a contribution task for staff-reviewed help.",
          flags: MessageFlags.Ephemeral,
        });
      if (type !== "message_count" && verification === "auto")
        return interaction.reply({
          content:
            "Contribution and challenge tasks must use staff review so genuine help is confirmed.",
          flags: MessageFlags.Ephemeral,
        });
      const task = {
        id,
        name: interaction.options.getString("name", true).trim(),
        description: interaction.options.getString("description", true).trim(),
        type,
        verification,
        period: interaction.options.getString("period", true),
        points: interaction.options.getInteger("points", true),
        enabled: true,
      };
      if (type === "message_count")
        task.target = interaction.options.getInteger("target") || 1;
      tasks.push(task);
      saveTasks(guildId, tasks);
      await log(
        interaction.guild,
        `🆕 <@${interaction.user.id}> created task **${task.name}** (\`${task.id}\`).`,
      );
      return interaction.reply({
        content: `Created **${task.name}** (\`${task.id}\`). The task is saved for this server and will remain after restart.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "task-edit") {
      const tasks = getTasks(guildId);
      const id = interaction.options
        .getString("task_id", true)
        .trim()
        .toLowerCase();
      const task = tasks.find((t) => t.id === id);
      if (!task)
        return interaction.reply({
          content: `Task \`${id}\` was not found. Use \`/tasksetup task-list\`.`,
          flags: MessageFlags.Ephemeral,
        });
      const fields = [
        "name",
        "description",
        "type",
        "verification",
        "period",
        "points",
        "target",
        "enabled",
      ];
      let changed = false;
      for (const field of fields) {
        const value =
          field === "points" || field === "target"
            ? interaction.options.getInteger(field)
            : field === "enabled"
              ? interaction.options.getBoolean(field)
              : interaction.options.getString(field);
        if (value === null || value === undefined) continue;
        task[field] = typeof value === "string" ? value.trim() : value;
        changed = true;
      }
      if (!changed)
        return interaction.reply({
          content: "Choose at least one field to change.",
          flags: MessageFlags.Ephemeral,
        });
      if (task.type === "message_count" && task.verification !== "auto")
        return interaction.reply({
          content: "Message-count tasks must use automatic verification.",
          flags: MessageFlags.Ephemeral,
        });
      if (task.type !== "message_count" && task.verification !== "staff")
        return interaction.reply({
          content: "Contribution and challenge tasks must use staff review.",
          flags: MessageFlags.Ephemeral,
        });
      if (task.type !== "message_count") delete task.target;
      else task.target = Math.max(1, Number(task.target) || 1);
      saveTasks(guildId, tasks);
      await log(
        interaction.guild,
        `✏️ <@${interaction.user.id}> edited task **${task.name}** (\`${task.id}\`).`,
      );
      return interaction.reply({
        content: `Updated **${task.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "task-delete") {
      const tasks = getTasks(guildId);
      const id = interaction.options
        .getString("task_id", true)
        .trim()
        .toLowerCase();
      const task = tasks.find((t) => t.id === id);
      if (!task)
        return interaction.reply({
          content: `Task \`${id}\` was not found.`,
          flags: MessageFlags.Ephemeral,
        });
      saveTasks(
        guildId,
        tasks.filter((t) => t.id !== id),
      );
      await log(
        interaction.guild,
        `🗑️ <@${interaction.user.id}> deleted task **${task.name}** (\`${task.id}\`).`,
      );
      return interaction.reply({
        content: `Deleted **${task.name}** from the task board. Existing point history remains in the database.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "review-channel" || sub === "log-channel") {
      const channel = interaction.options.getChannel("channel", true);
      const key =
        sub === "review-channel" ? "review_channel_id" : "log_channel_id";
      const label =
        sub === "review-channel"
          ? "task review channel"
          : "task/role log channel";
      db.setSetting(guildId, key, channel.id);
      return interaction.reply({
        content: `Saved ${label}: <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "reviewer-role") {
      const action = interaction.options.getString("action", true);
      const role = interaction.options.getRole("role", true);
      const ids = getReviewerRoleIds(guildId);
      if (action === "add") {
        if (ids.includes(role.id))
          return interaction.reply({
            content: `${role} is already a configured reviewer role.`,
            flags: MessageFlags.Ephemeral,
          });
        ids.push(role.id);
      } else {
        if (!ids.includes(role.id))
          return interaction.reply({
            content: `${role} is not currently a configured reviewer role.`,
            flags: MessageFlags.Ephemeral,
          });
        const updated = ids.filter((id) => id !== role.id);
        db.setSetting(guildId, "reviewer_role_ids", updated.join(","));
        return interaction.reply({
          content: `Removed ${role} from reviewer roles.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      db.setSetting(guildId, "reviewer_role_ids", ids.join(","));
      return interaction.reply({
        content: `Added ${role} as a reviewer role.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "status") {
      const reviewId = getSetting(guildId, "review_channel_id");
      const logId = getSetting(guildId, "log_channel_id");
      const reviewerIds = getReviewerRoleIds(guildId);
      const reviewers = reviewerIds.length
        ? reviewerIds.map((id) => `<@&${id}>`).join(", ")
        : "Not configured";
      const embed = new EmbedBuilder()
        .setTitle("Ysabelle Task System Setup")
        .setColor(0x5865f2)
        .addFields(
          {
            name: "Review channel",
            value: reviewId ? `<#${reviewId}>` : "Not configured",
            inline: true,
          },
          {
            name: "Log channel",
            value: logId ? `<#${logId}>` : "Not configured",
            inline: true,
          },
          { name: "Reviewer roles", value: reviewers, inline: false },
        );
      const warnings = [];
      if (!reviewId)
        warnings.push(
          "Set a review channel if staff-reviewed tasks should be posted for moderators.",
        );
      if (!logId)
        warnings.push(
          "Set a log channel if you want role and review audit logs.",
        );
      if (!reviewerIds.length)
        warnings.push(
          "No reviewer roles are configured; administrators and members with Manage Server can still review.",
        );
      if (warnings.length)
        embed.addFields({ name: "Setup notes", value: warnings.join("\n") });
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === "reset") {
      const key = interaction.options.getString("setting", true);
      db.deleteSetting(guildId, key);
      return interaction.reply({
        content: `Cleared **${key}**. The setting will fall back to its environment default, if one exists.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  async function handleSlashCommand(interaction) {
    if (!interaction.inGuild())
      return interaction.reply({
        content: "Use this command inside a server.",
        flags: MessageFlags.Ephemeral,
      });
    const sub = interaction.options.getSubcommand();
    if (sub === "list")
      return interaction.reply({
        embeds: [listEmbed(interaction.guildId, interaction.user.id)],
        flags: MessageFlags.Ephemeral,
      });
    if (sub === "progress")
      return interaction.reply({
        embeds: [progressEmbed(interaction.guildId, interaction.user.id)],
        flags: MessageFlags.Ephemeral,
      });
    if (sub === "submit")
      return submitTask(
        interaction,
        interaction.options.getString("task_id"),
        interaction.options.getString("proof"),
      );
    if (sub === "review")
      return reviewTask(
        interaction,
        interaction.options.getInteger("submission_id"),
        interaction.options.getString("decision"),
        interaction.options.getString("note"),
      );
    if (sub === "submissions") {
      if (!isReviewer(interaction.member))
        return interaction.reply({
          content: "You do not have permission to view pending submissions.",
          flags: MessageFlags.Ephemeral,
        });
      const rows = db.listPending(interaction.guildId, 10);
      const text = rows.length
        ? rows
            .map(
              (r) =>
                `**#${r.id}** <@${r.user_id}> · \`${r.task_id}\` · ${new Date(r.created_at).toLocaleString()}`,
            )
            .join("\n")
        : "No pending submissions.";
      return interaction.reply({
        content: text,
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === "roles") {
      const text = getRoleTiers(interaction.guildId)
        .map(
          (r) =>
            `**${r.name}** — ${r.mode === "approval" ? "admin approval required" : `${r.points} points`}${r.roleId ? ` · <@&${r.roleId}>` : " · role ID not configured"}`,
        )
        .join("\n");
      return interaction.reply({
        content: text || "No role tiers configured.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === "stats") {
      const user = interaction.options.getUser("member") || interaction.user;
      return interaction.reply({
        content: `<@${user.id}> has **${db.getPoints(interaction.guildId, user.id)}** contribution points, **${db.countApproved(interaction.guildId, user.id)}** approved task completions, and **${db.countPending(interaction.guildId, user.id)}** pending submissions.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === "grant-role") {
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator,
        ) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        return interaction.reply({
          content:
            "Only an administrator or member with Manage Server can approve this role.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const user = interaction.options.getUser("member");
      const tierName = interaction.options.getString("tier").toLowerCase();
      const tier = getRoleTiers(interaction.guildId).find(
        (r) => r.mode === "approval" && r.name.toLowerCase() === tierName,
      );
      if (!tier)
        return interaction.reply({
          content:
            "That approval-only tier was not found. Use `/tasks roles` to view configured tiers.",
          flags: MessageFlags.Ephemeral,
        });
      if (!tier.roleId)
        return interaction.reply({
          content: `The role ID for **${tier.name}** is not configured in config/defaults.js.`,
          flags: MessageFlags.Ephemeral,
        });
      const assigned = await giveRole(
        interaction.guild,
        user.id,
        tier.roleId,
        `Approved by ${interaction.user.tag} via /tasks grant-role`,
      );
      if (!assigned)
        return interaction.reply({
          content:
            "Could not assign the role. Check the role ID, bot Manage Roles permission, and role hierarchy.",
          flags: MessageFlags.Ephemeral,
        });
      await log(
        interaction.guild,
        `🛡️ <@${interaction.user.id}> approved <@${user.id}> for <@&${tier.roleId}>.`,
      );
      return interaction.reply({
        content: `Approved: <@${user.id}> received **${tier.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  async function handleMessageCreate(message) {
    if (
      !message.guild ||
      message.author.bot ||
      message.content.length < config.minMessageLength
    )
      return;
    const now = Date.now();
    const last =
      lastCountedMessage.get(`${message.guild.id}:${message.author.id}`) || 0;
    if (now - last < config.messageCooldownMs) return;
    lastCountedMessage.set(`${message.guild.id}:${message.author.id}`, now);
    for (const task of getTasks(message.guild.id).filter(
      (t) =>
        t.enabled !== false &&
        t.type === "message_count" &&
        t.verification === "auto",
    )) {
      const key = periodKey(task.period || "daily");
      const current = db.incrementCounter(
        message.guild.id,
        message.author.id,
        task.id,
        key,
      );
      if (
        current >= (task.target || 1) &&
        !db.getCompletion(message.guild.id, message.author.id, task.id, key)
      ) {
        const awarded = db.awardCompletion({
          guildId: message.guild.id,
          userId: message.author.id,
          taskId: task.id,
          periodKey: key,
          points: task.points,
          submissionId: null,
        });
        if (awarded) {
          await syncAutoRoles(message.guild, message.author.id);
          await log(
            message.guild,
            `✅ <@${message.author.id}> completed **${task.name}** and earned ${task.points} points.`,
          );
        }
      }
    }
  }

  async function handleMemberJoin(member) {
    // Membership-duration tasks are evaluated when the member next uses the task board.
    // No role is granted solely for joining; this avoids rewarding throwaway accounts.
    db.ensureMember(member.guild.id, member.id);
  }

  async function close() {
    db.close();
  }

  return {
    slashCommand,
    setupSlashCommand,
    handleSlashCommand,
    handleSetupSlashCommand,
    handleMessageCreate,
    handleMemberJoin,
    close,
    db,
  };
}

module.exports = createTaskRoleSystem;
