import { describe, expect, it } from "vitest";
import {
  estimateTimezonesFromLocalClock,
  formatUtcOffset,
  getUtcOffsetMinutes,
  normalizeIanaTimezone,
  parseLocalClock,
} from "./timezone.js";

describe("parseLocalClock", () => {
  it.each([
    ["12:21 AM", 21],
    ["12:21 PM", 12 * 60 + 21],
    ["22:10", 22 * 60 + 10],
    ["5:33 PM", 17 * 60 + 33],
    ["17:33", 17 * 60 + 33],
    ["00:15", 15],
  ])("parses %s", (input, expected) => {
    expect(parseLocalClock(input)).toEqual({ ok: true, minuteOfDay: expected });
  });

  it("rejects a one-digit 1–12 hour without AM/PM as ambiguous", () => {
    expect(parseLocalClock("5:33")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it.each(["24:00", "13:40 PM", "12:60", "noon", "9:5"]) (
    "rejects invalid input %s",
    (input) => expect(parseLocalClock(input)).toEqual({ ok: false, reason: "invalid" }),
  );
});

describe("timezone offsets", () => {
  it("supports minute-level offsets", () => {
    const instant = new Date("2026-01-15T10:20:00.000Z");
    expect(getUtcOffsetMinutes("Asia/Kathmandu", instant)).toBe(345);
    expect(getUtcOffsetMinutes("Australia/Eucla", instant)).toBe(525);
    expect(formatUtcOffset(-210)).toBe("UTC−03:30");
  });

  it("uses the timezone rules in effect at the supplied instant", () => {
    expect(getUtcOffsetMinutes("America/New_York", new Date("2026-03-08T06:59:00Z"))).toBe(-300);
    expect(getUtcOffsetMinutes("America/New_York", new Date("2026-03-08T07:00:00Z"))).toBe(-240);
  });

  it("keeps both possible date-line offsets for a clock-only estimate", () => {
    const submittedAt = new Date("2026-01-15T10:00:00.000Z");
    const candidates = estimateTimezonesFromLocalClock(0, submittedAt);
    expect(candidates.some((candidate) => candidate.offsetMinutes === 840)).toBe(true);
    expect(candidates.some((candidate) => candidate.offsetMinutes === -600)).toBe(true);
  });

  it("finds a fractional-hour timezone from a local-time estimate", () => {
    const submittedAt = new Date("2026-01-15T10:20:00.000Z");
    const candidates = estimateTimezonesFromLocalClock(16 * 60 + 5, submittedAt);
    expect(candidates.some((candidate) =>
      candidate.offsetMinutes === 345 && ["Asia/Kathmandu", "Asia/Katmandu"].includes(candidate.timeZone),
    )).toBe(true);
  });

  it("validates IANA names without accepting arbitrary strings", () => {
    expect(normalizeIanaTimezone(" Asia/Jerusalem ")).toBe("Asia/Jerusalem");
    expect(normalizeIanaTimezone("not/a-timezone")).toBeNull();
  });
});
