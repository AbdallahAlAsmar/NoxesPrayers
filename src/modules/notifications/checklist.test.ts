import { describe, expect, it } from "vitest";
import { buildDailyChecklist } from "./checklist.js";

const at = (day: number, hour: number): Date => new Date(`2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);
const prayers = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"].map((prayer, index) => ({
  prayer: prayer as "FAJR" | "DHUHR" | "ASR" | "MAGHRIB" | "ISHA",
  at: at(3, [5, 12, 15, 18, 20][index]!),
}));

describe("daily prayer checklist", () => {
  it("distinguishes completed prayers, closed missed windows, and Isha still open until Fajr", () => {
    expect(buildDailyChecklist({ prayerTimes: prayers, nextFajr: at(4, 5), completedPrayers: ["FAJR", "DHUHR"], now: at(4, 0) })).toEqual([
      { prayer: "FAJR", status: "COMPLETED" },
      { prayer: "DHUHR", status: "COMPLETED" },
      { prayer: "ASR", status: "MISSED" },
      { prayer: "MAGHRIB", status: "MISSED" },
      { prayer: "ISHA", status: "STILL_OPEN" },
    ]);
  });

  it("does not mark the next prayer missed before its scheduled start", () => {
    expect(buildDailyChecklist({ prayerTimes: prayers, nextFajr: at(4, 5), completedPrayers: [], now: at(3, 4) })[0]).toEqual({ prayer: "FAJR", status: "STILL_OPEN" });
  });
});
