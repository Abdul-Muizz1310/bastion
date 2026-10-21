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
  claimRewake,
  gateView,
  initialWake,
  rewakeAll,
  rewakePlan,
  type SideWakes,
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

type GateControls = {
  ready: boolean;
  services: readonly ServiceId[];
  /** Wakes what an asleep answer from `target` (default: the gate's own service) calls for. */
  rewake: (target?: ServiceId) => void;
  /** Routed hosts woken in the background, with their answers once they come (review round 3). */
  side: SideWakes;
};

const GateContext = createContext<GateControls>({
  ready: false,
  services: [],
  rewake: () => {},
  side: {},
});

/** Whether the product this workbench operates is live (false outside a gate). */
export function useWakeReady(): boolean {
  return useContext(GateContext).ready;
}

/** What an action that met an asleep service calls (Ruling AI: the gate, a routed host, or none). */
export function useRewake(): (target?: ServiceId) => void {
  return useContext(GateContext).rewake;
}

/** The services this gate wakes — what a notice names when it says what is being woken. */
export function useGateServices(): readonly ServiceId[] {
  return useContext(GateContext).services;
}

/** The background wakes and their answers, so a notice never claims a wake that was refused. */
export function useSideWakes(): SideWakes {
  return useContext(GateContext).side;
}

export function WakeGate({
  name,
  services,
  initial,
  initialSide,
  children,
}: {
  name: string;
  services: readonly ServiceId[];
  /** The state to render before any wake answers (tests seed it). */
  initial?: WakeState;
  /** Background wakes to render before any answers (tests seed them). */
  initialSide?: SideWakes;
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

  // Review fix 2 and Ruling AI: an asleep answer from the gate's own service closes the gate again
  // and wakes everything (the latch lets only the first of parallel answers through); one from a
  // routed host wakes that host in the background; with nothing to wake, nothing happens.
  const wakingRef = useRef(waking);
  wakingRef.current = waking;
  // Review round 3: each background wake's answer is kept (the wake route's 5 a minute limit can
  // refuse it), so the notice says what really happened.
  const [side, setSide] = useState<SideWakes>(initialSide ?? {});
  const sideRef = useRef(side);
  sideRef.current = side;
  const sideAbort = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    sideAbort.current = controller;
    return () => controller.abort();
  }, []);
  const rewake = useCallback((target?: ServiceId) => {
    const plan = rewakePlan(latest.current.services, target);
    if (plan.kind === "none") return;
    if (plan.kind === "side") {
      const service = plan.service;
      if (sideRef.current[service]?.phase === "waking") return;
      sideRef.current = { ...sideRef.current, [service]: { phase: "waking" } };
      setSide((s) => ({ ...s, [service]: { phase: "waking" } }));
      void wakeService(service, sideAbort.current.signal)
        .then((answer) => setSide((s) => ({ ...s, [service]: { phase: "done", answer } })))
        .catch(() => {});
      return;
    }
    if (!claimRewake(wakingRef)) return;
    setState((s) => rewakeAll(s, Date.now()));
    setAttempt((n) => n + 1);
  }, []);

  return (
    <GateContext value={{ ready: view.ready, services, rewake, side }}>
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
