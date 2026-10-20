import type { ReactNode } from "react";
import { WakeGate } from "@/components/tools/WakeGate";
import {
  initialWake,
  type WakeState,
  wakeAnswered,
  wakeStarted,
} from "@/components/tools/wake-model";
import { BudgetProvider } from "@/features/tools/BudgetProvider";
import type { Budgets } from "@/features/tools/budgets";
import type { WakeAnswer } from "@/features/tools/wake";
import { BUDGET_KEYS, type BudgetLeft } from "@/platform/budget-keys";
import type { ServiceId } from "@/platform/registry/products";

/** Test-only wrappers: a gate and today's budgets, seeded, around what a workbench renders. */

export type GateSeed = "checking" | "waking" | "live" | "asleep" | "down" | "failed" | "rate_limited";

const ANSWERS: Readonly<Record<Exclude<GateSeed, "checking" | "waking">, WakeAnswer>> = {
  live: { kind: "answer", state: "live", latencyMs: 180 },
  asleep: { kind: "answer", state: "asleep", latencyMs: 90_000 },
  down: { kind: "answer", state: "down", latencyMs: 40 },
  failed: { kind: "failed", detail: "the wake route could not be reached" },
  rate_limited: { kind: "rate_limited", retryAfterS: 17 },
};

/** Every service of the gate in the same seeded phase; a wake that started 12 s ago. */
export function gateWith(services: readonly ServiceId[], seed: GateSeed): WakeState {
  let state = initialWake(services);
  if (seed === "checking") return state;
  const started = Date.now() - 12_000;
  for (const service of services) state = wakeStarted(state, service, started);
  if (seed === "waking") return state;
  for (const service of services) state = wakeAnswered(state, service, ANSWERS[seed], Date.now());
  return state;
}

export function budgetsWith(over: Partial<Record<string, BudgetLeft>> = {}): Budgets {
  return Object.fromEntries(
    BUDGET_KEYS.map((key) => [key, over[key] ?? { limit: 10, left: 10 }]),
  ) as Budgets;
}

export function Seeded({
  children,
  name = "magpie",
  services = ["magpie"],
  gate = "live",
  budgets = budgetsWith(),
}: {
  children: ReactNode;
  name?: string;
  services?: ServiceId[];
  gate?: GateSeed;
  budgets?: Budgets | null;
}) {
  return (
    <BudgetProvider initial={budgets}>
      <WakeGate name={name} services={services} initial={gateWith(services, gate)}>
        {children}
      </WakeGate>
    </BudgetProvider>
  );
}

/** Every <button> opening tag, for reading `disabled`. */
export function buttons(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
}

export function buttonNamed(html: string, name: RegExp): string {
  const found = buttons(html).find((b) => name.test(b.replace(/<[^>]+>/g, " ")) || name.test(b));
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

export const isDisabled = (button: string) => /^<button\b[^>]*\sdisabled=""/.test(button);
