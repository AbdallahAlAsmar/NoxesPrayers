import { describe, expect, it } from "vitest";
import { calculateStreakSnapshot } from "./rules.js";

describe("daily prayer streak rules", () => {
  it("keeps yesterday's streak alive while today's prayer day is in progress", () => {
    expect(calculateStreakSnapshot(["2026-11-01", "2026-11-02"], "2026-11-03").currentStreak).toBe(2);
  });

  it("breaks the current streak after an incomplete day has finalized", () => {
    expect(calculateStreakSnapshot(["2026-11-01"], "2026-11-03").currentStreak).toBe(0);
  });

  it("includes a fully completed active day in the current streak", () => {
    expect(calculateStreakSnapshot(["2026-11-01", "2026-11-02", "2026-11-03"], "2026-11-03").currentStreak).toBe(3);
  });

  it("computes historical longest streak and distinct completed days", () => {
    const stats = calculateStreakSnapshot(["2026-01-01", "2026-01-02", "2026-01-04", "2026-01-04"], "2026-01-04");
    expect(stats).toEqual({ currentStreak: 1, longestStreak: 2, totalCompletedDays: 3 });
  });

  it("handles month and year boundaries", () => {
    expect(calculateStreakSnapshot(["2025-12-31", "2026-01-01"], "2026-01-02")).toMatchObject({ currentStreak: 2, longestStreak: 2 });
  });
});
