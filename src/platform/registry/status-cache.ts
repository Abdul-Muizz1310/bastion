import { Redis } from "@upstash/redis";
import { z } from "zod";
import type { Health } from "./health";
import { isServiceId, type ServiceId } from "./products";

/**
 * One shared probe round for GET /api/platform/status (Ruling AE). Every probe can wake a sleeping
 * Render service, so N visitors must not mean N probe rounds: a round is reused for 30 s, by this
 * instance (in memory) and by every instance (Upstash, when configured). Requests that arrive while
 * a round runs share it. A failed round is never cached, and a broken shared store only costs a
 * probe: the cache answers from its own round and logs the store error.
 */

export type StatusBody = { services: Health[]; timestamp: string };

export type StatusStore = {
  read(): Promise<unknown>;
  write(body: StatusBody, ttlSeconds: number): Promise<void>;
};

export const STATUS_KEY = "platform:status";
export const STATUS_TTL_MS = 30_000;
/** Instances' clocks differ a little; a round stamped further ahead than this is not trusted. */
const CLOCK_SKEW_MS = 5_000;

const healthSchema = z.object({
  service: z.custom<ServiceId>((v) => typeof v === "string" && isServiceId(v)),
  state: z.enum(["live", "asleep", "down"]),
  latencyMs: z.number().nonnegative(),
  version: z.string().optional(),
  commitSha: z.string().optional(),
  checkedAt: z.string(),
});

const statusBodySchema = z.object({
  services: z.array(healthSchema),
  timestamp: z.iso.datetime(),
});

export function createStatusCache(options: {
  probeAll: () => Promise<StatusBody>;
  store?: StatusStore | null;
  ttlMs?: number;
}): { get(): Promise<StatusBody> } {
  const { probeAll, store = null, ttlMs = STATUS_TTL_MS } = options;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000) {
    throw new RangeError("status cache: ttlMs must be a whole number ≥ 1000");
  }

  let local: StatusBody | null = null;
  let inFlight: Promise<StatusBody> | null = null;

  const fresh = (body: StatusBody): boolean => {
    const age = Date.now() - Date.parse(body.timestamp);
    return age >= -CLOCK_SKEW_MS && age < ttlMs;
  };

  async function readShared(): Promise<StatusBody | null> {
    if (!store) return null;
    try {
      const parsed = statusBodySchema.safeParse(await store.read());
      return parsed.success && fresh(parsed.data) ? parsed.data : null;
    } catch (err) {
      console.error("status cache: cannot read the shared round; probing instead", err);
      return null;
    }
  }

  async function refresh(): Promise<StatusBody> {
    const shared = await readShared();
    if (shared) {
      local = shared;
      return shared;
    }
    const body = await probeAll();
    local = body;
    if (store) {
      try {
        await store.write(body, Math.ceil(ttlMs / 1000));
      } catch (err) {
        console.error("status cache: cannot share the round; other instances will probe", err);
      }
    }
    return body;
  }

  return {
    get() {
      if (local && fresh(local)) return Promise.resolve(local);
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

type RedisLike = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>;
};

export function upstashStatusStore(redis: RedisLike): StatusStore {
  return {
    read: () => redis.get(STATUS_KEY),
    async write(body, ttlSeconds) {
      await redis.set(STATUS_KEY, body, { ex: ttlSeconds });
    },
  };
}

/** Upstash when it is configured; otherwise none, and each instance keeps its own round. */
export function statusStoreFromEnv(env: NodeJS.ProcessEnv = process.env): StatusStore | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? upstashStatusStore(new Redis({ url, token })) : null;
}
