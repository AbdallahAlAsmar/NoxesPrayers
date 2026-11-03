import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const privacyCommand = new SlashCommandBuilder().setName("privacy").setDescription("Control your public streak visibility in this server")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) => subcommand.setName("show").setDescription("View your privacy choices in this server"))
  .addSubcommand((subcommand) => subcommand.setName("enable").setDescription("Opt in to show your streak in this server"))
  .addSubcommand((subcommand) => subcommand.setName("disable").setDescription("Hide your streak in this server"))
  .addSubcommand((subcommand) => subcommand.setName("disconnect").setDescription("Remove your community participation from this server"));

export const serverCommand = new SlashCommandBuilder().setName("server").setDescription("Configure this server's optional prayer community features")
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) => subcommand.setName("setup-streak-channel").setDescription("Set the channel for opted-in streak encouragement")
    .addChannelOption((option) => option.setName("channel").setDescription("Text channel for the community snapshot").addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("disable-streak-channel").setDescription("Disable community streak posts"))
  .addSubcommand((subcommand) => subcommand.setName("streak-settings").setDescription("Change community update settings")
    .addBooleanOption((option) => option.setName("leaderboard").setDescription("Show opted-in members' current streaks"))
    .addBooleanOption((option) => option.setName("weekly_summary").setDescription("Publish aggregate weekly encouragement"))
    .addStringOption((option) => option.setName("frequency").setDescription("Snapshot frequency")
      .addChoices({ name: "Daily", value: "DAILY" }, { name: "Weekly", value: "WEEKLY" })));

export const deleteDataCommand = new SlashCommandBuilder().setName("delete-data").setDescription("Permanently delete your prayer profile and personal history")
  .setContexts(InteractionContextType.Guild)
  .addBooleanOption((option) => option.setName("confirm").setDescription("Confirm permanent deletion of your data").setRequired(true));

export const leaderboardCommand = new SlashCommandBuilder().setName("leaderboard").setDescription("Find this server's opted-in prayer streak channel")
  .setContexts(InteractionContextType.Guild);
