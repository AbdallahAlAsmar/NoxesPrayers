import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../db/client.js";
import { getPrayerProgress } from "../prayer-tracking/service.js";

const methods: Record<string, string> = {
  MUSLIM_WORLD_LEAGUE: "Muslim World League", NORTH_AMERICA: "North America (ISNA)", EGYPTIAN: "Egyptian",
  UMM_AL_QURA: "Umm al-Qura", KARACHI: "Karachi", DUBAI: "Dubai", MOONSIGHTING_COMMITTEE: "Moonsighting Committee",
  KUWAIT: "Kuwait", QATAR: "Qatar", SINGAPORE: "Singapore", TEHRAN: "Tehran", TURKEY: "Turkey",
};

export async function handleProfileCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName !== "profile") return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id }, include: { prayerSettings: true, reminders: true, streak: true } });
    if (!user) {
      await interaction.editReply({ content: "Run `/setup` to create your private prayer profile." });
      return true;
    }
    const progress = user.timezone && user.latitude !== null && user.longitude !== null ? await getPrayerProgress(interaction.user.id) : null;
    const enabledCount = 5 - user.reminders.length + user.reminders.filter((reminder) => reminder.enabled).length;
    const embed = new EmbedBuilder().setColor(0x287A69).setTitle("Your private prayer profile")
      .setDescription([
        `**Location:** ${user.city ? `${user.city}${user.countryCode ? `, ${user.countryCode}` : ""}` : "Not set"}`,
        `**Timezone:** ${user.timezone ?? "Not set"}`,
        `**Clock:** ${user.timeFormat === "H12" ? "12-hour" : "24-hour"}`,
        `**Calculation:** ${methods[user.prayerSettings?.calculationMethod ?? "MUSLIM_WORLD_LEAGUE"] ?? "Muslim World League"} · ${user.prayerSettings?.asrMethod === "HANAFI" ? "Hanafi" : "Standard Asr"}`,
        `**Reminders:** ${user.pausedUntil && user.pausedUntil > new Date() ? `Paused until ${DateTime.fromJSDate(user.pausedUntil, { zone: user.timezone ?? "UTC" }).toFormat("yyyy-LL-dd h:mm a ZZZZ")}` : `${enabledCount}/5 prayers enabled`}`,
        progress ? `**Today's progress:** ${progress.completed.length}/5 · **Current streak:** ${progress.currentStreak} days` : "Set a city and confirm a timezone to calculate prayer progress.",
      ].join("\n"))
      .setFooter({ text: "Your location, timezone, schedule, and prayer history are private." });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Your profile could not be loaded right now." });
  }
  return true;
}
