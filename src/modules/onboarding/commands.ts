import { InteractionContextType, SlashCommandBuilder } from "discord.js";

const availableContexts = [
  InteractionContextType.Guild,
];

export const onboardingCommands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Set your private timezone and location for prayer reminders")
    .setContexts(...availableContexts),
  new SlashCommandBuilder()
    .setName("timezone")
    .setDescription("Change or confirm your IANA timezone")
    .setContexts(...availableContexts),
  new SlashCommandBuilder()
    .setName("location")
    .setDescription("Change your city and country for prayer-time calculations")
    .setContexts(...availableContexts),
  new SlashCommandBuilder()
    .setName("timeformat")
    .setDescription("Set whether prayer times are displayed in 12-hour or 24-hour format")
    .addStringOption((option) => option
      .setName("format")
      .setDescription("Preferred clock format")
      .setRequired(true)
      .addChoices(
        { name: "12-hour (AM/PM)", value: "H12" },
        { name: "24-hour", value: "H24" },
      ))
    .setContexts(...availableContexts),
];
