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

export function createRateLimiter(config: RateLimitConfig & { failClosed?: boolean }) {
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
    // Fail-open: if Redis is unreachable at init, allow requests (unless failClosed)
    console.warn("Rate limiter: Redis unavailable at init");
  }

  const failClosed = config.failClosed ?? false;

  return {
    async check(key: string): Promise<RateLimitResult> {
      if (!ratelimit) {
        if (failClosed) {
          return { success: false, limit: config.max, remaining: 0 };
        }
        return { success: true, limit: config.max, remaining: config.max };
      }

      try {
        const result = await ratelimit.limit(key);
        return {
          success: result.success,
          limit: result.limit,
          remaining: result.remaining,
          retryAfter: result.success
            ? undefined
            : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
        };
      } catch {
        console.warn("Rate limiter: check failed");
        if (failClosed) {
          return { success: false, limit: config.max, remaining: 0 };
        }
        return { success: true, limit: config.max, remaining: config.max };
      }
    },
  };
}

// Pre-configured limiters
// Auth limiter fails CLOSED — Redis outage must not bypass auth rate limiting
export const authLimiter = createRateLimiter({ max: 10, windowMs: 60_000, failClosed: true });
export const gatewayLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });
export const csrfLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
