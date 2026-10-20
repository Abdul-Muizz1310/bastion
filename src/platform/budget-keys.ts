/**
 * The daily budgets' names and default limits (spec 21 §4). Pure and free of the counter store, so
 * a browser bundle (a workbench's budget meter) can name the budgets without pulling in Upstash.
 */

export type BudgetKey = "debate" | "upload" | "leakscan" | "scrape" | "certify" | "feathers.write";

export const BUDGET_KEYS: readonly BudgetKey[] = [
  "debate",
  "upload",
  "leakscan",
  "scrape",
  "certify",
  "feathers.write",
];

export const DEFAULT_BUDGETS: Readonly<Record<BudgetKey, number>> = {
  debate: 4,
  upload: 3,
  leakscan: 10,
  scrape: 30,
  certify: 200,
  "feathers.write": 50,
};

/** What is left of one budget today. */
export type BudgetLeft = { limit: number; left: number };
