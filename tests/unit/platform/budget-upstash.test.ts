import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The production store: Upstash counters `budget:<YYYY-MM-DD>:<key>`, INCRBY + EXPIRE 2 days in
 * one round trip. A Redis failure refuses the reservation (fail closed): the budgets guard a shared
 * 50-requests-a-day model quota, so an outage must never turn them off.
 */

const { redis, constructed } = vi.hoisted(() => {
  const values = new Map<string, number | string>();
  const log: unknown[][] = [];
  let failing = false;
  const fail = () => {
    if (failing) throw new Error("upstash unreachable");
  };
  const num = (k: string) => Number(values.get(k) ?? 0);
  const redis = {
    values,
    log,
    setFailing(v: boolean) {
      failing = v;
    },
    pipeline() {
      const ops: unknown[][] = [];
      const p = {
        incrby(k: string, n: number) {
          ops.push(["incrby", k, n]);
          return p;
        },
        expire(k: string, s: number) {
          ops.push(["expire", k, s]);
          return p;
        },
        async exec() {
          fail();
          log.push(["pipeline", ...ops]);
          return ops.map(([op, k, n]) => {
            if (op === "incrby") {
              values.set(k as string, num(k as string) + (n as number));
              return num(k as string);
            }
            return 1;
          });
        },
      };
      return p;
    },
    async incrby(k: string, n: number) {
      fail();
      log.push(["incrby", k, n]);
      values.set(k, num(k) + n);
      return num(k);
    },
    async decrby(k: string, n: number) {
      fail();
      log.push(["decrby", k, n]);
      values.set(k, num(k) - n);
      return num(k);
    },
    async mget(...keys: string[]) {
      fail();
      log.push(["mget", ...keys]);
      return keys.map((k) => values.get(k) ?? null);
    },
  };
  return { redis, constructed: [] as unknown[] };
});

vi.mock("@upstash/redis", () => ({
  Redis: function FakeRedis(opts: unknown) {
    constructed.push(opts);
    return redis;
  },
}));

type BudgetModule = typeof import("@/platform/budget");
const DAY = new Date("2026-10-20T12:00:00.000Z");
let budget: BudgetModule;

beforeEach(async () => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  redis.values.clear();
  redis.log.length = 0;
  redis.setFailing(false);
  constructed.length = 0;
  vi.resetModules();
  budget = await import("@/platform/budget");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("budgets on Upstash", () => {
  it("connects with the configured REST credentials and warns about nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await budget.reserveBudget("debate", 1, DAY);
    expect(constructed).toStrictEqual([{ url: "https://upstash.example", token: "token" }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("increments budget:<day>:<key> and sets a 2-day expiry in one pipeline", async () => {
    expect(await budget.reserveBudget("feathers.write", 2, DAY)).toStrictEqual({
      ok: true,
      left: 48,
    });
    expect(redis.log).toStrictEqual([
      [
        "pipeline",
        ["incrby", "budget:2026-10-20:feathers.write", 2],
        ["expire", "budget:2026-10-20:feathers.write", 172_800],
      ],
    ]);
  });

  it("rolls an over-limit reservation back with DECRBY", async () => {
    redis.values.set("budget:2026-10-20:debate", 4);
    expect(await budget.reserveBudget("debate", 1, DAY)).toStrictEqual({ ok: false, left: 0 });
    expect(redis.log.at(-1)).toStrictEqual(["decrby", "budget:2026-10-20:debate", 1]);
    expect(redis.values.get("budget:2026-10-20:debate")).toBe(4);
  });

  it("releases with DECRBY and repairs a counter pushed below zero", async () => {
    await budget.releaseBudget("debate", 2, DAY);
    expect(redis.log).toContainEqual(["decrby", "budget:2026-10-20:debate", 2]);
    expect(redis.values.get("budget:2026-10-20:debate")).toBe(0);
  });

  it("reads every key's counter in one MGET, accepting numeric strings", async () => {
    redis.values.set("budget:2026-10-20:scrape", "12");
    redis.values.set("budget:2026-10-20:debate", 1);
    const left = await budget.budgetsLeft(DAY);
    expect(redis.log).toHaveLength(1);
    expect(redis.log[0]?.[0]).toBe("mget");
    expect(left.scrape).toStrictEqual({ limit: 30, left: 18 });
    expect(left.debate).toStrictEqual({ limit: 4, left: 3 });
    expect(left.upload).toStrictEqual({ limit: 3, left: 3 });
  });

  it("refuses a counter value that is not a number", async () => {
    redis.values.set("budget:2026-10-20:scrape", "lots");
    await expect(budget.budgetsLeft(DAY)).rejects.toThrow(TypeError);
  });

  it("fails closed when Redis is unreachable, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    redis.setFailing(true);
    expect(await budget.reserveBudget("debate", 1, DAY)).toStrictEqual({ ok: false, left: 0 });
    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toMatch(/budget/i);
  });

  it("keeps the units spent when a release cannot reach Redis (never throws)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    redis.setFailing(true);
    await expect(budget.releaseBudget("debate", 1, DAY)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("lets budgetsLeft fail loudly when Redis is unreachable", async () => {
    redis.setFailing(true);
    await expect(budget.budgetsLeft(DAY)).rejects.toThrow(/upstash unreachable/);
  });
});
