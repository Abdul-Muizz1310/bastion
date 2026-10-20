import "server-only";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import { ConfigError } from "@/platform/secrets";
import { BUDGET_KEYS, type BudgetKey, type BudgetLeft, DEFAULT_BUDGETS } from "./budget-keys";

/**
 * Daily budgets (spec 21 §4). The account's free OpenRouter models allow 50 requests a day across
 * every product, so spend-heavy capabilities draw from one counter per key per UTC day, shared by
 * all visitors: `budget:<YYYY-MM-DD>:<key>` on Upstash, INCRBY + EXPIRE 2 days in one round trip.
 *
 * A reservation increments first and checks after, rolling back when it overshoots — concurrent
 * callers can never spend past the limit. Limits come from `BUDGET_<KEY>` (key upper-cased, `.` →
 * `_`), else the defaults below.
 *
 * Without Upstash (tests, local dev) the counters live in this process — per instance, reset on
 * restart — and the operator is warned once. With Upstash configured but unreachable a reservation
 * is refused (fail closed): an outage must never switch the budgets off.
 */

export { BUDGET_KEYS, type BudgetKey, type BudgetLeft, DEFAULT_BUDGETS };

const COUNTER_TTL_S = 2 * 24 * 60 * 60;
const DAY_S = 24 * 60 * 60;
const NON_NEGATIVE_INTEGER = /^\d+$/;

// ---- pure core -------------------------------------------------------------------------------

function assertKey(key: BudgetKey): void {
  if (!BUDGET_KEYS.includes(key)) throw new TypeError(`budget: unknown budget key ${String(key)}`);
}

function assertUnits(n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError("budget: n must be a positive integer");
  }
}

function assertDate(now: Date): void {
  if (Number.isNaN(now.getTime())) throw new RangeError("budget: now must be a valid date");
}

export function budgetEnvName(key: BudgetKey): string {
  return `BUDGET_${key.toUpperCase().replaceAll(".", "_")}`;
}

/** Today's limit for a key. A malformed override fails loudly instead of silently defaulting. */
export function budgetLimit(key: BudgetKey): number {
  assertKey(key);
  const name = budgetEnvName(key);
  const raw = process.env[name];
  if (raw === undefined || raw === "") return DEFAULT_BUDGETS[key];
  const value = Number(raw);
  if (!NON_NEGATIVE_INTEGER.test(raw) || !Number.isSafeInteger(value)) {
    throw new ConfigError(name, "must be a non-negative integer");
  }
  return value;
}

export function budgetCounterKey(key: BudgetKey, now: Date): string {
  assertKey(key);
  assertDate(now);
  return `budget:${now.toISOString().slice(0, 10)}:${key}`;
}

/** Whole seconds until the budgets roll over (next UTC midnight); 1..86400. */
export function secondsUntilUtcMidnight(now: Date): number {
  assertDate(now);
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.min(DAY_S, Math.max(1, Math.ceil((next - now.getTime()) / 1000)));
}

// ---- counter stores (imperative shell) -------------------------------------------------------

type CounterStore = {
  /** Adds n and returns the new value. */
  add(counter: string, n: number): Promise<number>;
  /** Subtracts n, never leaving the counter below zero. */
  subtract(counter: string, n: number): Promise<void>;
  read(counters: readonly string[]): Promise<number[]>;
};

const counterValue = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform(Number),
  z.null().transform(() => 0),
]);

function parseCounter(counter: string, value: unknown): number {
  const parsed = counterValue.safeParse(value);
  if (!parsed.success) throw new TypeError(`budget: ${counter} does not hold an integer`);
  return parsed.data;
}

function upstashStore(redis: Redis): CounterStore {
  return {
    async add(counter, n) {
      const [value] = await redis
        .pipeline()
        .incrby(counter, n)
        .expire(counter, COUNTER_TTL_S)
        .exec();
      return parseCounter(counter, value);
    },
    async subtract(counter, n) {
      const value = await redis.decrby(counter, n);
      if (value < 0) await redis.incrby(counter, -value);
    },
    async read(counters) {
      const values = await redis.mget<unknown[]>(...counters);
      return counters.map((counter, i) => parseCounter(counter, values[i] ?? null));
    },
  };
}

function memoryStore(): CounterStore {
  const values = new Map<string, number>();
  return {
    async add(counter, n) {
      const value = (values.get(counter) ?? 0) + n;
      values.set(counter, value);
      return value;
    },
    async subtract(counter, n) {
      values.set(counter, Math.max(0, (values.get(counter) ?? 0) - n));
    },
    async read(counters) {
      return counters.map((counter) => values.get(counter) ?? 0);
    },
  };
}

let store: CounterStore | null = null;

function counterStore(): CounterStore {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    store = upstashStore(new Redis({ url, token }));
  } else {
    console.warn(
      "Budgets: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. Daily budgets " +
        "are counted in-process: per instance and reset on restart.",
    );
    store = memoryStore();
  }
  return store;
}

// ---- public API ------------------------------------------------------------------------------

export async function reserveBudget(
  key: BudgetKey,
  n = 1,
  now: Date = new Date(),
): Promise<{ ok: boolean; left: number }> {
  assertUnits(n);
  const counter = budgetCounterKey(key, now);
  const limit = budgetLimit(key);
  const counters = counterStore();
  let used: number;
  try {
    used = await counters.add(counter, n);
  } catch (err) {
    console.error(`budget: cannot reach the counter store; refusing ${key}`, err);
    return { ok: false, left: 0 };
  }
  if (used <= limit) return { ok: true, left: limit - used };
  try {
    await counters.subtract(counter, n);
  } catch (err) {
    console.error(`budget: cannot roll back an over-limit ${key} reservation`, err);
  }
  return { ok: false, left: Math.max(0, limit - (used - n)) };
}

/** Gives units back after a call that spent nothing. Never throws: a lost release only over-counts. */
export async function releaseBudget(key: BudgetKey, n = 1, now: Date = new Date()): Promise<void> {
  assertUnits(n);
  const counter = budgetCounterKey(key, now);
  try {
    await counterStore().subtract(counter, n);
  } catch (err) {
    console.error(`budget: cannot release ${key}; it stays spent until the day rolls over`, err);
  }
}

export async function budgetsLeft(now: Date = new Date()): Promise<Record<BudgetKey, BudgetLeft>> {
  const counters = BUDGET_KEYS.map((key) => budgetCounterKey(key, now));
  const used = await counterStore().read(counters);
  const entries = BUDGET_KEYS.map((key, i) => {
    const limit = budgetLimit(key);
    const left = Math.min(limit, Math.max(0, limit - (used[i] ?? 0)));
    return [key, { limit, left }] as const;
  });
  return Object.fromEntries(entries) as Record<BudgetKey, BudgetLeft>;
}
