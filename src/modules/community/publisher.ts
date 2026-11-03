import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Client, type TextChannel } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../db/client.js";
import { logger } from "../../shared/logger.js";

export async function publishGuildCommunity(client: Client, guildId: string, force = false): Promise<boolean> {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
  if (!settings?.communityEnabled || !settings.streakChannelId) return false;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;
  const fetched = await guild.channels.fetch(settings.streakChannelId).catch(() => null);
  if (!fetched || fetched.type !== ChannelType.GuildText) {
    logger.warn({ guildId }, "Configured community channel is unavailable");
    return false;
  }
  const channel = fetched as TextChannel;
  const permissions = channel.permissionsFor(client.user!);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
  if (!permissions || required.some((permission) => !permissions.has(permission))) {
    logger.warn({ guildId }, "Bot lacks permissions for the configured community channel");
    return false;
  }

  const now = DateTime.utc();
  const dateLabel = now.toISODate()!;
  const weekly = now.weekday === 1 && (settings.updateFrequency === "WEEKLY" || settings.weeklySummaryEnabled);
  const marker = `Community snapshot · ${dateLabel}${weekly ? " · weekly" : ""}`;
  const privacyRows = await prisma.guildMemberPrivacySettings.findMany({
    where: { guildId, publicStreak: true },
    include: { user: { include: { streak: true } } },
  });
  const publicRows = privacyRows
    .filter((row) => row.user.streak)
    .sort((a, b) => (b.user.streak?.currentStreak ?? 0) - (a.user.streak?.currentStreak ?? 0))
    .slice(0, 25);

  const lines: string[] = [];
  let removedDepartedMember = false;
  if (settings.leaderboardEnabled) {
    for (const row of publicRows) {
      let member;
      try { member = await guild.members.fetch(row.user.discordId); }
      catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
        if (code === 10007 || code === "Unknown Member") {
        await prisma.guildMemberPrivacySettings.updateMany({ where: { userId: row.userId, guildId, publicStreak: true }, data: { publicStreak: false, optedInAt: null } }).catch(() => undefined);
          removedDepartedMember = true;
        }
        continue;
      }
      const streak = row.user.streak!;
      const details = [
        `${streak.currentStreak}-day streak`,
        row.showLongest ? `longest ${streak.longestStreak} days` : null,
        row.showTotalDays ? `${streak.totalCompletedDays} completed days` : null,
      ].filter(Boolean).join(" · ");
      lines.push(`• **${member.displayName.replace(/[@`]/g, "") }** — ${details}`);
    }
  }
  const optedInActive = privacyRows.filter((row) => (row.user.streak?.currentStreak ?? 0) > 0).length;
  const embed = new EmbedBuilder().setColor(0x287A69)
    .setTitle(weekly ? "Weekly Prayer Community" : "Daily Prayer Community")
    .setDescription(`May Allah help us remain consistent in our prayers.\n\n${lines.length ? lines.join("\n").slice(0, 3900) : "Members can opt in with `/privacy enable`."}`)
    .setFooter({ text: `${marker} · ${optedInActive} opted-in members with an active streak` });
  if (weekly && settings.weeklySummaryEnabled) {
    embed.addFields({ name: "Weekly encouragement", value: "Every prayer is self-reported privately. This community view shares streak summaries only; individual prayer history is never displayed." });
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const snapshots = recent ? [...recent.values()].filter((message) => message.author.id === client.user!.id && message.embeds.some((item) => item.title === "Daily Prayer Community" || item.title === "Weekly Prayer Community")) : [];
  const existing = snapshots[0];
  const updateDue = force || removedDepartedMember || settings.updateFrequency === "DAILY" || now.weekday === 1;
  if (existing) {
    if (updateDue && (force || existing.embeds[0]?.footer?.text !== embed.data.footer?.text || existing.embeds[0]?.description !== embed.data.description)) {
      await existing.edit({ embeds: [embed] });
    }
    for (const duplicate of snapshots.slice(1)) await duplicate.delete().catch(() => undefined);
  } else if (updateDue) {
    await channel.send({ embeds: [embed] });
  }
  return true;
}

export async function removeGuildCommunityPosts(client: Client, guildId: string): Promise<boolean> {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
  if (!settings?.streakChannelId) return true;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return true;
  let fetched;
  try { fetched = await guild.channels.fetch(settings.streakChannelId); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    return code === 10003 || code === "Unknown Channel";
  }
  if (!fetched) return false;
  if (fetched.type !== ChannelType.GuildText) return false;
  const channel = fetched as TextChannel;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return false;
  const snapshots = messages.filter((message) => message.author.id === client.user!.id && message.embeds.some((embed) => embed.title === "Daily Prayer Community" || embed.title === "Weekly Prayer Community"));
  let removed = true;
  for (const message of snapshots.values()) {
    if (!await message.delete().then(() => true).catch(() => false)) removed = false;
  }
  return removed;
}

export async function publishAllCommunities(client: Client): Promise<void> {
  const guilds = await prisma.guildSettings.findMany({ where: { communityEnabled: true }, select: { guildId: true } });
  for (const { guildId } of guilds) {
    try { await publishGuildCommunity(client, guildId); }
    catch (error) { logger.warn({ errorType: error instanceof Error ? error.name : "UnknownError", guildId }, "Community snapshot could not be published"); }
  }
}
