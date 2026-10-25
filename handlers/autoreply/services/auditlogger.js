const { EmbedBuilder } = require("discord.js");

async function logManualCommandAudit({
  message,
  client,
  commandName,
  status,
  details = "",
  targetMessage = null,
  config,
  originalContent = "",
  originalRoles = "",
}) {
  const settings = config.settings?.manualCommands || {};

  console.log(
    `[Ysabelle Audit] ${commandName} | ` +
      `${message.author.tag} (${message.author.id}) | ` +
      `${status} | ${details}`,
  );

  if (!settings.auditChannelId) return;

  try {
    const channel = await client.channels.fetch(settings.auditChannelId);

    if (!channel?.isTextBased() || !channel.send) {
      console.warn("[Ysabelle Audit] Invalid audit channel.");
      return;
    }

    const content =
      settings.logMessageContent === false
        ? "[Message content logging disabled]"
        : String(originalContent || "[No content]").slice(0, 1000);

    const colors = {
      SUCCESS: 0x2ecc71,
      DENIED: 0xe74c3c,
      FAILED: 0xf39c12,
    };

    const embed = new EmbedBuilder()
      .setTitle(`Manual Command Audit: ${commandName}`)
      .setColor(colors[status] ?? 0x5865f2)
      .addFields(
        {
          name: "User",
          value: `${message.author} (\`${message.author.id}\`)`,
        },
        {
          name: "Roles",
          value: String(originalRoles || "No roles").slice(0, 1024),
        },
        {
          name: "Channel",
          value: `${message.channel} (\`${message.channel.id}\`)`,
        },
        {
          name: "Status",
          value: status,
          inline: true,
        },
        {
          name: "Command",
          value: content,
        },
      )
      .setTimestamp();

    if (details) {
      embed.addFields({
        name: "Details",
        value: details.slice(0, 1024),
      });
    }

    if (targetMessage) {
      embed.addFields({
        name: "Reply Target",
        value:
          `Author: ${targetMessage.author?.tag || "Unknown"}\n` +
          `Message ID: ${targetMessage.id}`,
      });
    }

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error(
      "[Ysabelle Audit] Could not send audit log:",
      error.message || error,
    );
  }
}

module.exports = { logManualCommandAudit };
