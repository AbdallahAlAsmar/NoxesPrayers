import { InteractionContextType, SlashCommandBuilder } from "discord.js";

export const prayerCommand = new SlashCommandBuilder()
  .setName("prayer")
  .setDescription("View today's prayer times and calculation preferences")
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) => subcommand
    .setName("times")
    .setDescription("View today's prayer times in your saved timezone"))
  .addSubcommand((subcommand) => subcommand.setName("status").setDescription("View today's private prayer progress"))
  .addSubcommand((subcommand) => subcommand.setName("log").setDescription("Self-report a prayer you completed during its completion window")
    .addStringOption((option) => option.setName("prayer").setDescription("Prayer you completed").setRequired(true).addChoices(
      { name: "Fajr", value: "FAJR" }, { name: "Dhuhr", value: "DHUHR" }, { name: "Asr", value: "ASR" }, { name: "Maghrib", value: "MAGHRIB" }, { name: "Isha", value: "ISHA" },
    ))
    .addStringOption((option) => option.setName("date").setDescription("Local date YYYY-MM-DD (defaults to the current prayer date)").setMinLength(10).setMaxLength(10)))
  .addSubcommand((subcommand) => subcommand.setName("undo").setDescription("Undo your own accidental prayer entry within 10 minutes")
    .addStringOption((option) => option.setName("prayer").setDescription("Prayer record to undo").setRequired(true).addChoices(
      { name: "Fajr", value: "FAJR" }, { name: "Dhuhr", value: "DHUHR" }, { name: "Asr", value: "ASR" }, { name: "Maghrib", value: "MAGHRIB" }, { name: "Isha", value: "ISHA" },
    )))
  .addSubcommand((subcommand) => subcommand.setName("statistics").setDescription("View your private streak and completion statistics"))
  .addSubcommand((subcommand) => subcommand
    .setName("settings")
    .setDescription("View or change your prayer-time calculation preferences")
    .addBooleanOption((option) => option.setName("reset").setDescription("Reset all calculation preferences to defaults"))
    .addStringOption((option) => option.setName("method").setDescription("Calculation convention")
      .addChoices(
        { name: "Muslim World League", value: "MUSLIM_WORLD_LEAGUE" },
        { name: "North America (ISNA)", value: "NORTH_AMERICA" },
        { name: "Egyptian General Authority of Survey", value: "EGYPTIAN" },
        { name: "Umm al-Qura University", value: "UMM_AL_QURA" },
        { name: "University of Islamic Sciences, Karachi", value: "KARACHI" },
        { name: "Dubai", value: "DUBAI" },
        { name: "Moonsighting Committee", value: "MOONSIGHTING_COMMITTEE" },
        { name: "Kuwait", value: "KUWAIT" },
        { name: "Qatar", value: "QATAR" },
        { name: "Singapore", value: "SINGAPORE" },
        { name: "Tehran", value: "TEHRAN" },
        { name: "Turkey", value: "TURKEY" },
      ))
    .addStringOption((option) => option.setName("asr").setDescription("Asr shadow-length convention")
      .addChoices({ name: "Standard (Shafi'i, Maliki, Hanbali)", value: "STANDARD" }, { name: "Hanafi", value: "HANAFI" }))
    .addStringOption((option) => option.setName("high_latitude").setDescription("Rule for high-latitude dates")
      .addChoices(
        { name: "Recommended for location", value: "RECOMMENDED" },
        { name: "Middle of the night", value: "MIDDLE_OF_THE_NIGHT" },
        { name: "One seventh of the night", value: "SEVENTH_OF_THE_NIGHT" },
        { name: "Twilight angle", value: "TWILIGHT_ANGLE" },
      ))
    .addNumberOption((option) => option.setName("fajr_angle").setDescription("Custom Fajr angle in degrees (0–30)").setMinValue(0).setMaxValue(30))
    .addNumberOption((option) => option.setName("isha_angle").setDescription("Custom Isha angle in degrees (0–30)").setMinValue(0).setMaxValue(30))
    .addIntegerOption((option) => option.setName("isha_interval").setDescription("Isha minutes after Maghrib (0–180)").setMinValue(0).setMaxValue(180))
    .addIntegerOption((option) => option.setName("fajr_adjustment").setDescription("Fajr adjustment in minutes (-60 to 60)").setMinValue(-60).setMaxValue(60))
    .addIntegerOption((option) => option.setName("dhuhr_adjustment").setDescription("Dhuhr adjustment in minutes (-60 to 60)").setMinValue(-60).setMaxValue(60))
    .addIntegerOption((option) => option.setName("asr_adjustment").setDescription("Asr adjustment in minutes (-60 to 60)").setMinValue(-60).setMaxValue(60))
    .addIntegerOption((option) => option.setName("maghrib_adjustment").setDescription("Maghrib adjustment in minutes (-60 to 60)").setMinValue(-60).setMaxValue(60))
    .addIntegerOption((option) => option.setName("isha_adjustment").setDescription("Isha adjustment in minutes (-60 to 60)").setMinValue(-60).setMaxValue(60)));
