import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

/**
 * Daily budgets (spec 21 §4, plan "Budget defaults"): one counter per key per UTC day, shared by
 * every visitor, reserved before a downstream call and released only when the call spent nothing.
 * Without Upstash the counters live in-process (tests, local dev) and the operator is told once.
 */

type BudgetModule = typeof import("@/platform/budget");

const DAY = new Date("2026-10-20T12:00:00.000Z");
let budget: BudgetModule;
let ConfigError: typeof import("@/platform/secrets").ConfigError;
let warn: MockInstance<typeof console.warn>;

beforeEach(async () => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
  budget = await import("@/platform/budget");
  // The same module graph as the fresh budget module, so instanceof holds.
  ({ ConfigError } = await import("@/platform/secrets"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("budget keys and limits", () => {
  it("lists the six budgeted keys", () => {
    expect([...budget.BUDGET_KEYS].sort()).toStrictEqual(
      ["certify", "debate", "feathers.write", "leakscan", "scrape", "upload"].sort(),
    );
  });

  it("defaults to the plan's daily limits", () => {
    expect(budget.DEFAULT_BUDGETS).toStrictEqual({
      debate: 4,
      upload: 3,
      leakscan: 10,
      scrape: 30,
      certify: 200,
      "feathers.write": 50,
    });
    for (const key of budget.BUDGET_KEYS) {
      expect(budget.budgetLimit(key)).toBe(budget.DEFAULT_BUDGETS[key]);
    }
  });

  it("reads BUDGET_<KEY> with the key upper-cased and dots as underscores", () => {
    vi.stubEnv("BUDGET_DEBATE", "7");
    vi.stubEnv("BUDGET_FEATHERS_WRITE", "0");
    expect(budget.budgetLimit("debate")).toBe(7);
    expect(budget.budgetLimit("feathers.write")).toBe(0);
  });

  it("treats an empty override as unset", () => {
    vi.stubEnv("BUDGET_SCRAPE", "");
    expect(budget.budgetLimit("scrape")).toBe(30);
  });

  it.each(["abc", "-1", "1.5", " 4", "4​", "1e3"])(
    "refuses the override %j loudly, naming the variable",
    (value) => {
      vi.stubEnv("BUDGET_DEBATE", value);
      expect(() => budget.budgetLimit("debate")).toThrow(ConfigError);
      expect(() => budget.budgetLimit("debate")).toThrow(/BUDGET_DEBATE/);
    },
  );

  it("names the counter budget:<UTC day>:<key>", () => {
    expect(budget.budgetCounterKey("feathers.write", DAY)).toBe(
      "budget:2026-10-20:feathers.write",
    );
  });

  it("rolls the counter over at UTC midnight, not local midnight", () => {
    const before = new Date("2026-10-20T23:59:59.999Z");
    const after = new Date("2026-10-21T00:00:00.000Z");
    expect(budget.budgetCounterKey("debate", before)).toBe("budget:2026-10-20:debate");
    expect(budget.budgetCounterKey("debate", after)).toBe("budget:2026-10-21:debate");
  });

  it("refuses an invalid date", () => {
    expect(() => budget.budgetCounterKey("debate", new Date("nope"))).toThrow(RangeError);
  });

  it("counts the seconds until the next UTC midnight", () => {
    expect(budget.secondsUntilUtcMidnight(new Date("2026-10-20T23:59:30.000Z"))).toBe(30);
    expect(budget.secondsUntilUtcMidnight(new Date("2026-10-20T00:00:00.000Z"))).toBe(86_400);
    expect(budget.secondsUntilUtcMidnight(new Date("2026-10-20T23:59:59.500Z"))).toBe(1);
  });
});

describe("reserveBudget / releaseBudget (in-process store)", () => {
  it("reserves up to the limit, then refuses", async () => {
    const lefts = [];
    for (let i = 0; i < 4; i++) lefts.push(await budget.reserveBudget("debate", 1, DAY));
    expect(lefts).toStrictEqual([
      { ok: true, left: 3 },
      { ok: true, left: 2 },
      { ok: true, left: 1 },
      { ok: true, left: 0 },
    ]);
    expect(await budget.reserveBudget("debate", 1, DAY)).toStrictEqual({ ok: false, left: 0 });
  });

  it("does not count a refused reservation", async () => {
    for (let i = 0; i < 5; i++) await budget.reserveBudget("debate", 1, DAY);
    await budget.releaseBudget("debate", 1, DAY);
    expect(await budget.reserveBudget("debate", 1, DAY)).toStrictEqual({ ok: true, left: 0 });
    expect(await budget.reserveBudget("debate", 1, DAY)).toStrictEqual({ ok: false, left: 0 });
  });

  it("reserves n at once and rolls a too-large request back whole", async () => {
    expect(await budget.reserveBudget("upload", 2, DAY)).toStrictEqual({ ok: true, left: 1 });
    expect(await budget.reserveBudget("upload", 2, DAY)).toStrictEqual({ ok: false, left: 1 });
    expect(await budget.reserveBudget("upload", 1, DAY)).toStrictEqual({ ok: true, left: 0 });
  });

  it("refuses everything when the limit is 0", async () => {
    vi.stubEnv("BUDGET_CERTIFY", "0");
    expect(await budget.reserveBudget("certify", 1, DAY)).toStrictEqual({ ok: false, left: 0 });
  });

  it("gives units back on release", async () => {
    await budget.reserveBudget("leakscan", 3, DAY);
    await budget.releaseBudget("leakscan", 2, DAY);
    expect((await budget.budgetsLeft(DAY)).leakscan).toStrictEqual({ limit: 10, left: 9 });
  });

  it("never releases above the limit", async () => {
    await budget.releaseBudget("debate", 2, DAY);
    expect((await budget.budgetsLeft(DAY)).debate).toStrictEqual({ limit: 4, left: 4 });
    for (let i = 0; i < 4; i++) await budget.reserveBudget("debate", 1, DAY);
    expect(await budget.reserveBudget("debate", 1, DAY)).toStrictEqual({ ok: false, left: 0 });
  });

  it("starts a fresh day at UTC midnight", async () => {
    const lateNight = new Date("2026-10-20T23:59:59.000Z");
    const nextDay = new Date("2026-10-21T00:00:01.000Z");
    for (let i = 0; i < 4; i++) await budget.reserveBudget("debate", 1, lateNight);
    expect((await budget.reserveBudget("debate", 1, lateNight)).ok).toBe(false);
    expect(await budget.reserveBudget("debate", 1, nextDay)).toStrictEqual({ ok: true, left: 3 });
  });

  it("keeps keys independent", async () => {
    for (let i = 0; i < 4; i++) await budget.reserveBudget("debate", 1, DAY);
    expect(await budget.reserveBudget("scrape", 1, DAY)).toStrictEqual({ ok: true, left: 29 });
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses n = %s", async (n) => {
    await expect(budget.reserveBudget("debate", n, DAY)).rejects.toThrow(RangeError);
    await expect(budget.releaseBudget("debate", n, DAY)).rejects.toThrow(RangeError);
  });

  it("refuses a key that is not budgeted", async () => {
    await expect(
      budget.reserveBudget("tokens" as Parameters<BudgetModule["reserveBudget"]>[0], 1, DAY),
    ).rejects.toThrow(TypeError);
  });

  it("reports every key's limit and what is left today", async () => {
    await budget.reserveBudget("scrape", 5, DAY);
    expect(await budget.budgetsLeft(DAY)).toStrictEqual({
      debate: { limit: 4, left: 4 },
      upload: { limit: 3, left: 3 },
      leakscan: { limit: 10, left: 10 },
      scrape: { limit: 30, left: 25 },
      certify: { limit: 200, left: 200 },
      "feathers.write": { limit: 50, left: 50 },
    });
  });

  it("clamps left to 0 when the limit is lowered below today's use", async () => {
    await budget.reserveBudget("scrape", 10, DAY);
    vi.stubEnv("BUDGET_SCRAPE", "4");
    expect((await budget.budgetsLeft(DAY)).scrape).toStrictEqual({ limit: 4, left: 0 });
    expect(await budget.reserveBudget("scrape", 1, DAY)).toStrictEqual({ ok: false, left: 0 });
  });

  it("tells the operator once that budgets are per-instance without Upstash", async () => {
    await budget.reserveBudget("debate", 1, DAY);
    await budget.reserveBudget("scrape", 1, DAY);
    await budget.budgetsLeft(DAY);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes("UPSTASH_REDIS_REST_URL"))).toHaveLength(1);
  });
});
