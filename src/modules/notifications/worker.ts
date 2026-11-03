import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from "discord.js";
import { DateTime } from "luxon";
import { prisma } from "../../db/client.js";
import { logger } from "../../shared/logger.js";
import { notificationIsExpired } from "./rules.js";
import { calculationKey, settingsFromRecord } from "../prayer-times/calculator.js";
import { getPrayerScheduleForDate } from "../prayer-times/service.js";
import { buildDailyChecklist } from "./checklist.js";

const DM_STATUS_CODES = ["50007", "50278", "DM_TEST_OK"] as const;

interface ClaimedJob { id: string }
const MAX_DELAY_MS = 15 * 60_000;

async function claimOne(): Promise<string | null> {
  const claimed = await prisma.$queryRaw<ClaimedJob[]>`
    WITH candidate AS (
      SELECT "id" FROM "muslim_prayer_bot"."NotificationJob"
      WHERE "status" = 'PENDING'::"muslim_prayer_bot"."JobStatus"
        AND "dueAt" <= NOW() AND "attempts" = 0
      ORDER BY "dueAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "muslim_prayer_bot"."NotificationJob" AS job
    SET "status" = 'PROCESSING'::"muslim_prayer_bot"."JobStatus",
        "lockedUntil" = NOW() + INTERVAL '5 minutes', "attempts" = "attempts" + 1
    FROM candidate WHERE job."id" = candidate."id" RETURNING job."id"
  `;
  return claimed[0]?.id ?? null;
}

async function latestDeliveryFailure(userId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ failureCode: string | null }>>`
    SELECT "failureCode" FROM "muslim_prayer_bot"."NotificationDeliveryLog"
    WHERE "userId" = ${userId} AND "failureCode" IN ('50007', '50278', 'DM_TEST_OK')
    ORDER BY GREATEST(COALESCE("deliveredAt", '-infinity'::timestamptz), COALESCE("failedAt", '-infinity'::timestamptz)) DESC,
      ("failureCode" = 'DM_TEST_OK') DESC LIMIT 1
  `;
  return rows[0]?.failureCode ?? null;
}

export async function recordDmStatus(userId: string, code: typeof DM_STATUS_CODES[number]): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "muslim_prayer_bot"."User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.notificationDeliveryLog.findFirst({
      where: { userId, failureCode: { in: [...DM_STATUS_CODES] } },
      orderBy: [{ failedAt: "desc" }, { deliveredAt: "desc" }],
    });
    const data = code === "DM_TEST_OK"
      ? { jobId: null, failureCode: code, failedAt: null, deliveredAt: now }
      : { jobId: null, failureCode: code, failedAt: now, deliveredAt: null };
    const marker = existing
      ? await tx.notificationDeliveryLog.update({ where: { id: existing.id }, data })
      : await tx.notificationDeliveryLog.create({ data: { userId, ...data } });
    await tx.notificationDeliveryLog.deleteMany({ where: { userId, failureCode: { in: [...DM_STATUS_CODES] }, id: { not: marker.id } } });
  });
}

function getErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code).slice(0, 80);
  if (typeof error === "object" && error !== null && "status" in error) return `HTTP_${String(error.status)}`.slice(0, 80);
  return error instanceof Error ? error.name.slice(0, 80) : "UNKNOWN";
}

async function markFailed(jobId: string, userId: string, code: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.notificationJob.updateMany({ where: { id: jobId, status: "PROCESSING" }, data: { status: "FAILED", lockedUntil: null, lastErrorCode: code } }),
    prisma.notificationDeliveryLog.create({ data: { jobId, userId, failedAt: now, failureCode: code } }),
  ]);
  if (code === "50007" || code === "50278") await recordDmStatus(userId, code);
}

