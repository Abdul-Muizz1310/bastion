import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("05-rate-limit: happy path", () => {
  // Case 1: request under limit proceeds
  it("request under the limit returns success", async () => {
    const limiter = createRateLimiter({ max: 10, windowMs: 60_000 });
    const result = await limiter.check("test-ip");
    expect(result.success).toBe(true);
  });

  // Case 2: response includes rate limit headers
  it("result includes limit and remaining counts", async () => {
    const limiter = createRateLimiter({ max: 10, windowMs: 60_000 });
    const result = await limiter.check("test-ip");
    expect(result.limit).toBe(10);
    expect(result.remaining).toBeDefined();
    expect(result.remaining).toBeLessThanOrEqual(10);
  });

  // Case 3: different keys have independent counters
  it("different keys have independent rate limit counters", async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    const r1 = await limiter.check("ip-1");
    const r2 = await limiter.check("ip-2");
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  // Case 4: different sessions independent for gateway
  it("different sessions have independent gateway counters", async () => {
    const limiter = createRateLimiter({ max: 60, windowMs: 60_000 });
    const r1 = await limiter.check("session-1");
    const r2 = await limiter.check("session-2");
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});

describe("05-rate-limit: edge and failure cases", () => {
  // Case 5: exceeding limit returns 429
  it("exceeding limit returns failure with retryAfter", async () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    await limiter.check("test-ip");
    await limiter.check("test-ip");
    const result = await limiter.check("test-ip");
    expect(result.success).toBe(false);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  // Case 6: 429 includes Retry-After
  it("rate limit result includes retryAfter seconds", async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    await limiter.check("test-ip");
    const result = await limiter.check("test-ip");
    expect(result.success).toBe(false);
    expect(typeof result.retryAfter).toBe("number");
  });

  // Case 7: after window expires, requests succeed again
  it("requests succeed again after window expires", async () => {
    // Would need time manipulation or short window
    expect(true).toBe(false); // placeholder — needs time control
  });

  // Case 8: Redis unreachable fails open
  it("fails open when Redis is unreachable", async () => {
    const limiter = createRateLimiter({
      max: 10,
      windowMs: 60_000,
      redisUrl: "http://unreachable:6379",
    });
    const result = await limiter.check("test-ip");
    expect(result.success).toBe(true); // fail-open
  });
});

describe("05-rate-limit: security", () => {
  // Case 9: IP spoofing mitigated
  it("uses x-real-ip or first x-forwarded-for value only", () => {
    // This is tested at the middleware/handler level
    expect(true).toBe(false); // placeholder — needs request context
  });

  // Case 10: rate limit events logged
  it("rate limit events logged as security.rate_limited", async () => {
    expect(true).toBe(false); // placeholder — needs audit spy
  });
});
