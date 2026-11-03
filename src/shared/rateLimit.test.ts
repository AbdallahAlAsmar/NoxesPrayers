import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "./rateLimit.js";

describe("interaction rate limiter", () => {
  it("enforces a per-user rolling window and permits again after expiry", () => {
    const limiter = new SlidingWindowRateLimiter(2, 1_000);
    expect(limiter.allow("user", 100)).toBe(true);
    expect(limiter.allow("user", 200)).toBe(true);
    expect(limiter.allow("user", 300)).toBe(false);
    expect(limiter.allow("user", 1_101)).toBe(true);
  });

  it("isolates different Discord users", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1_000);
    expect(limiter.allow("first", 10)).toBe(true);
    expect(limiter.allow("second", 10)).toBe(true);
  });
});
