import { ChannelType, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../../db/client.js";
import { publishGuildCommunity, removeGuildCommunityPosts } from "./publisher.js";

function requireGuild(interaction: ChatInputCommandInteraction): string {
  if (!interaction.guildId) throw new Error("This command must be used in a server.");
  return interaction.guildId;
}

async function handlePrivacy(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const guildId = requireGuild(interaction);
  const action = interaction.options.getSubcommand();
  const profile = await prisma.user.findUnique({ where: { discordId: interaction.user.id }, select: { id: true } });
  const existing = profile ? await prisma.guildMemberPrivacySettings.findUnique({ where: { userId_guildId: { userId: profile.id, guildId } } }) : null;
  if (action === "show") {
    await interaction.editReply({ content: `Public streak visibility in this server is **${existing?.publicStreak ? "enabled" : "disabled"}**. Individual prayer completion and reminder history stays private.` });
    return;
  }
  if (action === "enable") {
    const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
    if (!settings?.communityEnabled || !settings.streakChannelId) throw new Error("This server has not enabled a community streak channel yet.");
    const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id }, select: { id: true } });
    if (!user) throw new Error("Run `/setup` first so your private streak can be calculated.");
    await prisma.guildMemberPrivacySettings.upsert({
      where: { userId_guildId: { userId: user.id, guildId } },
      create: { userId: user.id, guildId, publicStreak: true, optedInAt: new Date() },
      update: { publicStreak: true, optedInAt: new Date() },
    });
    const published = await publishGuildCommunity(client, guildId, true).catch(() => false);
    await interaction.editReply({ content: published
      ? "You opted in to show your current streak in this server. Individual prayer history, location, timezone, and reminder history remain private. Use `/privacy disable` any time to hide it."
      : "Your opt-in is saved, but I could not refresh the server's current snapshot. The server administrator may need to restore my channel permissions." });
    return;
  }
  if (action === "disable") {
    const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id }, select: { id: true } });
    if (user) await prisma.guildMemberPrivacySettings.updateMany({ where: { userId: user.id, guildId }, data: { publicStreak: false, optedInAt: null } });
    const published = await publishGuildCommunity(client, guildId, true).catch(() => false);
    await interaction.editReply({ content: published
      ? "Your streak is hidden from this server's community view."
      : "Your visibility is disabled in your saved settings. I could not refresh the old snapshot; ask a server administrator to restore my channel permissions so it can be removed." });
    return;
  }
  const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id }, select: { id: true } });
  if (user) await prisma.guildMemberPrivacySettings.deleteMany({ where: { userId: user.id, guildId } });
  const published = await publishGuildCommunity(client, guildId, true).catch(() => false);
  await interaction.editReply({ content: published
    ? "Your community participation has been disconnected from this server."
    : "Your participation is disconnected in saved settings. I could not refresh the old snapshot; ask a server administrator to restore my channel permissions so it can be removed." });
}

