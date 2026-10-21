import type { AdvanceResult } from "./runner";
import { STAGE_BUDGET_MS, type Stage, type StepStatus } from "./stages";

/**
 * The foreground loop (spec 21 §6.2, Ruling AM), pure: one request drives successive stages while
 * its budget lasts. Each round asks the runner to claim and run one stage (its claim, lease and
 * fencing are unchanged) with min(240 s, remaining − margin). A round starts only when
 * remaining − margin ≥ MIN_ROUND_MS — a round started with less would time out, burn an attempt,
 * hold its stage off until claim + 300 s, and could spend twice — and only before the caller's
 * slice ends (`startBeforeMs`, the sweep's per-dossier share). The loop continues at once when the
 * next stage is due, sleeps in-process when it is due within INLINE_WAIT_MAX_MS, and stops when the
 * dossier has finished or failed (`done`), when the next stage is further out or nothing will become
 * due (`later`), when the floor is not met (`budget`), when the slice has ended (`slice`), or after
 * MAX_IDLE_ROUNDS rounds in a row that claimed nothing although a stage was due (`contended`).
 *
 * Why: on Vercel an invocation kept alive only by after() did not survive a long stage, while a
 * request with a real client always completes — so the requests real clients make (the page's
 * nudge, the sweep) do the work themselves.
 */

export const DRIVE_MARGIN_MS = 20_000;
export const INLINE_WAIT_MAX_MS = 10_000;
export const MAX_IDLE_ROUNDS = 3;
/** The least a round may be given: the slowest single downstream call (a scrape) takes 90 s. */
export const MIN_ROUND_MS = 100_000;

export type Driver = "visitor" | "sweep";
export type StopReason = "done" | "later" | "budget" | "slice" | "contended";

export type DriveWindow = {
  /** When the caller's request runs out (epoch ms): budgets are measured against it. */
  deadlineMs: number;
  /** No round starts at or after this (epoch ms); the deadline when absent. */
  startBeforeMs?: number;
};
export type DrivenStage = { stage: Stage; status: StepStatus };

export type DriveResult = {
  /** The last round's result; null only when not even one round fit the budget. */
  last: AdvanceResult | null;
  stages: DrivenStage[];
  stopped: StopReason;
};

export type DriveDeps = {
  /** One round: claim and run the next runnable stage within `stageBudgetMs`. */
  advanceOnce: (stageBudgetMs: number) => Promise<AdvanceResult>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/** Whether a round started at `at` gets at least MIN_ROUND_MS after the margin. */
function roundFits(window: DriveWindow, at: number): boolean {
  return window.deadlineMs - at - DRIVE_MARGIN_MS >= MIN_ROUND_MS;
}

export async function driveLoop(window: DriveWindow, deps: DriveDeps): Promise<DriveResult> {
  const startBefore = window.startBeforeMs ?? window.deadlineMs;
  const stages: DrivenStage[] = [];
  let last: AdvanceResult | null = null;
  let idle = 0;
  const stop = (stopped: StopReason): DriveResult => ({ last, stages, stopped });

  for (;;) {
    const now = deps.now();
    if (!roundFits(window, now)) return stop("budget");
    if (now >= startBefore) return stop("slice");
    const remaining = window.deadlineMs - now;
    const result = await deps.advanceOnce(Math.min(STAGE_BUDGET_MS, remaining - DRIVE_MARGIN_MS));
    last = result;
    const claimed = result.ran !== null && result.status !== null;
    if (result.ran !== null && result.status !== null) {
      stages.push({ stage: result.ran, status: result.status });
    }
    if (result.dossier === "succeeded" || result.dossier === "failed") return stop("done");
    if (result.nextAt === null) return stop("later");

    idle = claimed ? 0 : idle + 1;
    if (idle >= MAX_IDLE_ROUNDS) return stop("contended");

    const wait = result.nextAt.getTime() - deps.now();
    if (wait > INLINE_WAIT_MAX_MS) return stop("later");
    if (wait > 0) {
      const wake = deps.now() + wait;
      if (!roundFits(window, wake)) return stop("budget");
      if (wake >= startBefore) return stop("slice");
      await deps.sleep(wait);
    }
  }
}
