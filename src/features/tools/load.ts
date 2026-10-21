import "server-only";
import type { Budgets } from "@/features/tools/budgets";
import { budgetsLeft } from "@/platform/budget";

/**
 * Today's budgets for a workbench's first render (spec 21 §5.1). An unreadable budget store is not
 * the page's failure: the page renders, and each budgeted action says it could not read its budget.
 */
export async function loadBudgets(): Promise<Budgets | null> {
  try {
    return await budgetsLeft();
  } catch (err) {
    console.error("tools: cannot read today's budgets", err);
    return null;
  }
}
