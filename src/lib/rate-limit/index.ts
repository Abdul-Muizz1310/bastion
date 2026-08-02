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

/**
 * A limiter built without Upstash credentials is not a limiter: fail-open ones
 * become a no-op and fail-closed ones reject everything. Neither is visible in
 * a request log, so say it out loud — once per process, at construction time.
 */
let warnedMissingRedis = false;

function warnMissingRedisOnce(): void {
  if (warnedMissingRedis) return;
  warnedMissingRedis = true;
  console.warn(
    "Rate limiter: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. " +
      "Fail-open limiters (gateway 60/min) are INACTIVE and fail-closed limiters " +
      "(auth 10/min) will reject every request.",
  );
}

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
    } else {
      warnMissingRedisOnce();
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
// Throttles CSRF token minting (GET /api/csrf) per session.
export const csrfLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
