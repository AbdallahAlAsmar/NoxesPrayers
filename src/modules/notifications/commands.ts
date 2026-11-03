import { InteractionContextType, SlashCommandBuilder } from "discord.js";

const prayerChoices = [
  { name: "Fajr", value: "FAJR" }, { name: "Dhuhr", value: "DHUHR" },
  { name: "Asr", value: "ASR" }, { name: "Maghrib", value: "MAGHRIB" }, { name: "Isha", value: "ISHA" },
];

export const remindersCommand = new SlashCommandBuilder()
  .setName("reminders")
  .setDescription("Manage private prayer reminders")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) => subcommand.setName("settings").setDescription("View or change one prayer's reminder")
    .addStringOption((option) => option.setName("prayer").setDescription("Prayer to configure").setRequired(true).addChoices(...prayerChoices))
    .addBooleanOption((option) => option.setName("enabled").setDescription("Send the prayer-time reminder"))
    .addBooleanOption((option) => option.setName("completion_prompt").setDescription("Include the I Prayed button"))
    .addIntegerOption((option) => option.setName("minutes_before").setDescription("Optional heads-up, 0 to 120 minutes before").setMinValue(0).setMaxValue(120)))
  .addSubcommand((subcommand) => subcommand.setName("pause").setDescription("Pause all reminders temporarily")
    .addIntegerOption((option) => option.setName("hours").setDescription("Pause duration (1 to 168 hours)").setMinValue(1).setMaxValue(168).setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("resume").setDescription("Resume paused reminders"))
  .addSubcommand((subcommand) => subcommand.setName("test").setDescription("Send a private test message and check DM access"))
  .addSubcommand((subcommand) => subcommand.setName("checklist").setDescription("Enable or disable your private midnight prayer checklist")
    .addBooleanOption((option) => option.setName("enabled").setDescription("Send the checklist at local midnight")));
