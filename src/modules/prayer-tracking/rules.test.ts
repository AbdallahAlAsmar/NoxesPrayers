import { describe, expect, it } from "vitest";
import { activePrayerDate, isWithinPrayerWindow } from "./rules.js";

describe("prayer completion windows", () => {
  const startsAt = new Date("2026-11-03T04:00:00Z");
  const nextPrayer = new Date("2026-11-03T11:00:00Z");

  it("includes the prayer start and excludes the next prayer start", () => {
    expect(isWithinPrayerWindow(startsAt, startsAt, nextPrayer)).toBe(true);
    expect(isWithinPrayerWindow(new Date(nextPrayer.getTime() - 1), startsAt, nextPrayer)).toBe(true);
    expect(isWithinPrayerWindow(nextPrayer, startsAt, nextPrayer)).toBe(false);
    expect(isWithinPrayerWindow(new Date(startsAt.getTime() - 1), startsAt, nextPrayer)).toBe(false);
  });

  it("keeps the prior prayer date active until Fajr begins", () => {
    const localDate = "2026-11-03";
    const fajr = new Date("2026-11-03T04:30:00Z");
    expect(activePrayerDate(localDate, new Date(fajr.getTime() - 1), fajr)).toBe("2026-11-02");
    expect(activePrayerDate(localDate, fajr, fajr)).toBe("2026-11-03");
  });
});
