import { DateTime } from "luxon";
import { prisma } from "../../db/client.js";
import { getPrayerScheduleForDate } from "../prayer-times/service.js";
import { calculationKey, settingsFromRecord } from "../prayer-times/calculator.js";
import { checklistIdempotencyKey, localMidnightInstant, notificationIdempotencyKey } from "./rules.js";

const PRAYER_ORDER = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"] as const;
const dateDbValue = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

export async function materializeUserNotifications(discordId: string, now = new Date()): Promise<number> {
  const user = await prisma.user.findUnique({ where: { discordId }, include: { reminders: true, prayerSettings: true } });
  if (!user?.timezone || user.latitude === null || user.longitude === null) return 0;
  if (user.pausedUntil && user.pausedUntil > now) return 0;
  const localToday = DateTime.fromJSDate(now, { zone: user.timezone }).toISODate();
  if (!localToday) return 0;

  const reminderByPrayer = new Map(user.reminders.map((setting) => [setting.prayer, setting]));
  const currentCalculationKey = calculationKey(settingsFromRecord(user.prayerSettings));
  const desiredIdempotencyKeys = new Set<string>();
  const candidates: Array<{ idempotencyKey: string; userId: string; scheduleId: string | null; kind: string; dueAt: Date }> = [];
  for (const dayOffset of [0, 1]) {
    const day = DateTime.fromISO(localToday, { zone: user.timezone }).plus({ days: dayOffset }).toISODate();
    if (!day) continue;
    if (user.dailyChecklistEnabled) {
      const checklistKey = checklistIdempotencyKey(user.id, user.scheduleVersion, day);
      desiredIdempotencyKeys.add(checklistKey);
      candidates.push({
        idempotencyKey: checklistKey,
        userId: user.id,
        scheduleId: null,
        kind: "DAILY_CHECKLIST",
        dueAt: localMidnightInstant(day, user.timezone),
      });
    }
    const expectedKeys = PRAYER_ORDER.flatMap((prayer) => {
      const setting = reminderByPrayer.get(prayer);
      if (setting?.enabled === false) return [];
      return [
        notificationIdempotencyKey({ userId: user.id, scheduleVersion: user.scheduleVersion, calculationKey: currentCalculationKey, localDate: day, prayer, kind: "PRAYER" }),
        ...((setting?.minutesBefore ?? 0) > 0 ? [notificationIdempotencyKey({ userId: user.id, scheduleVersion: user.scheduleVersion, calculationKey: currentCalculationKey, localDate: day, prayer, kind: "PRAYER_BEFORE" })] : []),
      ];
    });
    for (const key of expectedKeys) desiredIdempotencyKeys.add(key);
    if (expectedKeys.length === 0) continue;
    const existingCount = await prisma.notificationJob.count({ where: { idempotencyKey: { in: expectedKeys } } });
    if (existingCount === expectedKeys.length) continue;

    const schedule = await getPrayerScheduleForDate(discordId, day);
    const scheduleRows = await prisma.prayerSchedule.findMany({
      where: { userId: user.id, localDate: dateDbValue(day), scheduleVersion: user.scheduleVersion },
      select: { id: true, prayer: true },
    });
    const scheduleIdByPrayer = new Map(scheduleRows.map((row) => [row.prayer, row.id]));
    for (const prayerTime of schedule.prayers) {
      const setting = reminderByPrayer.get(prayerTime.prayer);
      if (setting?.enabled === false) continue;
      const scheduleId = scheduleIdByPrayer.get(prayerTime.prayer);
      if (!scheduleId) continue;
      const beforeMinutes = setting?.minutesBefore ?? 0;
      if (beforeMinutes > 0) {
        const dueAt = new Date(prayerTime.at.getTime() - beforeMinutes * 60_000);
        candidates.push({
          idempotencyKey: notificationIdempotencyKey({ userId: user.id, scheduleVersion: user.scheduleVersion, calculationKey: currentCalculationKey, localDate: day, prayer: prayerTime.prayer, kind: "PRAYER_BEFORE" }),
          userId: user.id, scheduleId, kind: "PRAYER_BEFORE", dueAt,
        });
      }
      candidates.push({
        idempotencyKey: notificationIdempotencyKey({ userId: user.id, scheduleVersion: user.scheduleVersion, calculationKey: currentCalculationKey, localDate: day, prayer: prayerTime.prayer, kind: "PRAYER" }),
        userId: user.id, scheduleId, kind: "PRAYER", dueAt: prayerTime.at,
      });
    }
  }

  await prisma.notificationJob.updateMany({
    where: { userId: user.id, status: "PENDING", idempotencyKey: { notIn: [...desiredIdempotencyKeys] } },
    data: { status: "CANCELLED" },
  });
  if (candidates.length === 0) return 0;
  const inserted = await prisma.notificationJob.createMany({ data: candidates, skipDuplicates: true });
  return inserted.count;
}

export async function materializeAllNotifications(now = new Date()): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const users = await prisma.user.findMany({
      where: { timezone: { not: null }, latitude: { not: null }, longitude: { not: null }, OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }] },
      orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, discordId: true },
    });
    if (users.length === 0) break;
    for (const user of users) {
      try { await materializeUserNotifications(user.discordId, now); }
      catch (error) {
        // Do not include location, timezone, prayer data or raw DB details in logs.
        const { logger } = await import("../../shared/logger.js");
        logger.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Could not prepare a user's reminder schedule");
      }
    }
    cursor = users.at(-1)?.id;
    if (users.length < 200) break;
  }
}

export const prayerNames = PRAYER_ORDER;
