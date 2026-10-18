const { PermissionFlagsBits, AttachmentBuilder } = require("discord.js");
const { Canvas, loadImage, loadFont: registerFont } = require("canvas-constructor/napi-rs");
const moment = require("moment");
const links = require("../../JSON/link.json");

registerFont("./fonts/Quicksand-SemiBold.ttf", "Quicksand-SemiBold");

function drawAccentSymbol(card, x, y, size) {
  const half = size / 2;
  return card
    .save()
    .beginPath()
    .moveTo(x, y - half)
    .lineTo(x + half, y)
    .lineTo(x, y + half)
    .lineTo(x - half, y)
    .closePath()
    .fill()
    .restore();
}

async function loadUserAvatar(user) {
  const avatarUrl = user.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
  const response = await fetch(avatarUrl);
  if (!response.ok) {
    throw new Error(`Failed to load avatar: ${response.status} ${response.statusText}`);
  }

  const avatarBuffer = Buffer.from(await response.arrayBuffer());
  return loadImage(avatarBuffer);
}

module.exports = {
  name: "testimage",
  aliases: ["ti"],
  category: ":frame_photo: WELCOME",
  usage: "testimage",
  description: "Preview the image-based welcome card.",
  run: async (client, message, args, db) => {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.channel.send("You do not have permission to use this command.");
    }

    const channelId = await db.get(`welcomeimg_${message.guild.id}`);
    if (!channelId) {
      return message.channel.send(
        "Image welcome channel is not set. Use `setimagewelcome` first."
      );
    }

    const notice = await message.channel.send(
      `**${message.author.username}**, please wait — generating your welcome card...`
    );

    try {
      const link = links.link[Math.floor(Math.random() * links.link.length)];
      const bg = await loadImage(link);
      const userPfp = await loadUserAvatar(message.author);

      const memberCount = message.guild.memberCount;

      // ── Welcome card: 900×300 ─────────────────────────────────────────────
      const W = 900, H = 300;
      const AVATAR_CX = 150, AVATAR_CY = 150, AVATAR_R = 110;
      const TEXT_X = 295;
      const HEADER_Y = 68;
      const HEADER_TEXT = "WELCOME";
      const HEADER_FONT = "22px Quicksand-SemiBold";
      const HEADER_TEXT_X = TEXT_X + 22;
      const HEADER_LEFT_X = TEXT_X + 4;
      const HEADER_RIGHT_PADDING = 18;
      const headerMeasure = new Canvas(1, 1).setTextFont(HEADER_FONT).measureText(HEADER_TEXT);
      const HEADER_RIGHT_X = HEADER_TEXT_X + headerMeasure.width + HEADER_RIGHT_PADDING;

      const imageBuffer = new Canvas(W, H)
        .printImage(bg, 0, 0, W, H)
        .setColor("rgba(0, 0, 0, 0.35)")
        .printRectangle(0, 0, W, H)
        .setColor("rgba(255,255,255,0.75)")
        .setTextAlign("left")
        .setTextFont(HEADER_FONT)
        .process((card) => drawAccentSymbol(card, HEADER_LEFT_X, HEADER_Y - 8, 10))
        .printText(HEADER_TEXT, HEADER_TEXT_X, HEADER_Y)
        .process((card) => drawAccentSymbol(card, HEADER_RIGHT_X, HEADER_Y - 8, 10))
        .setColor("#FFFFFF")
        .setTextFont("44px Quicksand-SemiBold")
        .printText(message.author.username, TEXT_X, 128)
        .setColor("rgba(255,255,255,0.25)")
        .printRectangle(TEXT_X, 138, W - TEXT_X - 30, 2)
        .setColor("rgba(255,255,255,0.80)")
        .setTextFont("22px Quicksand-SemiBold")
        .printText(`Member #${memberCount}`, TEXT_X, 175)
        .setColor("rgba(255,255,255,0.60)")
        .setTextFont("20px Quicksand-SemiBold")
        .printText(`Account created: ${moment(message.author.createdAt).format("MMM D, YYYY")}`, TEXT_X, 210)
        .setColor("rgba(255,255,255,0.50)")
        .setTextFont("18px Quicksand-SemiBold")
        .printText(message.guild.name, TEXT_X, 245)
        .setColor("#FFFFFF")
        .printCircle(AVATAR_CX, AVATAR_CY, AVATAR_R + 4)
        .setColor("rgba(0, 0, 0, 0.25)")
        .printCircle(AVATAR_CX, AVATAR_CY, AVATAR_R)
        .printCircularImage(userPfp, AVATAR_CX, AVATAR_CY, AVATAR_R, { fit: "cover" })
        .png();

      const attachment = new AttachmentBuilder(imageBuffer, { name: "welcome.png" });
      await notice.delete().catch(() => {});
      return message.channel.send({ files: [attachment] });
    } catch (error) {
      console.error("Error generating test image:", error);
      await notice.delete().catch(() => {});
      return message.channel.send("Failed to generate the welcome image. Check the console for details.");
    }
  },
};
