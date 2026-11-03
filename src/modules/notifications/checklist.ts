import type { PrayerScheduleResult, PrayerCode } from "../prayer-times/calculator.js";

export type ChecklistStatus = "COMPLETED" | "MISSED" | "STILL_OPEN";
export interface ChecklistItem { prayer: PrayerCode; status: ChecklistStatus }

export function buildDailyChecklist(input: {
  prayerTimes: readonly PrayerScheduleResult[];
  nextFajr: Date;
  completedPrayers: readonly PrayerCode[];
  now: Date;
}): ChecklistItem[] {
  const { prayerTimes, nextFajr, completedPrayers, now } = input;
  return prayerTimes.map((entry, index) => {
    if (completedPrayers.includes(entry.prayer)) return { prayer: entry.prayer, status: "COMPLETED" };
    const next = prayerTimes[index + 1]?.at ?? nextFajr;
    if (now.getTime() < entry.at.getTime()) return { prayer: entry.prayer, status: "STILL_OPEN" };
    return { prayer: entry.prayer, status: now.getTime() < next.getTime() ? "STILL_OPEN" : "MISSED" };
  });
}
