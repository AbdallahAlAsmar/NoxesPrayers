export class SlidingWindowRateLimiter {
  private readonly events = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.events.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs);
    if (recent.length >= this.limit) {
      this.events.set(key, recent);
      return false;
    }
    recent.push(now);
    this.events.set(key, recent);
    if (this.events.size > 10_000) {
      for (const [eventKey, timestamps] of this.events) {
        if (timestamps.every((timestamp) => now - timestamp >= this.windowMs)) this.events.delete(eventKey);
      }
    }
    return true;
  }
}
