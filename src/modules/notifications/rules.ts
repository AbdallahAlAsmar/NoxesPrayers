import { DateTime } from "luxon";
import type { PrayerCode } from "../prayer-times/calculator.js";

export type NotificationKind = "PRAYER" | "PRAYER_BEFORE";

export function checklistIdempotencyKey(userId: string, scheduleVersion: number, localDate: string): string {
  return `${userId}:${scheduleVersion}:${localDate}:DAILY_CHECKLIST`;
}

export function localMidnightInstant(localDate: string, timezone: string): Date {
  const local = DateTime.fromISO(localDate, { zone: timezone });
  if (!local.isValid || local.toISODate() !== localDate) throw new Error("A valid local date and IANA timezone are required.");
  return local.startOf("day").toJSDate();
}

export function notificationIdempotencyKey(input: {
  userId: string;
  scheduleVersion: number;
  calculationKey: string;
  localDate: string;
  prayer: PrayerCode;
  kind: NotificationKind;
}): string {
  const kind = input.kind === "PRAYER_BEFORE" ? "BEFORE" : "AT";
  return `${input.userId}:${input.scheduleVersion}:${input.calculationKey}:${input.localDate}:${input.prayer}:${kind}`;
}

export function notificationIsExpired(dueAt: Date, now: Date, maxDelayMs = 15 * 60_000): boolean {
  return dueAt.getTime() < now.getTime() - maxDelayMs;
}
