const { PermissionFlagsBits, MessageFlags } = require("discord.js");
const { getGiveaway, saveGiveaway } = require("../db");
const { replyPrivately } = require("../commands/slash-handler");
const {
  publishGiveaway,
  refreshGiveawayMessage,
} = require("../services/giveaway");
const { checkEntryRequirements } = require("../services/requirements");
const { buildMemberProgressEmbed } = require("../embeds");
function registerButtonHandler(client, db) {
  client.on("interactionCreate", async (i) => {
    try {
      if (!i.isButton()) return;
      const [root, action, guildId] = i.customId.split(":");
      if (root !== "giveaway") return;
      if (!i.guild || i.guild.id !== guildId) {
        await replyPrivately(i, "This button belongs to another server.");
        return;
      }
      const guild = i.guild,
        g = await getGiveaway(db, guildId);
      if (action === "publish" || action === "cancel") {
        const can =
          i.user.id === guild.ownerId ||
          i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
        if (!can) {
          await replyPrivately(
            i,
            "Only the server owner or a member with Manage Server permission can do this.",
          );
          return;
        }
        if (!g || g.status !== "draft") {
          await replyPrivately(
            i,
            "This giveaway preview is no longer available.",
          );
          return;
        }
        if (action === "cancel") {
          g.status = "cancelled";
          g.cancelledAt = Date.now();
          await saveGiveaway(db, guildId, g);
          await i.update({
            content: "Giveaway cancelled. Nothing was published.",
            embeds: [],
            components: [],
          });
          return;
        }
        await i.deferUpdate();
        try {
          await publishGiveaway(client, db, guild, g);
          await i.editReply({
            content: `✅ Giveaway published in <#${g.channelId}>.`,
            embeds: [],
            components: [],
          });
        } catch (e) {
          console.error("[Giveaway publish button]", e);
          await i
            .editReply({
              content: `❌ Could not publish giveaway: ${e.message}`,
              embeds: [],
              components: [],
            })
            .catch(() => {});
        }
        return;
      }
      if (action === "progress") {
        if (!g || g.status !== "active") {
          await replyPrivately(i, "This giveaway is no longer active.");
          return;
        }
        if (Number(g.endsAt) <= Date.now()) {
          await replyPrivately(
            i,
            "This giveaway has reached its end time. Please wait for the result.",
          );
          return;
        }
        const embed = await buildMemberProgressEmbed(
          db,
          guild,
          g,
          i.user.id,
          checkEntryRequirements,
        );
        await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === "enter") {
        if (!g || g.status !== "active") {
          await replyPrivately(i, "This giveaway is no longer active.");
          return;
        }
        if (Number(g.endsAt) <= Date.now()) {
          await replyPrivately(
            i,
            "This giveaway has reached its end time. Please wait for the winner announcement.",
          );
          return;
        }
        if ((g.entries || []).includes(i.user.id)) {
          await replyPrivately(i, "You have already entered this giveaway.");
          return;
        }
        const check = await checkEntryRequirements(db, guild, g, i.user.id);
        if (!check.ok) {
          await replyPrivately(
            i,
            `❌ You cannot enter **${g.prize}** yet.\n\n${check.reason}`,
          );
          return;
        }
        g.entries = [...new Set([...(g.entries || []), i.user.id])];
        await saveGiveaway(db, guildId, g);
        await refreshGiveawayMessage(client, db, guildId);
        await replyPrivately(
          i,
          `🎉 You have successfully entered **${g.prize}**. Good luck!`,
        );
      }
    } catch (e) {
      console.error("[Giveaway button handler]", e);
      if (i.isRepliable() && !i.replied && !i.deferred)
        await replyPrivately(
          i,
          "Something went wrong. Please try again.",
        ).catch(() => {});
    }
  });
}
module.exports = { registerButtonHandler };
