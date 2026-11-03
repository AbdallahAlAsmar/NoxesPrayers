import { DateTime } from "luxon";

export function isWithinPrayerWindow(now: Date, startsAt: Date, nextPrayerAt: Date): boolean {
  return now.getTime() >= startsAt.getTime() && now.getTime() < nextPrayerAt.getTime();
}

export function activePrayerDate(localCalendarDate: string, now: Date, fajrAt: Date): string {
  return now < fajrAt
    ? DateTime.fromISO(localCalendarDate, { zone: "utc" }).minus({ days: 1 }).toISODate()!
    : localCalendarDate;
}
