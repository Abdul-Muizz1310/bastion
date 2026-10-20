import * as z from "zod/mini";
import { BUDGET_KEYS, type BudgetKey, type BudgetLeft } from "@/platform/budget-keys";
import type { FetchLike } from "./outcome";

/**
 * Today's budgets as a workbench reads them (spec 21 §5.1, "Budgets"): parsed from
 * `GET /api/platform/budgets`, and the one question an action asks of them.
 */

export type Budgets = Readonly<Record<BudgetKey, BudgetLeft>>;

export const BUDGETS_PATH = "/api/platform/budgets";

const count = z.number().check(z.int(), z.nonnegative());

const budgetLeft = z
  .object({ limit: count, left: count })
  .check(z.refine((b) => b.left <= b.limit, { message: "left exceeds limit" }));

const budgetsSchema = z.object(
  Object.fromEntries(BUDGET_KEYS.map((key) => [key, budgetLeft])) as Record<
    BudgetKey,
    typeof budgetLeft
  >,
);

/** Every budget key with a whole {limit, left}, left never above limit; anything else throws. */
export function parseBudgets(body: unknown): Budgets {
  return budgetsSchema.parse(body);
}

export async function fetchBudgets(
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<Budgets> {
  const res = await fetchImpl(BUDGETS_PATH, {
    cache: "no-store",
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`budgets: GET ${BUDGETS_PATH} answered ${res.status}`);
  return parseBudgets(await res.json());
}

export type Affordability = "ok" | "short" | "unknown";

/**
 * Whether an action that spends `units` can run today: `short` when fewer are left, `unknown` when
 * the budgets could not be read (the action stays enabled — the gateway still enforces them).
 */
export function affordability(budget: BudgetLeft | null, units: number): Affordability {
  if (!Number.isSafeInteger(units) || units < 1) {
    throw new RangeError(`affordability: units must be a positive whole number, not ${units}`);
  }
  if (budget === null) return "unknown";
  return budget.left >= units ? "ok" : "short";
}
