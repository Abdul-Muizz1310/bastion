import type { StepView } from "../step-view";

/**
 * The nudge rule (spec 21 §6.6; carry from Task 5: after a `stage_timeout` nothing advances by
 * itself). Pure: time comes in as `now`, in ms.
 *
 * The frontier stage — the first that is not ok or skipped — is **due** when it is running and its
 * lease has expired (the invocation that claimed it is gone), or it is pending or waiting and its
 * `nextAt` has passed with no lease held. That is exactly when `advance` can claim it. The page
 * nudges `NUDGE_GRACE_MS` after that, because the runner's own chain arrives on time and normally
 * wins; the page is the fallback that keeps a run from stalling for good.
 */

export const NUDGE_GRACE_MS = 5_000;

const SETTLED = new Set(["ok", "skipped"]);

export function frontier(steps: readonly StepView[]): StepView | null {
  return steps.find((s) => !SETTLED.has(s.status)) ?? null;
}

/** A time the stream sent; an unreadable one counts as passed (it can hold nothing off). */
function ms(iso: string | null): number {
  if (iso === null) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** When the stage becomes claimable (ms), or null when it never will by itself. */
export function dueAt(step: StepView): number | null {
  switch (step.status) {
    case "running":
      return ms(step.leaseUntil);
    case "pending":
    case "waiting":
      return Math.max(ms(step.nextAt), ms(step.leaseUntil));
    case "ok":
    case "skipped":
    case "error":
      return null;
  }
}

/** Lease expired (running) OR nextAt passed with no lease held (pending, waiting). */
export function isDue(step: StepView, now: number): boolean {
  const at = dueAt(step);
  return at !== null && at <= now;
}

/** When the page should nudge: the frontier's due time plus the grace; null when it must not. */
export function nudgeAt(steps: readonly StepView[]): number | null {
  const step = frontier(steps);
  if (step === null) return null;
  const at = dueAt(step);
  return at === null ? null : at + NUDGE_GRACE_MS;
}