async function processJob(client: Client, jobId: string): Promise<void> {
  const job = await prisma.notificationJob.findUnique({ where: { id: jobId }, include: { user: { include: { prayerSettings: true } }, schedule: true } });
  if (!job || job.status !== "PROCESSING") return;
  if (job.kind === "DAILY_CHECKLIST") {
    await processDailyChecklistJob(client, job);
    return;
  }
  const currentCalculationKey = calculationKey(settingsFromRecord(job.user.prayerSettings));
  if (!job.schedule || job.schedule.scheduleVersion !== job.user.scheduleVersion || job.schedule.calculationKey !== currentCalculationKey || (job.user.pausedUntil && job.user.pausedUntil > new Date())) {
    await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED", lockedUntil: null } });
    return;
  }
  if (notificationIsExpired(job.dueAt, new Date(), MAX_DELAY_MS)) {
    await markFailed(job.id, job.userId, "EXPIRED_DELAYED");
    return;
  }
  if (["50007", "50278"].includes((await latestDeliveryFailure(job.userId)) ?? "")) {
    await markFailed(job.id, job.userId, "DM_UNAVAILABLE_SUPPRESSED");
    return;
  }
  const reminder = await prisma.userReminderSettings.findUnique({ where: { userId_prayer: { userId: job.userId, prayer: job.schedule.prayer } } });
  if (reminder?.enabled === false) {
    await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED", lockedUntil: null } });
    return;
  }
  const prayerNames: Record<string, string> = { FAJR: "Fajr", DHUHR: "Dhuhr", ASR: "Asr", MAGHRIB: "Maghrib", ISHA: "Isha" };
  const prayer = prayerNames[job.schedule.prayer] ?? job.schedule.prayer;
  const time = DateTime.fromJSDate(job.schedule.prayerAt, { zone: job.schedule.timezone }).toFormat(job.user.timeFormat === "H12" ? "h:mm a" : "HH:mm");
  const isBefore = job.kind === "PRAYER_BEFORE";
  const embed = new EmbedBuilder().setColor(0x287A69).setTitle(isBefore ? `${prayer} is approaching` : `${prayer} Time`)
    .setDescription(isBefore
      ? `${prayer} is expected at **${time}** (${job.schedule.timezone}).\n\nMay Allah make it easy for you to prepare.`
      : `It is now time for ${prayer}.\n\nMay Allah make it easy for you to maintain your prayers.`);
  try {
    const latestUser = await prisma.user.findUnique({ where: { id: job.userId }, include: { prayerSettings: true } });
    if (!latestUser || latestUser.scheduleVersion !== job.schedule.scheduleVersion
      || calculationKey(settingsFromRecord(latestUser.prayerSettings)) !== job.schedule.calculationKey
      || (latestUser.pausedUntil && latestUser.pausedUntil > new Date())) {
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED", lockedUntil: null } });
      return;
    }
    const latestReminder = await prisma.userReminderSettings.findUnique({ where: { userId_prayer: { userId: job.userId, prayer: job.schedule.prayer } } });
    if (latestReminder?.enabled === false) {
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED", lockedUntil: null } });
      return;
    }
    const recipient = await client.users.fetch(job.user.discordId);
    const freshComponents = !isBefore && (latestReminder?.completionPrompt ?? true)
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`prayer:complete:${job.id}`).setLabel("I Prayed").setStyle(ButtonStyle.Success))]
      : [];
    await recipient.send({ embeds: [embed], components: freshComponents });
    await prisma.$transaction([
      prisma.notificationJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), lockedUntil: null, lastErrorCode: null } }),
      prisma.notificationDeliveryLog.create({ data: { jobId: job.id, userId: job.userId, deliveredAt: new Date() } }),
    ]);
  } catch (error) {
    const code = getErrorCode(error);
    await markFailed(job.id, job.userId, code);
    logger.warn({ errorCode: code, jobId: job.id }, "Prayer reminder delivery failed");
  }
}

