import { DateTime } from "luxon";

export interface StreakSnapshot {
  currentStreak: number;
  longestStreak: number;
  totalCompletedDays: number;
}

export function calculateStreakSnapshot(completedLocalDates: readonly string[], today: string): StreakSnapshot {
  const uniqueDescending = [...new Set(completedLocalDates)].sort((a, b) => b.localeCompare(a));
  let longestStreak = 0;
  let run = 0;
  let newer: string | null = null;
  for (const date of [...uniqueDescending].reverse()) {
    const expected = newer ? DateTime.fromISO(newer).plus({ days: 1 }).toISODate() : null;
    run = expected === date ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    newer = date;
  }

  let currentStreak = 0;
  const todayDay = DateTime.fromISO(today, { zone: "utc" });
  const mostRecent = uniqueDescending[0];
  if (mostRecent) {
    const mostRecentDay = DateTime.fromISO(mostRecent, { zone: "utc" });
    const daysBehind = Math.round(todayDay.diff(mostRecentDay, "days").days);
    if (daysBehind === 0 || daysBehind === 1) {
      currentStreak = 1;
      let expectedPrevious = mostRecentDay.minus({ days: 1 }).toISODate();
      for (const date of uniqueDescending.slice(1)) {
        if (date !== expectedPrevious) break;
        currentStreak += 1;
        expectedPrevious = DateTime.fromISO(expectedPrevious, { zone: "utc" }).minus({ days: 1 }).toISODate();
      }
    }
  }
  return { currentStreak, longestStreak, totalCompletedDays: uniqueDescending.length };
}
