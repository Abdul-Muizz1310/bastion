"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ServiceBadge } from "@/components/platform/ServiceBadge";
import { wakeService } from "@/features/tools/wake";
import type { ServiceId } from "@/platform/registry/products";
import { BUTTON_QUIET } from "./styles";
import {
  gateView,
  initialWake,
  rewakeAll,
  type WakeState,
  wakeAnswered,
  wakeStarted,
} from "./wake-model";

/**
 * The wake gate around every workbench (spec 21 §5.1, Ruling F). On load it wakes each of the
 * product's services through `POST /api/platform/wake/<service>` and shows checking → waking (the
 * seconds counting up) → the wake route's own answer. Its children read `useWakeReady()`: no action
 * runs before every service is live. Any other end offers "wake again". Only the phase is announced
 * to assistive tech, never the ticking seconds.
 */

type GateControls = { ready: boolean; rewake: () => void };

const GateContext = createContext<GateControls>({ ready: false, rewake: () => {} });

/** Whether the product this workbench operates is live (false outside a gate). */
export function useWakeReady(): boolean {
  return useContext(GateContext).ready;
}

/** Puts the product back to waking — what an action that met an asleep service calls. */
export function useRewake(): () => void {
  return useContext(GateContext).rewake;
}

export function WakeGate({
  name,
  services,
  initial,
  children,
}: {
  name: string;
  services: readonly ServiceId[];
  /** The state to render before any wake answers (tests seed it). */
  initial?: WakeState;
  children: ReactNode;
}) {
  const [state, setState] = useState<WakeState>(() => initial ?? initialWake(services));
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(state);
  latest.current = state;
  const view = gateView(state, name, now);

  // Wake every service that is not live yet; a retry is a new attempt. Leaving aborts the requests.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger
  useEffect(() => {
    const controller = new AbortController();
    const current = latest.current;
    for (const service of current.services) {
      const wake = current.byService[service];
      const live =
        wake?.phase === "settled" && wake.answer.kind === "answer" && wake.answer.state === "live";
      if (live) continue;
      setState((s) => wakeStarted(s, service, Date.now()));
      wakeService(service, controller.signal)
        .then((answer) => setState((s) => wakeAnswered(s, service, answer, Date.now())))
        .catch(() => {});
    }
    setNow(Date.now());
    return () => controller.abort();
  }, [attempt]);

  // The elapsed seconds tick only while a wake is in flight.
  const waking = view.state === "waking";
  useEffect(() => {
    if (!waking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [waking]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Review fix 2: a call that met an asleep service closes the gate again and wakes everything —
  // unless a wake is already in flight, which will answer for it.
  const wakingRef = useRef(waking);
  wakingRef.current = waking;
  const rewake = useCallback(() => {
    if (wakingRef.current || latest.current.services.length === 0) return;
    setState((s) => rewakeAll(s, Date.now()));
    setAttempt((n) => n + 1);
  }, []);

  return (
    <GateContext value={{ ready: view.ready, rewake }}>
      <div
        data-gate={view.state}
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[var(--radius)] border border-border bg-surface/60 px-4 py-3 md:px-5"
      >
        <div className="min-w-0 space-y-1.5">
          {view.rows.length === 0 ? (
            <ServiceBadge state="live" service={name} detail="runs inside this page’s server" />
          ) : (
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {view.rows.map((row) => (
                <li key={row.service}>
                  <ServiceBadge state={row.state} service={row.service} detail={row.detail} />
                </li>
              ))}
            </ul>
          )}
          <p className="font-mono text-[11px] leading-relaxed text-fg-muted">
            {gateHint(view.state, name)}
          </p>
        </div>
        {view.retry ? (
          <button type="button" onClick={retry} className={BUTTON_QUIET}>
            wake again
          </button>
        ) : null}
        <p aria-live="polite" className="sr-only">
          {view.announcement}
        </p>
      </div>
      <div className="mt-8">{children}</div>
    </GateContext>
  );
}

function gateHint(state: ReturnType<typeof gateView>["state"], name: string): string {
  switch (state) {
    case "live":
      return `${name} is awake: every action below goes through bastion’s gateway and lands in the audit log.`;
    case "waking":
      return "Free Render services sleep after 15 minutes and take about a minute to wake. Actions unlock when it answers.";
    case "checking":
      return "Asking the service to wake…";
    case "asleep":
      return "It did not wake within 90 seconds. Asleep is not down: try again.";
    case "down":
      return "It is refusing connections or failing. Try again in a while.";
    case "unknown":
      return "bastion could not say whether it is awake. Try again.";
  }
}
