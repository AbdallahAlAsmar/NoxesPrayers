import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import { prisma } from "../../db/client.js";
import { formatPrayerTime, settingsFromRecord, type PrayerCalculationSettings } from "./calculator.js";
import { getPrayerSchedule, getPrayerSettings, updatePrayerSettings } from "./service.js";
import { currentPrayerDate, getPrayerProgress, recordPrayer, undoRecentPrayer, type PrayerProgress } from "../prayer-tracking/service.js";
import type { PrayerCode } from "./calculator.js";

const methodLabels: Record<string, string> = {
  MUSLIM_WORLD_LEAGUE: "Muslim World League",
  NORTH_AMERICA: "North America (ISNA)",
  EGYPTIAN: "Egyptian General Authority of Survey",
  UMM_AL_QURA: "Umm al-Qura University",
  KARACHI: "University of Islamic Sciences, Karachi",
  DUBAI: "Dubai",
  MOONSIGHTING_COMMITTEE: "Moonsighting Committee",
  KUWAIT: "Kuwait",
  QATAR: "Qatar",
  SINGAPORE: "Singapore",
  TEHRAN: "Tehran",
  TURKEY: "Turkey",
};

function settingsSummary(settings: PrayerCalculationSettings): string {
  return [
    `**Calculation method:** ${methodLabels[settings.calculationMethod] ?? settings.calculationMethod}`,
    `**Asr:** ${settings.asrMethod === "HANAFI" ? "Hanafi" : "Standard"}`,
    `**High latitude:** ${settings.highLatitudeRule?.replaceAll("_", " ").toLowerCase() ?? "Recommended for location"}`,
    `**Angles:** Fajr ${settings.fajrAngle === null ? "method default" : `${settings.fajrAngle}°`}; Isha ${settings.ishaAngle === null ? "method default" : `${settings.ishaAngle}°`}${settings.ishaIntervalMinutes === null ? "" : ` or ${settings.ishaIntervalMinutes} minutes after Maghrib`}`,
    `**Manual adjustments:** Fajr ${settings.fajrAdjustmentMinutes}, Dhuhr ${settings.dhuhrAdjustmentMinutes}, Asr ${settings.asrAdjustmentMinutes}, Maghrib ${settings.maghribAdjustmentMinutes}, Isha ${settings.ishaAdjustmentMinutes} minutes`,
  ].join("\n");
}

async function showTimes(interaction: ChatInputCommandInteraction): Promise<void> {
  const schedule = await getPrayerSchedule(interaction.user.id);
  const names: Record<string, string> = { FAJR: "Fajr", DHUHR: "Dhuhr", ASR: "Asr", MAGHRIB: "Maghrib", ISHA: "Isha" };
  const embed = new EmbedBuilder()
    .setColor(0x287A69)
    .setTitle(`Prayer times · ${schedule.localDate}`)
    .setDescription(schedule.prayers.map(({ prayer, at }) => `**${names[prayer]}** — ${formatPrayerTime(at, schedule.timezone, schedule.timeFormat)}`).join("\n"))
    .setFooter({ text: `${schedule.city ? `${schedule.city} · ` : ""}${schedule.timezone} · ${methodLabels[schedule.method] ?? schedule.method}` });
  await interaction.editReply({ embeds: [embed] });
}

async function showSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  const current = await getPrayerSettings(interaction.user.id);
  const optionNames = ["method", "asr", "high_latitude", "fajr_angle", "isha_angle", "isha_interval", "fajr_adjustment", "dhuhr_adjustment", "asr_adjustment", "maghrib_adjustment", "isha_adjustment"] as const;
  const reset = interaction.options.getBoolean("reset") ?? false;
  const suppliedSetting = optionNames.some((name) => interaction.options.get(name)?.value !== null && interaction.options.get(name)?.value !== undefined);
  if (reset && suppliedSetting) {
    await interaction.editReply({ content: "Use reset by itself, or provide one or more settings to update." });
    return;
  }
  const hasChanges = reset || suppliedSetting;
  if (!hasChanges) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x287A69).setTitle("Prayer calculation preferences").setDescription(`${settingsSummary(current)}\n\nUse the prayer settings command with one or more options to update these values.`)] });
    return;
  }

  if (reset) {
    const defaults = settingsFromRecord(null);
    await updatePrayerSettings(interaction.user.id, defaults);
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x287A69).setTitle("Prayer preferences reset").setDescription(`${settingsSummary(defaults)}\n\nFuture prayer schedules will use the defaults.`)] });
    return;
  }

  const suppliedIshaAngle = interaction.options.getNumber("isha_angle");
  const suppliedIshaInterval = interaction.options.getInteger("isha_interval");
  if (suppliedIshaAngle !== null && suppliedIshaInterval !== null) {
    await interaction.editReply({ content: "Choose either an Isha angle or an Isha interval in one update, not both." });
    return;
  }

  const next: PrayerCalculationSettings = {
    ...current,
    calculationMethod: interaction.options.getString("method") ?? current.calculationMethod,
    asrMethod: interaction.options.getString("asr") ?? current.asrMethod,
    highLatitudeRule: interaction.options.getString("high_latitude") ?? current.highLatitudeRule,
    fajrAngle: interaction.options.getNumber("fajr_angle") ?? current.fajrAngle,
    ishaAngle: suppliedIshaAngle !== null ? suppliedIshaAngle : suppliedIshaInterval !== null ? null : current.ishaAngle,
    ishaIntervalMinutes: suppliedIshaInterval !== null ? (suppliedIshaInterval === 0 ? null : suppliedIshaInterval) : suppliedIshaAngle !== null ? null : current.ishaIntervalMinutes,
    fajrAdjustmentMinutes: interaction.options.getInteger("fajr_adjustment") ?? current.fajrAdjustmentMinutes,
    dhuhrAdjustmentMinutes: interaction.options.getInteger("dhuhr_adjustment") ?? current.dhuhrAdjustmentMinutes,
    asrAdjustmentMinutes: interaction.options.getInteger("asr_adjustment") ?? current.asrAdjustmentMinutes,
    maghribAdjustmentMinutes: interaction.options.getInteger("maghrib_adjustment") ?? current.maghribAdjustmentMinutes,
    ishaAdjustmentMinutes: interaction.options.getInteger("isha_adjustment") ?? current.ishaAdjustmentMinutes,
  };
  await updatePrayerSettings(interaction.user.id, next);
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x287A69).setTitle("Prayer preferences saved").setDescription(`${settingsSummary(next)}\n\nYour future prayer schedule has been updated.`)] });
}

