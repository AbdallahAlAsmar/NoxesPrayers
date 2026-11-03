import { DateTime } from "luxon";
import { prisma } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { PrayerCode } from "../prayer-times/calculator.js";
import { getPrayerScheduleForDate } from "../prayer-times/service.js";
import { calculateStreakSnapshot } from "../streaks/rules.js";
import { activePrayerDate, isWithinPrayerWindow } from "./rules.js";

export const PRAYER_ORDER: PrayerCode[] = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"];
export const prayerDateValue = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }

async function activeUser(discordId: string) {
  const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true, timezone: true, scheduleVersion: true } });
  if (!user?.timezone) throw new Error("Set up and confirm your timezone and location before tracking prayers.");
  return user;
}

async function assertPrayerWindow(discordId: string, prayer: PrayerCode, prayerDate: string, now: Date): Promise<void> {
  const date = DateTime.fromISO(prayerDate, { zone: "utc" });
  if (!date.isValid || date.toISODate() !== prayerDate) throw new Error("Choose a valid local prayer date.");
  const [currentDay, nextDay] = await Promise.all([
    getPrayerScheduleForDate(discordId, prayerDate),
    getPrayerScheduleForDate(discordId, date.plus({ days: 1 }).toISODate()!),
  ]);
  const index = PRAYER_ORDER.indexOf(prayer);
  if (index < 0) throw new Error("Choose one of the five daily prayers.");
  const startsAt = currentDay.prayers[index]?.at;
  const endsAt = index === PRAYER_ORDER.length - 1 ? nextDay.prayers[0]?.at : currentDay.prayers[index + 1]?.at;
  if (!startsAt || !endsAt || !isWithinPrayerWindow(now, startsAt, endsAt)) {
    throw new Error(`The ${prayer.toLowerCase()} completion window has ended or has not started. A prayer can be logged from its scheduled start until the next prayer begins.`);
  }
}

export async function refreshStreak(transaction: Prisma.TransactionClient, userId: string, activePrayerDate: string): Promise<void> {
  const grouped = await transaction.prayerRecord.groupBy({ where: { userId }, by: ["prayerDate"], _count: { _all: true } });
  const completedDates = grouped.filter((row) => row._count._all === 5).map((row) => dateKey(row.prayerDate));
  const snapshot = calculateStreakSnapshot(completedDates, activePrayerDate);
  const allRecords = await transaction.prayerRecord.count({ where: { userId } });
  const lastFullyCompletedPrayerDate = snapshot.currentStreak > 0
    ? prayerDateValue(completedDates.sort().at(-1)!)
    : (completedDates.sort().at(-1) ? prayerDateValue(completedDates.sort().at(-1)!) : null);
  await transaction.userStreak.upsert({
    where: { userId },
    create: { userId, ...snapshot, totalCompletedPrayers: allRecords, lastFullyCompletedPrayerDate },
    update: { ...snapshot, totalCompletedPrayers: allRecords, lastFullyCompletedPrayerDate },
  });
}

