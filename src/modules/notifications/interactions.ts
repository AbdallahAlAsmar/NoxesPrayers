import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";
import { prisma } from "../../db/client.js";
import { materializeUserNotifications } from "./scheduler.js";
import { isDmUnavailable, recordDmStatus, sendDmTest } from "./worker.js";
import type { PrayerCode } from "../prayer-times/calculator.js";

const PRAYERS: PrayerCode[] = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"];
const label = (prayer: string): string => prayer[0] + prayer.slice(1).toLowerCase();

async function configure(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
  if (!user?.timezone) throw new Error("Run `/setup` and confirm your timezone before enabling reminders.");
  const prayerInput = interaction.options.getString("prayer", true);
  if (!PRAYERS.includes(prayerInput as PrayerCode)) throw new Error("Choose one of the five daily prayers.");
  const prayer = prayerInput as PrayerCode;
  const enabled = interaction.options.getBoolean("enabled");
  const completionPrompt = interaction.options.getBoolean("completion_prompt");
  const minutesBefore = interaction.options.getInteger("minutes_before");
  const isUpdate = enabled !== null || completionPrompt !== null || minutesBefore !== null;
  const current = await prisma.userReminderSettings.findUnique({ where: { userId_prayer: { userId: user.id, prayer } } });
  if (!isUpdate) {
    await interaction.editReply({ content: `**${label(prayer)}** reminders: ${current?.enabled === false ? "off" : "on"}; heads-up: ${current?.minutesBefore ?? 0} minutes; completion button: ${current?.completionPrompt === false ? "off" : "on"}.` });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.userReminderSettings.upsert({
      where: { userId_prayer: { userId: user.id, prayer } },
      create: { userId: user.id, prayer, enabled: enabled ?? true, completionPrompt: completionPrompt ?? true, minutesBefore: minutesBefore ?? 0 },
      update: {
        ...(enabled === null ? {} : { enabled }),
        ...(completionPrompt === null ? {} : { completionPrompt }),
        ...(minutesBefore === null ? {} : { minutesBefore }),
      },
    });
    await tx.user.update({ where: { id: user.id }, data: { scheduleVersion: { increment: 1 } } });
    await tx.notificationJob.updateMany({ where: { userId: user.id, status: "PENDING" }, data: { status: "CANCELLED" } });
  });
  await materializeUserNotifications(interaction.user.id).catch(() => undefined);
  await interaction.editReply({ content: `Saved private ${label(prayer)} reminder preferences.` });
}

export async function handleReminderCommand(interaction: ChatInputCommandInteraction, client: Client): Promise<boolean> {
  if (interaction.commandName !== "reminders") return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "settings") {
      await configure(interaction);
    } else if (subcommand === "checklist") {
      const enabled = interaction.options.getBoolean("enabled");
      const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
      if (!user?.timezone) throw new Error("Run `/setup` and confirm your timezone before enabling the daily checklist.");
      if (enabled === null) {
        await interaction.editReply({ content: `Your private midnight checklist is **${user.dailyChecklistEnabled ? "on" : "off"}**. It reports completed prayers, missed prayers whose windows have ended, and prayers still open until Fajr.` });
      } else {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: user.id }, data: { dailyChecklistEnabled: enabled, scheduleVersion: { increment: 1 } } });
          await tx.notificationJob.updateMany({ where: { userId: user.id, status: "PENDING" }, data: { status: "CANCELLED" } });
        });
        await materializeUserNotifications(interaction.user.id).catch(() => undefined);
        await interaction.editReply({ content: enabled ? "Your private daily checklist is enabled and will arrive at your local midnight." : "Your private daily checklist is disabled." });
      }
    } else if (subcommand === "pause") {
      const hours = interaction.options.getInteger("hours", true);
      const pausedUntil = new Date(Date.now() + hours * 60 * 60_000);
      const update = await prisma.user.updateMany({ where: { discordId: interaction.user.id }, data: { pausedUntil, scheduleVersion: { increment: 1 } } });
      if (update.count === 0) throw new Error("Run `/setup` before changing reminder settings.");
      await prisma.notificationJob.updateMany({ where: { user: { discordId: interaction.user.id }, status: "PENDING" }, data: { status: "CANCELLED" } });
      await interaction.editReply({ content: `Reminders are paused for ${hours} hours.` });
    } else if (subcommand === "resume") {
      const update = await prisma.user.updateMany({ where: { discordId: interaction.user.id }, data: { pausedUntil: null, scheduleVersion: { increment: 1 } } });
      if (update.count === 0) throw new Error("Run `/setup` before changing reminder settings.");
      await materializeUserNotifications(interaction.user.id).catch(() => undefined);
      await interaction.editReply({ content: "Reminders resumed using your saved preferences." });
    } else {
      const user = await prisma.user.findUnique({ where: { discordId: interaction.user.id } });
      if (!user) throw new Error("Run `/setup` before testing reminder delivery.");
      try {
        await sendDmTest(client, interaction.user.id);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x287A69).setTitle("DM delivery is working").setDescription("A private test message was sent. Future reminders will be sent only to you.")] });
      } catch (error) {
        const code = isDmUnavailable(error) ? "50007" : error instanceof Error ? error.name : "UNKNOWN";
        await prisma.notificationDeliveryLog.create({ data: { userId: user.id, failedAt: new Date(), failureCode: code } }).catch(() => undefined);
        if (isDmUnavailable(error)) await recordDmStatus(user.id, code as "50007" | "50278").catch(() => undefined);
        await interaction.editReply({ content: isDmUnavailable(error)
          ? "Discord could not deliver a DM. Enable direct messages for a server that this bot shares with you, then run `/reminders test` again. Reminders will be suppressed until that test succeeds."
          : "The test message could not be sent right now. Please try again shortly." });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reminder settings could not be updated right now.";
    await interaction.editReply({ content: message }).catch(() => undefined);
  }
  return true;
}
