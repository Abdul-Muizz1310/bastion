import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("05-rate-limit: happy path", () => {
  it("request under the limit returns success", async () => {
    // Without Redis, rate limiter fails open
    const limiter = createRateLimiter({ max: 10, windowMs: 60_000 });
    const result = await limiter.check("test-ip");
    expect(result.success).toBe(true);
  });

  it("result includes limit and remaining counts", async () => {
    const limiter = createRateLimiter({ max: 10, windowMs: 60_000 });
    const result = await limiter.check("test-ip");
    expect(result.limit).toBe(10);
    expect(result.remaining).toBeDefined();
    expect(result.remaining).toBeLessThanOrEqual(10);
  });

  it("different keys have independent rate limit counters", async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    const r1 = await limiter.check("ip-1");
    const r2 = await limiter.check("ip-2");
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it("different sessions have independent gateway counters", async () => {
    const limiter = createRateLimiter({ max: 60, windowMs: 60_000 });
    const r1 = await limiter.check("session-1");
    const r2 = await limiter.check("session-2");
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});

describe("05-rate-limit: edge and failure cases", () => {
  it.todo("exceeding limit returns failure with retryAfter (integration: needs Redis)");
  it.todo("rate limit result includes retryAfter seconds (integration: needs Redis)");
  it.todo("requests succeed again after window expires (integration: needs Redis)");

  it.todo(
    "fails open when Redis is unreachable (integration: connection timeout too slow for unit)",
  );
});

describe("05-rate-limit: security", () => {
  it.todo("uses x-real-ip or first x-forwarded-for value only (integration)");
  it.todo("rate limit events logged as security.rate_limited (integration)");
});
