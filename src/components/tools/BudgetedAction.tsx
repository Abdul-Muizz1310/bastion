"use client";

import { useId } from "react";
import { BudgetMeter } from "@/components/platform/BudgetMeter";
import { useBudgets } from "@/features/tools/BudgetProvider";
import { affordability } from "@/features/tools/budgets";
import { BUDGET_NOUN, type BudgetKey } from "@/platform/budget-keys";
import { BUTTON } from "./styles";
import { useWakeReady } from "./WakeGate";

/**
 * An action that spends a daily budget (spec 21 §5.1, invariant 1): its button and what is left
 * today. Disabled until the product is live, while it runs, and when fewer units are left than it
 * spends. When the budgets could not be read it stays enabled and says so: the gateway enforces them.
 */

export function BudgetedAction({
  budget,
  units = 1,
  label,
  busyLabel,
  busy = false,
  disabled = false,
  onRun,
  type = "button",
}: {
  budget: BudgetKey;
  units?: number;
  label: string;
  busyLabel?: string;
  busy?: boolean;
  /** Another reason to hold the action (an empty field). */
  disabled?: boolean;
  onRun?: () => void;
  type?: "button" | "submit";
}) {
  const ready = useWakeReady();
  const { budgets } = useBudgets();
  const meterId = `budget-${useId()}`;
  const left = budgets?.[budget] ?? null;
  const can = affordability(left, units);
  const off = !ready || busy || disabled || can === "short";

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <button
        type={type}
        onClick={onRun}
        disabled={off}
        aria-busy={busy || undefined}
        className={BUTTON}
      >
        {busy ? (busyLabel ?? label) : label}
      </button>
      <div className="min-w-48 flex-1 sm:max-w-72">
        {left === null ? (
          <p className="font-mono text-[11px] text-fg-muted">
            today’s {BUDGET_NOUN[budget]} budget could not be read · the gateway still enforces it
          </p>
        ) : (
          <>
            <BudgetMeter
              id={meterId}
              label={`${BUDGET_NOUN[budget]} left today`}
              left={left.left}
              limit={left.limit}
            />
            {can === "short" && left.left > 0 ? (
              <p className="mt-1 font-mono text-[11px] text-warning">
                needs {units}; {left.left} left today
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
