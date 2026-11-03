import { describe, expect, it } from "vitest";
import { calculatePrayerTimes, formatPrayerTime, settingsFromRecord } from "./calculator.js";

describe("prayer time calculation", () => {
  it("matches the Adhan upstream Turkey method reference for Istanbul", () => {
    const settings = { ...settingsFromRecord(null), calculationMethod: "TURKEY" };
    const times = calculatePrayerTimes({ latitude: 41.005616, longitude: 28.97638, timezone: "Europe/Istanbul", localDate: "2020-04-16", settings });
    expect(times.map(({ at }) => formatPrayerTime(at, "Europe/Istanbul", "H12"))).toEqual([
      "4:44 AM", "1:09 PM", "4:53 PM", "7:52 PM", "9:19 PM",
    ]);
  });

  it("uses each saved manual adjustment in minutes", () => {
    const baseSettings = settingsFromRecord(null);
    const input = { latitude: 31.778, longitude: 35.235, timezone: "Asia/Jerusalem", localDate: "2026-11-03" };
    const base = calculatePrayerTimes({ ...input, settings: baseSettings });
    const adjusted = calculatePrayerTimes({ ...input, settings: { ...baseSettings, fajrAdjustmentMinutes: 7 } });
    expect(adjusted[0]!.at.getTime() - base[0]!.at.getTime()).toBe(7 * 60_000);
  });

  it("changes Asr time when Hanafi shadow length is selected", () => {
    const settings = settingsFromRecord(null);
    const input = { latitude: 35.775, longitude: -78.6336, timezone: "America/New_York", localDate: "2015-12-01" };
    const standard = calculatePrayerTimes({ ...input, settings });
    const hanafi = calculatePrayerTimes({ ...input, settings: { ...settings, asrMethod: "HANAFI" } });
    expect(hanafi[2]!.at.getTime()).toBeGreaterThan(standard[2]!.at.getTime());
  });

  it("formats a non-whole-hour timezone offset using the user's timezone", () => {
    const at = new Date("2026-01-01T12:00:00.000Z");
    expect(formatPrayerTime(at, "Asia/Kathmandu", "H24")).toBe("17:45");
  });

  it("handles a daylight-saving transition using an IANA timezone", () => {
    const settings = settingsFromRecord(null);
    const before = calculatePrayerTimes({ latitude: 51.5072, longitude: -0.1276, timezone: "Europe/London", localDate: "2026-03-28", settings });
    const after = calculatePrayerTimes({ latitude: 51.5072, longitude: -0.1276, timezone: "Europe/London", localDate: "2026-03-29", settings });
    expect(formatPrayerTime(before[0]!.at, "Europe/London", "H24")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatPrayerTime(after[0]!.at, "Europe/London", "H24")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatPrayerTime(new Date("2026-03-29T00:30:00Z"), "Europe/London", "H24")).toBe("00:30");
    expect(formatPrayerTime(new Date("2026-03-29T01:30:00Z"), "Europe/London", "H24")).toBe("02:30");
  });

  it("applies the chosen high-latitude rule without invalid times", () => {
    const settings = settingsFromRecord(null);
    const input = { latitude: 69.6492, longitude: 18.9553, timezone: "Europe/Oslo", localDate: "2026-06-21" };
    const recommended = calculatePrayerTimes({ ...input, settings });
    const middle = calculatePrayerTimes({ ...input, settings: { ...settings, highLatitudeRule: "MIDDLE_OF_THE_NIGHT" } });
    expect(recommended).toHaveLength(5);
    expect(recommended.every(({ at }) => Number.isFinite(at.getTime()))).toBe(true);
    expect(middle[0]!.at.getTime()).not.toBe(recommended[0]!.at.getTime());
  });

  it("rejects invalid coordinates and settings", () => {
    const settings = settingsFromRecord(null);
    expect(() => calculatePrayerTimes({ latitude: 95, longitude: 0, timezone: "UTC", localDate: "2026-01-01", settings })).toThrow(/coordinates/);
    expect(() => calculatePrayerTimes({ latitude: 0, longitude: 0, timezone: "UTC", localDate: "2026-01-01", settings: { ...settings, fajrAngle: 45 } })).toThrow(/Fajr angle/);
  });
});
