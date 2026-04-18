import { describe, expect, it, vi } from "vitest";

// Mock Redis to throw during construction
vi.mock("@upstash/redis", () => ({
  Redis: () => {
    throw new Error("Redis init error");
  },
}));

vi.mock("@upstash/ratelimit", () => {
  function MockRatelimit() {
    return { limit: vi.fn() };
  }
  MockRatelimit.slidingWindow = () => "mock-limiter";
  return { Ratelimit: MockRatelimit };
});

describe("rate-limit: constructor error path", () => {
  it("fails open when Redis constructor throws", async () => {
    const { createRateLimiter } = await import("@/lib/rate-limit");
    const limiter = createRateLimiter({
      max: 10,
      windowMs: 60_000,
      redisUrl: "https://redis.example.com",
      redisToken: "test-token",
    });
    // Should still work in fail-open mode
    const result = await limiter.check("test-key");
    expect(result.success).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(10);
  });
});
