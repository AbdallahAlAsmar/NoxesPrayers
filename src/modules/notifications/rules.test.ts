import { describe, expect, it } from "vitest";
import { checklistIdempotencyKey, localMidnightInstant, notificationIdempotencyKey, notificationIsExpired } from "./rules.js";

describe("durable notification rules", () => {
  it("creates stable, schedule-versioned prayer keys", () => {
    const key = { userId: "user-1", scheduleVersion: 3, calculationKey: "calc-v1", localDate: "2026-11-03", prayer: "FAJR" as const, kind: "PRAYER" as const };
    expect(notificationIdempotencyKey(key)).toBe(notificationIdempotencyKey(key));
    expect(notificationIdempotencyKey({ ...key, scheduleVersion: 4 })).not.toBe(notificationIdempotencyKey(key));
    expect(notificationIdempotencyKey({ ...key, calculationKey: "calc-v2" })).not.toBe(notificationIdempotencyKey(key));
    expect(notificationIdempotencyKey({ ...key, kind: "PRAYER_BEFORE" })).not.toBe(notificationIdempotencyKey(key));
  });

  it("expires stale reminders but accepts the exact delay boundary", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(notificationIsExpired(new Date(now.getTime() - 15 * 60_000), now)).toBe(false);
    expect(notificationIsExpired(new Date(now.getTime() - 15 * 60_000 - 1), now)).toBe(true);
  });

  it("keys each user's local midnight checklist by local date and schedule version", () => {
    expect(checklistIdempotencyKey("user-1", 2, "2026-11-03")).not.toBe(checklistIdempotencyKey("user-1", 2, "2026-11-04"));
    expect(checklistIdempotencyKey("user-1", 3, "2026-11-03")).not.toBe(checklistIdempotencyKey("user-1", 2, "2026-11-03"));
  });

  it("resolves midnight using each date's IANA offset, including summer time", () => {
    expect(localMidnightInstant("2026-01-01", "Europe/London").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(localMidnightInstant("2026-07-01", "Europe/London").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(localMidnightInstant("2026-01-01", "Asia/Jerusalem").toISOString()).toBe("2025-12-31T22:00:00.000Z");
  });
});