function progressEmbed(title: string, progress: PrayerProgress): EmbedBuilder {
  const prayerLabels: Record<PrayerCode, string> = { FAJR: "Fajr", DHUHR: "Dhuhr", ASR: "Asr", MAGHRIB: "Maghrib", ISHA: "Isha" };
  const status = [...progress.completed.map((prayer) => `✅ ${prayerLabels[prayer]}: Completed`), ...progress.pending.map((prayer) => `▫️ ${prayerLabels[prayer]}: Pending`)];
  return new EmbedBuilder().setColor(0x287A69).setTitle(title)
    .setDescription(`${progress.completed.length}/5 prayers · ${progress.dailyPercentage}%\n\n${status.join("\n")}`)
    .addFields(
      { name: "Current streak", value: `${progress.currentStreak} days`, inline: true },
      { name: "Longest streak", value: `${progress.longestStreak} days`, inline: true },
      { name: "Completed days", value: `${progress.totalCompletedDays}`, inline: true },
      { name: "Prayers reported", value: `${progress.totalCompletedPrayers}`, inline: true },
      { name: "Last 7 days", value: `${progress.weeklyPrayerCount}/35 prayers · ${progress.weeklyCompletedDays} complete days · ${progress.weeklyPercentage}%` },
    ).setFooter({ text: `Local prayer date ${progress.prayerDate} · Completion is self-reported` });
}

async function prayerDateFor(interaction: ChatInputCommandInteraction): Promise<string> {
  const explicit = interaction.options.getString("date");
  return explicit ?? (await currentPrayerDate(interaction.user.id)).date;
}

async function logPrayer(interaction: ChatInputCommandInteraction): Promise<void> {
  const prayer = interaction.options.getString("prayer", true) as PrayerCode;
  const date = await prayerDateFor(interaction);
  const progress = await recordPrayer(interaction.user.id, prayer, date);
  await interaction.editReply({ embeds: [progressEmbed(`${prayer[0]}${prayer.slice(1).toLowerCase()} self-reported`, progress)] });
}

async function undoPrayer(interaction: ChatInputCommandInteraction): Promise<void> {
  const prayer = interaction.options.getString("prayer", true) as PrayerCode;
  const date = await prayerDateFor(interaction);
  const progress = await undoRecentPrayer(interaction.user.id, prayer, date);
  await interaction.editReply({ embeds: [progressEmbed("Prayer entry corrected", progress)] });
}

export async function handlePrayerCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName !== "prayer") return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "times") await showTimes(interaction);
    else if (subcommand === "settings") await showSettings(interaction);
    else if (subcommand === "log") await logPrayer(interaction);
    else if (subcommand === "undo") await undoPrayer(interaction);
    else await interaction.editReply({ embeds: [progressEmbed(subcommand === "statistics" ? "Your prayer statistics" : "Today's prayer progress", await getPrayerProgress(interaction.user.id))] });
  } catch (error) {
    const description = error instanceof Error ? error.message : "Prayer information is temporarily unavailable. Please try again shortly.";
    await interaction.editReply({ content: description }).catch(() => undefined);
  }
  return true;
}

export async function handlePrayerInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith("prayer:complete:")) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const jobId = interaction.customId.slice("prayer:complete:".length);
  try {
    const job = await prisma.notificationJob.findUnique({ where: { id: jobId }, include: { user: true, schedule: true } });
    if (!job || !job.schedule || job.kind !== "PRAYER" || job.status !== "COMPLETED") {
      await interaction.editReply({ content: "This reminder is no longer available for logging." });
      return true;
    }
    if (interaction.user.id !== job.user.discordId) {
      await interaction.editReply({ content: "This prayer button belongs to another Discord user." });
      return true;
    }
    if (job.schedule.scheduleVersion !== job.user.scheduleVersion) {
      await interaction.editReply({ content: "Your prayer schedule has changed. Use `/prayer log` during the prayer's current completion window instead." });
      return true;
    }
    const progress = await recordPrayer(interaction.user.id, job.schedule.prayer as PrayerCode, job.schedule.localDate.toISOString().slice(0, 10));
    await interaction.editReply({ embeds: [progressEmbed("Prayer self-reported", progress)] });
    await interaction.message.edit({ components: [] }).catch(() => undefined);
  } catch (error) {
    const description = error instanceof Error ? error.message : "This prayer could not be recorded right now.";
    await interaction.editReply({ content: description }).catch(() => undefined);
  }
  return true;
}