async function handleServer(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  const guildId = requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new Error("You need Manage Server permission to change community settings.");
  const action = interaction.options.getSubcommand();
  if (action === "setup-streak-channel") {
    const channel = interaction.options.getChannel("channel", true);
    const botMember = interaction.guild?.members.me;
    if (channel.type !== ChannelType.GuildText || !("permissionsFor" in channel)) throw new Error("Choose a standard server text channel.");
    const permissions = botMember ? channel.permissionsFor(botMember) : null;
    const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
    if (channel.guildId !== guildId || !permissions || required.some((permission) => !permissions.has(permission))) {
      throw new Error("I need View Channel, Send Messages, Embed Links, and Read Message History in that text channel.");
    }
    const oldSettings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { streakChannelId: true } });
    if (oldSettings?.streakChannelId && oldSettings.streakChannelId !== channel.id) {
      const oldSnapshotRemoved = await removeGuildCommunityPosts(client, guildId).catch(() => false);
      if (!oldSnapshotRemoved) throw new Error("I could not remove the old public snapshot. Restore my access to the previous channel and try again.");
    }
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, streakChannelId: channel.id, communityEnabled: true }, update: { streakChannelId: channel.id, communityEnabled: true } });
    const published = await publishGuildCommunity(client, guildId, true).catch(() => false);
    await interaction.editReply({ content: published
      ? `Community encouragement is enabled in <#${channel.id}>. Members must opt in individually using the privacy enable command.`
      : `The channel is saved, but I could not post the first snapshot in <#${channel.id}>. Check my channel permissions.` });
    return;
  }
  if (action === "disable-streak-channel") {
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, communityEnabled: false }, update: { communityEnabled: false } });
    const removed = await removeGuildCommunityPosts(client, guildId).catch(() => false);
    await interaction.editReply({ content: removed
      ? "Community streak posts are disabled and bot-authored snapshots were removed."
      : "Community posting is disabled, but I could not remove the old snapshot. Restore my channel history and message permissions, then run this command again." });
    return;
  }
  const leaderboard = interaction.options.getBoolean("leaderboard");
  const weekly = interaction.options.getBoolean("weekly_summary");
  const frequency = interaction.options.getString("frequency");
  if (leaderboard === null && weekly === null && frequency === null) {
    const current = await prisma.guildSettings.findUnique({ where: { guildId } });
    await interaction.editReply({ content: `Community updates: ${current?.communityEnabled ? "enabled" : "disabled"}; leaderboard: ${current?.leaderboardEnabled ? "enabled" : "disabled"}; frequency: ${(current?.updateFrequency ?? "DAILY").toLowerCase()}; weekly summary: ${current?.weeklySummaryEnabled ? "enabled" : "disabled"}.` });
    return;
  }
  await prisma.guildSettings.upsert({
    where: { guildId },
    create: { guildId, ...(leaderboard === null ? {} : { leaderboardEnabled: leaderboard }), ...(weekly === null ? {} : { weeklySummaryEnabled: weekly }), ...(frequency === null ? {} : { updateFrequency: frequency }) },
    update: { ...(leaderboard === null ? {} : { leaderboardEnabled: leaderboard }), ...(weekly === null ? {} : { weeklySummaryEnabled: weekly }), ...(frequency === null ? {} : { updateFrequency: frequency }) },
  });
  const published = await publishGuildCommunity(client, guildId, true).catch(() => false);
  await interaction.editReply({ content: published ? "Community streak settings saved." : "Community settings were saved, but I could not refresh the current snapshot. Check my channel permissions." });
}

export async function handleCommunityCommand(interaction: ChatInputCommandInteraction, client: Client): Promise<boolean> {
  if (!["privacy", "server", "delete-data", "leaderboard"].includes(interaction.commandName)) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (interaction.commandName === "privacy") await handlePrivacy(interaction, client);
    else if (interaction.commandName === "server") await handleServer(interaction, client);
    else if (interaction.commandName === "leaderboard") {
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: requireGuild(interaction) } });
      await interaction.editReply({ content: settings?.communityEnabled && settings.streakChannelId
        ? `The opt-in community streak snapshot is posted in <#${settings.streakChannelId}>. You can check visibility with the privacy show command.`
        : "This server has not enabled a community streak channel." });
    }
    else {
      if (!interaction.options.getBoolean("confirm", true)) throw new Error("Data deletion was not confirmed. Nothing was deleted.");
      const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id }, select: { id: true, guildPrivacy: { select: { guildId: true } } } });
      if (!user) {
        await interaction.editReply({ content: "No personal prayer data was found." });
        return true;
      }
      const guildIds = user.guildPrivacy.map(({ guildId }) => guildId);
      await prisma.user.delete({ where: { id: user.id } });
      let snapshotsUpdated = true;
      for (const guildId of guildIds) {
        const updated = await publishGuildCommunity(client, guildId, true).catch(() => false);
        snapshotsUpdated = snapshotsUpdated && updated;
      }
      await interaction.editReply({ content: snapshotsUpdated
        ? "Your prayer profile, locations, prayer history, schedules, reminders, and per-server privacy choices have been permanently deleted."
        : "Your personal data was deleted. I could not refresh at least one old community snapshot; ask a server administrator to restore my channel permissions so cached public streak summaries can be removed." });
    }
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "That action could not be completed." }).catch(() => undefined);
  }
  return true;
}
