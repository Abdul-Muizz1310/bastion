import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLimit = vi.fn();

vi.mock("@upstash/ratelimit", () => {
  function MockRatelimit() {
    return { limit: mockLimit };
  }
  MockRatelimit.slidingWindow = () => "mock-limiter";
  return { Ratelimit: MockRatelimit };
});

vi.mock("@upstash/redis", () => {
  function MockRedis() {
    return {};
  }
  return { Redis: MockRedis };
});

describe("rate-limit: Redis-connected paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("creates ratelimiter with Redis and check returns success", async () => {
    mockLimit.mockResolvedValueOnce({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });

    const { createRateLimiter } = await import("./rate-limit");
    const limiter = createRateLimiter({
      max: 10,
      windowMs: 60_000,
      redisUrl: "https://redis.example.com",
      redisToken: "test-token",
    });
    const result = await limiter.check("test-key");
    expect(result.success).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(9);
    expect(result.retryAfter).toBeUndefined();
  });

  it("check returns failure with retryAfter from Redis ratelimiter", async () => {
    const resetTime = Date.now() + 30000;
    mockLimit.mockResolvedValueOnce({
      success: false,
      limit: 10,
      remaining: 0,
      reset: resetTime,
    });

    const { createRateLimiter } = await import("./rate-limit");
    const limiter = createRateLimiter({
      max: 10,
      windowMs: 60_000,
      redisUrl: "https://redis.example.com",
      redisToken: "test-token",
    });
    const result = await limiter.check("test-key");
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
    expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    expect(result.retryAfter).toBeLessThanOrEqual(31);
  });

  it("check fails open when Redis ratelimit.limit() throws", async () => {
    mockLimit.mockRejectedValueOnce(new Error("Redis connection lost"));

    const { createRateLimiter } = await import("./rate-limit");
    const limiter = createRateLimiter({
      max: 10,
      windowMs: 60_000,
      redisUrl: "https://redis.example.com",
      redisToken: "test-token",
    });
    const result = await limiter.check("test-key");
    expect(result.success).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(10);
  });

  it("creates with env vars when redisUrl/redisToken not passed", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

    mockLimit.mockResolvedValueOnce({
      success: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60000,
    });

    const { createRateLimiter } = await import("./rate-limit");
    const limiter = createRateLimiter({ max: 5, windowMs: 60_000 });
    const result = await limiter.check("env-key");
    expect(result.success).toBe(true);

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });
});