export async function finalizePreviousPrayerDay(discordId: string, now = new Date()): Promise<boolean> {
  const user = await activeUser(discordId);
  const localNow = DateTime.fromJSDate(now, { zone: user.timezone! });
  const today = localNow.toISODate();
  if (!today) return false;
  const schedule = await getPrayerScheduleForDate(discordId, today);
  if (now < schedule.prayers[0]!.at) return false;
  const previousDate = localNow.minus({ days: 1 }).toISODate();
  if (!previousDate) return false;
  const date = prayerDateValue(previousDate);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "muslim_prayer_bot"."User" WHERE "id" = ${user.id} FOR UPDATE`;
    const alreadyFinalized = await tx.dailyPrayerProgress.findUnique({ where: { userId_prayerDate: { userId: user.id, prayerDate: date } }, select: { finalizedAt: true, fullyCompletedAt: true } });
    if (alreadyFinalized?.finalizedAt) return false;
    const completedCount = await tx.prayerRecord.count({ where: { userId: user.id, prayerDate: date } });
    await tx.dailyPrayerProgress.upsert({
      where: { userId_prayerDate: { userId: user.id, prayerDate: date } },
      create: { userId: user.id, prayerDate: date, completedCount, finalizedAt: now, fullyCompletedAt: completedCount === 5 ? now : null },
      update: { completedCount, finalizedAt: now, fullyCompletedAt: completedCount === 5 ? alreadyFinalized?.fullyCompletedAt ?? now : null },
    });
    await refreshStreak(tx, user.id, today);
    return true;
  });
}

export async function currentPrayerDate(discordId: string, now = new Date()): Promise<{ date: string; timezone: string }> {
  const user = await activeUser(discordId);
  const today = DateTime.fromJSDate(now, { zone: user.timezone! }).toISODate();
  if (!today) throw new Error("Could not determine today's local date.");
  const schedule = await getPrayerScheduleForDate(discordId, today);
  return { date: activePrayerDate(today, now, schedule.prayers[0]!.at), timezone: user.timezone! };
}

export interface PrayerProgress {
  prayerDate: string;
  completed: PrayerCode[];
  pending: PrayerCode[];
  currentStreak: number;
  longestStreak: number;
  totalCompletedDays: number;
  totalCompletedPrayers: number;
  dailyPercentage: number;
  weeklyPrayerCount: number;
  weeklyCompletedDays: number;
  weeklyPercentage: number;
}

export async function getPrayerProgress(discordId: string, now = new Date()): Promise<PrayerProgress> {
  const user = await activeUser(discordId);
  const localNow = DateTime.fromJSDate(now, { zone: user.timezone! });
  const localCalendarDate = localNow.toISODate();
  if (!localCalendarDate) throw new Error("Could not determine today's local prayer date.");
  const currentSchedule = await getPrayerScheduleForDate(discordId, localCalendarDate);
  const today = activePrayerDate(localCalendarDate, now, currentSchedule.prayers[0]!.at);
  if (!today) throw new Error("Could not determine today's local prayer date.");
  const start = prayerDateValue(DateTime.fromISO(today, { zone: "utc" }).minus({ days: 6 }).toISODate()!);
  const todayValue = prayerDateValue(today);
  const [records, streak, totalCompletedPrayers, weeklyRecords, weeklyDays] = await Promise.all([
    prisma.prayerRecord.findMany({ where: { userId: user.id, prayerDate: todayValue }, select: { prayer: true } }),
    prisma.userStreak.findUnique({ where: { userId: user.id } }),
    prisma.prayerRecord.count({ where: { userId: user.id } }),
    prisma.prayerRecord.count({ where: { userId: user.id, prayerDate: { gte: start, lte: todayValue } } }),
    prisma.dailyPrayerProgress.count({ where: { userId: user.id, fullyCompletedAt: { not: null }, prayerDate: { gte: start, lte: todayValue } } }),
  ]);
  const completed = PRAYER_ORDER.filter((prayer) => records.some((record) => record.prayer === prayer));
  return {
    prayerDate: today,
    completed,
    pending: PRAYER_ORDER.filter((prayer) => !completed.includes(prayer)),
    currentStreak: streak?.currentStreak ?? 0,
    longestStreak: streak?.longestStreak ?? 0,
    totalCompletedDays: streak?.totalCompletedDays ?? 0,
    totalCompletedPrayers,
    dailyPercentage: Math.round(completed.length / 5 * 100),
    weeklyPrayerCount: weeklyRecords,
    weeklyCompletedDays: weeklyDays,
    weeklyPercentage: Math.round(weeklyRecords / 35 * 100),
  };
}

export async function recordPrayer(discordId: string, prayer: PrayerCode, prayerDate: string, now = new Date()): Promise<PrayerProgress> {
  const user = await activeUser(discordId);
  await assertPrayerWindow(discordId, prayer, prayerDate, now);
  const day = prayerDateValue(prayerDate);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "muslim_prayer_bot"."User" WHERE "id" = ${user.id} FOR UPDATE`;
      await tx.prayerRecord.create({ data: { userId: user.id, prayerDate: day, prayer, completedAt: now, source: "SELF_REPORTED" } });
      const completedCount = await tx.prayerRecord.count({ where: { userId: user.id, prayerDate: day } });
      await tx.dailyPrayerProgress.upsert({
        where: { userId_prayerDate: { userId: user.id, prayerDate: day } },
        create: { userId: user.id, prayerDate: day, completedCount, fullyCompletedAt: completedCount === 5 ? now : null },
        update: { completedCount, fullyCompletedAt: completedCount === 5 ? now : null },
      });
      await refreshStreak(tx, user.id, prayerDate);
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new Error("That prayer has already been recorded for this local prayer day.");
    }
    throw error;
  }
  return getPrayerProgress(discordId, now);
}

export async function undoRecentPrayer(discordId: string, prayer: PrayerCode, prayerDate: string, now = new Date()): Promise<PrayerProgress> {
  const user = await activeUser(discordId);
  const localDate = DateTime.fromJSDate(now, { zone: user.timezone! }).toISODate();
  if (!localDate || !DateTime.fromISO(prayerDate, { zone: "utc" }).isValid) throw new Error("Could not determine the prayer date.");
  const day = prayerDateValue(prayerDate);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "muslim_prayer_bot"."User" WHERE "id" = ${user.id} FOR UPDATE`;
    const record = await tx.prayerRecord.findUnique({ where: { userId_prayerDate_prayer: { userId: user.id, prayerDate: day, prayer } } });
    if (!record) throw new Error("There is no matching prayer record to undo today.");
    if (now.getTime() - record.completedAt.getTime() > 10 * 60_000) throw new Error("For safety, a prayer entry can only be undone within 10 minutes. Contact support for older corrections.");
    await tx.prayerRecord.delete({ where: { id: record.id } });
    const completedCount = await tx.prayerRecord.count({ where: { userId: user.id, prayerDate: day } });
    await tx.dailyPrayerProgress.upsert({
      where: { userId_prayerDate: { userId: user.id, prayerDate: day } },
      create: { userId: user.id, prayerDate: day, completedCount },
      update: { completedCount, fullyCompletedAt: completedCount === 5 ? record.completedAt : null },
    });
    await refreshStreak(tx, user.id, prayerDate);
  });
  return getPrayerProgress(discordId, now);
}
