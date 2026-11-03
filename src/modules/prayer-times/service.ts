import { DateTime } from "luxon";
import { prisma } from "../../db/client.js";
import { calculationKey, calculatePrayerTimes, settingsFromRecord, type PrayerCalculationSettings, type PrayerCode } from "./calculator.js";

export interface UserPrayerSchedule {
  timezone: string;
  city: string | null;
  localDate: string;
  timeFormat: "H12" | "H24";
  method: string;
  prayers: Array<{ prayer: PrayerCode; at: Date }>;
}

function localDateDbValue(localDate: string): Date {
  const day = DateTime.fromISO(localDate, { zone: "utc" });
  if (!day.isValid) throw new Error("Invalid local calendar date.");
  return new Date(Date.UTC(day.year, day.month - 1, day.day));
}

export async function getPrayerScheduleForDate(discordId: string, localDate: string): Promise<UserPrayerSchedule> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: { prayerSettings: true },
  });
  if (!user?.timezone || user.latitude === null || user.longitude === null) {
    throw new Error("Add a confirmed city with coordinates using `/location` before viewing prayer times.");
  }
  if (!DateTime.fromISO(localDate, { zone: user.timezone }).isValid) throw new Error("Your saved timezone is invalid. Update it with `/timezone`.");

  const settings = settingsFromRecord(user.prayerSettings);
  const key = calculationKey(settings);
  const dateValue = localDateDbValue(localDate);
  const cached = await prisma.prayerSchedule.findMany({
    where: { userId: user.id, localDate: dateValue, scheduleVersion: user.scheduleVersion, timezone: user.timezone, calculationKey: key },
    select: { prayer: true, prayerAt: true },
  });
  const prayerOrder: PrayerCode[] = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"];
  const byPrayer = new Map(cached.map((row) => [row.prayer, row.prayerAt]));
  let prayers = prayerOrder.flatMap((prayer) => {
    const at = byPrayer.get(prayer);
    return at ? [{ prayer, at }] : [];
  });

  if (prayers.length !== prayerOrder.length) {
    prayers = calculatePrayerTimes({
      latitude: user.latitude,
      longitude: user.longitude,
      timezone: user.timezone,
      localDate,
      settings,
    });
    await prisma.$transaction(prayers.map(({ prayer, at }) => prisma.prayerSchedule.upsert({
      where: { userId_localDate_prayer_scheduleVersion: { userId: user.id, localDate: dateValue, prayer, scheduleVersion: user.scheduleVersion } },
      create: { userId: user.id, localDate: dateValue, prayer, prayerAt: at, timezone: user.timezone!, scheduleVersion: user.scheduleVersion, calculationKey: key },
      update: { prayerAt: at, timezone: user.timezone!, calculationKey: key },
    })));
  }

  return {
    timezone: user.timezone,
    city: user.city,
    localDate,
    timeFormat: user.timeFormat,
    method: settings.calculationMethod,
    prayers,
  };
}

export async function getPrayerSchedule(discordId: string, now = new Date()): Promise<UserPrayerSchedule> {
  const user = await prisma.user.findUnique({ where: { discordId }, select: { timezone: true } });
  if (!user?.timezone) throw new Error("Set up and confirm your timezone before viewing prayer times.");
  const localDate = DateTime.fromJSDate(now, { zone: user.timezone }).toISODate();
  if (!localDate) throw new Error("Could not determine today's local date.");
  return getPrayerScheduleForDate(discordId, localDate);
}

export async function getPrayerSettings(discordId: string): Promise<PrayerCalculationSettings> {
  const user = await prisma.user.findUnique({ where: { discordId }, include: { prayerSettings: true } });
  return settingsFromRecord(user?.prayerSettings ?? null);
}

export async function updatePrayerSettings(discordId: string, settings: PrayerCalculationSettings): Promise<void> {
  const nextKey = calculationKey(settings);
  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { discordId }, include: { prayerSettings: true } });
    if (!user) throw new Error("Run `/setup` and confirm your timezone before changing prayer settings.");
    const current = settingsFromRecord(user.prayerSettings);
    if (calculationKey(current) === nextKey) return;

    await transaction.userPrayerSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...settings },
      update: settings,
    });
    await transaction.user.update({ where: { id: user.id }, data: { scheduleVersion: { increment: 1 } } });
  });
}
