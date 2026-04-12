import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitConfig = {
  max: number;
  windowMs: number;
  redisUrl?: string;
  redisToken?: string;
};

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  retryAfter?: number;
};

export function createRateLimiter(config: RateLimitConfig) {
  let ratelimit: Ratelimit | null = null;

  try {
    const url = config.redisUrl ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = config.redisToken ?? process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      const redis = new Redis({ url, token });
      const windowSec = Math.ceil(config.windowMs / 1000);
      ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.max, `${windowSec} s`),
        analytics: false,
      });
    }
  } catch {
    // Fail-open: if Redis is unreachable, allow all requests
    console.warn("Rate limiter: Redis unavailable, failing open");
  }

  return {
    async check(key: string): Promise<RateLimitResult> {
      if (!ratelimit) {
        // Fail-open
        return { success: true, limit: config.max, remaining: config.max };
      }

      try {
        const result = await ratelimit.limit(key);
        return {
          success: result.success,
          limit: result.limit,
          remaining: result.remaining,
          retryAfter: result.success ? undefined : Math.ceil(result.reset / 1000),
        };
      } catch {
        // Fail-open on error
        console.warn("Rate limiter: check failed, failing open");
        return { success: true, limit: config.max, remaining: config.max };
      }
    },
  };
}

// Pre-configured limiters
export const authLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });
export const gatewayLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });
export const csrfLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
