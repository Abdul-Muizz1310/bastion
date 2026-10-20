"use client";

import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { type Budgets, fetchBudgets } from "./budgets";

/**
 * Today's budgets for one workbench page (spec 21 §5.1, "Budgets"): rendered with the server's read,
 * re-read from `GET /api/platform/budgets` after every budgeted action. A failed re-read keeps the
 * last known numbers — the gateway enforces the budgets either way.
 */

type BudgetState = { budgets: Budgets | null; refresh: () => void };

const BudgetContext = createContext<BudgetState>({ budgets: null, refresh: () => {} });

export function BudgetProvider({
  initial,
  children,
}: {
  initial: Budgets | null;
  children: ReactNode;
}) {
  const [budgets, setBudgets] = useState<Budgets | null>(initial);
  const refresh = useCallback(() => {
    const controller = new AbortController();
    fetchBudgets(controller.signal)
      .then(setBudgets)
      .catch(() => {});
  }, []);
  return <BudgetContext value={{ budgets, refresh }}>{children}</BudgetContext>;
}

export function useBudgets(): BudgetState {
  return useContext(BudgetContext);
}