async function processDailyChecklistJob(client: Client, job: { id: string; userId: string; dueAt: Date; idempotencyKey: string }): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: job.userId } });
  if (!user || !user.timezone || !user.dailyChecklistEnabled || user.pausedUntil && user.pausedUntil > new Date()
    || !job.idempotencyKey.startsWith(`${user.id}:${user.scheduleVersion}:`)) {
    await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED", lockedUntil: null } });
    return;
  }
  if (notificationIsExpired(job.dueAt, new Date(), MAX_DELAY_MS)) {
    await markFailed(job.id, job.userId, "EXPIRED_DELAYED");
    return;
  }
  if (["50007", "50278"].includes((await latestDeliveryFailure(job.userId)) ?? "")) {
    await markFailed(job.id, job.userId, "DM_UNAVAILABLE_SUPPRESSED");
    return;
  }
  const localDate = DateTime.fromJSDate(job.dueAt, { zone: user.timezone }).toISODate();
  if (!localDate) {
    await markFailed(job.id, job.userId, "INVALID_LOCAL_DATE");
    return;
  }
  const reportDate = DateTime.fromISO(localDate, { zone: user.timezone }).minus({ days: 1 }).toISODate();
  if (!reportDate) {
    await markFailed(job.id, job.userId, "INVALID_LOCAL_DATE");
    return;
  }
  const [day, nextDay, records] = await Promise.all([
    getPrayerScheduleForDate(user.discordId, reportDate),
    getPrayerScheduleForDate(user.discordId, localDate),
    prisma.prayerRecord.findMany({ where: { userId: user.id, prayerDate: new Date(`${reportDate}T00:00:00.000Z`) }, select: { prayer: true } }),
  ]);
  const prayerNames: Record<string, string> = { FAJR: "Fajr", DHUHR: "Dhuhr", ASR: "Asr", MAGHRIB: "Maghrib", ISHA: "Isha" };
  const items = buildDailyChecklist({ prayerTimes: day.prayers, nextFajr: nextDay.prayers[0]!.at, completedPrayers: records.map((record) => record.prayer), now: new Date() });
  const completed = items.filter((item) => item.status === "COMPLETED").map((item) => `✅ ${prayerNames[item.prayer]}`);
  const missed = items.filter((item) => item.status === "MISSED").map((item) => `❌ ${prayerNames[item.prayer]}`);
  const stillOpen = items.filter((item) => item.status === "STILL_OPEN").map((item) => `⏳ ${prayerNames[item.prayer]}`);
  const description = [
    `**Completed**\n${completed.join(" · ") || "None reported"}`,
    `**Missed (window ended)**\n${missed.join(" · ") || "None"}`,
    ...(stillOpen.length ? [`**Still open**\n${stillOpen.join(" · ")} — you can still self-report until its prayer window ends.`] : []),
  ].join("\n\n");
  try {
    const recipient = await client.users.fetch(user.discordId);
    await recipient.send({ embeds: [new EmbedBuilder().setColor(0x287A69).setTitle(`Prayer checklist · ${reportDate}`).setDescription(description).setFooter({ text: "Private summary · completion is self-reported" })] });
    await prisma.$transaction([
      prisma.notificationJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), lockedUntil: null, lastErrorCode: null } }),
      prisma.notificationDeliveryLog.create({ data: { jobId: job.id, userId: job.userId, deliveredAt: new Date() } }),
    ]);
  } catch (error) {
    const code = getErrorCode(error);
    await markFailed(job.id, job.userId, code);
    logger.warn({ errorCode: code, jobId: job.id }, "Daily checklist delivery failed");
  }
}

export async function processDueNotifications(client: Client, limit = 20): Promise<void> {
  for (let count = 0; count < limit; count += 1) {
    const jobId = await claimOne();
    if (!jobId) return;
    try {
      await processJob(client, jobId);
    } catch (error) {
      const code = getErrorCode(error);
      await prisma.notificationJob.updateMany({ where: { id: jobId, status: "PROCESSING" }, data: { status: "FAILED", lockedUntil: null, lastErrorCode: code } });
      logger.error({ errorCode: code, jobId }, "Reminder worker failed to process job");
    }
  }
}

export async function recoverNotificationJobs(): Promise<number> {
  const recovered = await prisma.notificationJob.updateMany({ where: { status: "PROCESSING", lockedUntil: { lt: new Date() } }, data: { status: "FAILED", lockedUntil: null, lastErrorCode: "WORKER_LEASE_EXPIRED" } });
  return recovered.count;
}

export async function sendDmTest(client: Client, discordId: string): Promise<void> {
  const recipient = await client.users.fetch(discordId);
  await recipient.send({ content: "Private prayer reminder delivery is working. You can manage each prayer with `/reminders settings`." });
  const user = await prisma.user.findUniqueOrThrow({ where: { discordId }, select: { id: true } });
  await recordDmStatus(user.id, "DM_TEST_OK");
}

export function isDmUnavailable(error: unknown): boolean { return ["50007", "50278"].includes(getErrorCode(error)); }
