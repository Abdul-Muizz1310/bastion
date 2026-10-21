import type { StepView } from "../step-view";
import type { DossierStatus } from "./events";
import { frontier, isDue, NUDGE_GRACE_MS, nudgeAt } from "./nudge";

/**
 * The page's fallback driver of a run (spec 21 §6.6, "The nudge"): given the latest steps, it
 * calls `advance` once the frontier stage has been due for the grace period.
 *
 * - single-flight: at most one call at a time; steps that arrive meanwhile are planned after it;
 * - an answered call holds the next nudge until the `nextAt` it named (plus the grace), so a stream
 *   that has not caught up yet cannot make the page hammer the runner;
 * - a 429 waits the `retryAfterS` it was given; any other failure (a throw included) backs off 15 s,
 *   doubling to 2 min, and a success resets that;
 * - a 404 (the dossier is gone) stops it for good; an error stage or a finished dossier plans none;
 * - `pause` (a hidden tab) plans nothing — a call in flight still settles — and `resume` plans afresh;
 * - `dispose` aborts the call in flight and plans nothing more.
 */

export type AdvanceOutcome =
  | { kind: "ok"; nextAt: string | null; dossier: DossierStatus }
  | { kind: "rate_limited"; retryAfterS: number }
  | { kind: "gone" }
  | { kind: "failed"; detail: string };

export type NudgerDeps = {
  advance: (signal: AbortSignal) => Promise<AdvanceOutcome>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Told after every call the nudger made, for the page's one-line account. */
  onNudge?: (outcome: AdvanceOutcome, at: number) => void;
};

export type NudgerStatus = { inFlight: boolean; stopped: boolean; holdUntil: number };

export type Nudger = {
  update(steps: readonly StepView[]): void;
  /** The tab is hidden: plan nothing (a call in flight settles); `resume` plans afresh. */
  pause(): void;
  resume(): void;
  dispose(): void;
  status(): NudgerStatus;
};

export const FAILURE_BACKOFF_MS = 15_000;
export const MAX_BACKOFF_MS = 120_000;

export function createNudger(deps: NudgerDeps): Nudger {
  let steps: readonly StepView[] = [];
  let timer: unknown = null;
  let controller: AbortController | null = null;
  let holdUntil = 0;
  let failures = 0;
  let stopped = false;
  let disposed = false;
  let paused = false;

  function clear(): void {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function plan(): void {
    clear();
    if (disposed || stopped || paused || controller !== null) return;
    const at = nudgeAt(steps);
    if (at === null) return;
    const when = Math.max(at, holdUntil);
    timer = deps.setTimer(fire, Math.max(0, when - deps.now()));
  }

  function settle(outcome: AdvanceOutcome, now: number): void {
    switch (outcome.kind) {
      case "ok": {
        failures = 0;
        const named = outcome.nextAt === null ? 0 : Date.parse(outcome.nextAt);
        holdUntil = Math.max(now, Number.isNaN(named) ? 0 : named) + NUDGE_GRACE_MS;
        return;
      }
      case "rate_limited":
        holdUntil = now + Math.max(1, outcome.retryAfterS) * 1000;
        return;
      case "gone":
        stopped = true;
        return;
      case "failed":
        failures += 1;
        holdUntil = now + Math.min(FAILURE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
        return;
    }
  }

  function fire(): void {
    timer = null;
    if (disposed || stopped || paused || controller !== null) return;
    const now = deps.now();
    const step = frontier(steps);
    if (step === null || !isDue(step, now - NUDGE_GRACE_MS) || now < holdUntil) {
      plan();
      return;
    }
    const current = new AbortController();
    controller = current;
    void deps
      .advance(current.signal)
      .catch((err: unknown): AdvanceOutcome | null =>
        current.signal.aborted
          ? null
          : { kind: "failed", detail: err instanceof Error ? err.message : String(err) },
      )
      .then((outcome) => {
        if (current.signal.aborted || outcome === null) return;
        controller = null;
        const at = deps.now();
        settle(outcome, at);
        deps.onNudge?.(outcome, at);
        plan();
      });
  }

  return {
    update(next) {
      steps = next;
      if (controller === null) plan();
    },
    pause() {
      paused = true;
      clear();
    },
    resume() {
      paused = false;
      plan();
    },
    dispose() {
      disposed = true;
      clear();
      controller?.abort();
      controller = null;
    },
    status() {
      return { inFlight: controller !== null, stopped, holdUntil };
    },
  };
}
