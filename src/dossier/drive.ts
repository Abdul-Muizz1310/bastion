import type { AdvanceResult } from "./runner";
import { STAGE_BUDGET_MS, type Stage, type StepStatus } from "./stages";

/**
 * The foreground loop (spec 21 §6.2), pure: one request drives successive stages while its budget
 * lasts. Each round asks the runner to claim and run one stage (its claim, lease and fencing are
 * unchanged) with min(240 s, remaining − margin); the loop continues at once when the next stage is
 * due, sleeps in-process when it is due within INLINE_WAIT_MAX_MS, and stops when the dossier has
 * finished or failed (`done`), when the next stage is further out or nothing will become due
 * (`later`), when less than the margin remains (`budget`), or after MAX_IDLE_ROUNDS rounds in a row
 * that claimed nothing although a stage was due (`contended`: another caller is driving it).
 *
 * Why: on Vercel an invocation kept alive only by after() and called by another such invocation did
 * not survive a 13.7 s stage, while a request with a real client always completes — so the request
 * a real client makes (the page's nudge, the sweep) does the work itself.
 */

export const DRIVE_MARGIN_MS = 20_000;
export const INLINE_WAIT_MAX_MS = 10_000;
export const MAX_IDLE_ROUNDS = 3;

export type Driver = "chain" | "visitor" | "sweep";
export type StopReason = "done" | "later" | "budget" | "contended";
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

export async function driveLoop(deadlineMs: number, deps: DriveDeps): Promise<DriveResult> {
  const stages: DrivenStage[] = [];
  let last: AdvanceResult | null = null;
  let idle = 0;
  const stop = (stopped: StopReason): DriveResult => ({ last, stages, stopped });

  for (;;) {
    const remaining = deadlineMs - deps.now();
    if (remaining < DRIVE_MARGIN_MS) return stop("budget");
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
      if (deps.now() + wait > deadlineMs - DRIVE_MARGIN_MS) return stop("budget");
      await deps.sleep(wait);
    }
  }
}
