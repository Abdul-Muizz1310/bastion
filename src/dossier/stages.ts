import { z } from "zod/v4";
import type { Dossier } from "@/lib/db/schema";
import { DOSSIER_STAGES, STEP_STATUSES } from "@/lib/db/schema";
import type { Json } from "@/platform/canonical-json";

/**
 * The dossier step machine (spec 21 §6.2, §6.4; DR-0035) — pure. A dossier is eight `dossier_steps`
 * rows advanced one stage per invocation. These functions decide which stage may run, what a claim
 * and a stage outcome do to its row, and what the dossier's status is; the store applies their
 * decisions atomically and the runner calls the stage handlers.
 *
 * Attempts: `attempt` counts attempts *started*. Claiming a pending stage, or re-claiming one whose
 * lease expired (a crashed invocation), starts a new attempt; claiming a `waiting` stage continues
 * the current one, so polling a long downstream job never spends attempts. A retryable error goes
 * back to `pending` after a short backoff until the third attempt, then the stage is an `error`.
 */

export const STAGES = DOSSIER_STAGES;
export type Stage = (typeof STAGES)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type DossierStatus = "pending" | "running" | "succeeded" | "failed";
export type DossierRow = Dossier;

export type { Json };

/** One stage's attempt budget; the lease outlives it so the result can still be recorded. */
export const STAGE_BUDGET_MS = 240_000;
export const LEASE_MS = 270_000;
/** How long a waiting stage (a running downstream job) sleeps between polls. */
export const POLL_MS = 3_000;
export const MAX_ATTEMPTS = 3;
/** Backoff after a retryable error, per attempt already spent (5 s, then 10 s). */
export const RETRY_DELAY_MS = 5_000;
/**
 * After a stage overruns its budget its handler may still be running in the invocation that claimed
 * it, which the platform ends at claim + maxDuration (300 s = LEASE_MS + this grace). Until then the
 * stage is not runnable again, so it can never run twice at once (review fix 1).
 */
export const TIMEOUT_GRACE_MS = 30_000;
/** How long one attempt may keep answering `waiting` before it fails as `wait_timeout`. */
export const MAX_WAIT_MS = 15 * 60_000;
const ERROR_MAX_CHARS = 1_000;
const EPOCH = new Date(0);

export type StepRow = {
  dossierId: string;
  stage: Stage;
  status: StepStatus;
  attempt: number;
  leaseUntil: Date;
  notBefore: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  output: Json;
  error: string | null;
};

export const stepRowSchema = z.object({
  dossierId: z.string(),
  stage: z.enum(STAGES),
  status: z.enum(STEP_STATUSES),
  attempt: z.number().int().nonnegative(),
  leaseUntil: z.date(),
  notBefore: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  output: z.json(),
  error: z.string().nullable(),
});

export type StageOutcome =
  | { kind: "ok"; output: Json }
  | { kind: "skipped"; reason: string }
  | { kind: "waiting"; output: Json; retryInMs: number }
  /**
   * An error keeps the stage's stored output (a stored job or debate id survives a retry) unless it
   * carries its own `output`, which replaces it (Ruling T: a failed debate's id is cleared).
   */
  | { kind: "error"; error: string; retryable: boolean; output?: Json };

export type StageContext = {
  dossier: DossierRow;
  requestId: string;
  outputs: Partial<Record<Stage, Json>>;
  now: Date;
  /** The current attempt (1-based), and when it started: polls keep both, a retry resets them. */
  attempt: number;
  startedAt: Date;
  /** Aborted when the stage's budget runs out: pass it to every downstream call. */
  signal: AbortSignal;
};

export type StageHandler = (ctx: StageContext) => Promise<StageOutcome>;

export type RetryDecision =
  | { ok: true; row: StepRow }
  | { ok: false; reason: "not_error" | "later_stage_ok" };

const DONE: ReadonlySet<StepStatus> = new Set(["ok", "skipped"]);

function assertNever(value: never, what: string): never {
  throw new TypeError(`unexpected ${what}: ${JSON.stringify(value)}`);
}

/** The eight rows a new dossier starts with: pending, unleased, runnable from `now`. */
export function initialSteps(dossierId: string, now: Date): StepRow[] {
  return STAGES.map((stage) => ({
    dossierId,
    stage,
    status: "pending",
    attempt: 0,
    leaseUntil: EPOCH,
    notBefore: now,
    startedAt: null,
    finishedAt: null,
    output: {},
    error: null,
  }));
}

/** The rows in stage order — refusing anything but exactly one row per stage of one dossier. */
function ordered(steps: readonly StepRow[]): StepRow[] {
  const byStage = new Map<Stage, StepRow>();
  for (const step of steps) {
    if (byStage.has(step.stage)) throw new RangeError(`duplicate step: ${step.stage}`);
    byStage.set(step.stage, step);
  }
  const dossierIds = new Set(steps.map((s) => s.dossierId));
  if (dossierIds.size > 1) throw new RangeError("steps belong to more than one dossier");
  return STAGES.map((stage) => {
    const step = byStage.get(stage);
    if (step === undefined) throw new RangeError(`missing step: ${stage}`);
    return step;
  });
}

/** The first stage that is not ok/skipped — the only one that may run — or null when all are. */
function frontier(steps: readonly StepRow[]): StepRow | null {
  return ordered(steps).find((s) => !DONE.has(s.status)) ?? null;
}

function isClaimable(step: StepRow, now: Date): boolean {
  const unleased = step.leaseUntil.getTime() < now.getTime();
  const due = step.notBefore.getTime() <= now.getTime();
  switch (step.status) {
    case "pending":
    case "waiting":
    case "running":
      return unleased && due;
    case "ok":
    case "skipped":
    case "error":
      return false;
    default:
      return assertNever(step.status, "step status");
  }
}

/** The stage a runner may claim now: the frontier stage, if its lease and not_before allow it. */
export function nextRunnable(steps: readonly StepRow[], now: Date): Stage | null {
  const step = frontier(steps);
  return step !== null && isClaimable(step, now) ? step.stage : null;
}

/** When the frontier stage becomes claimable; null when the dossier has finished or failed. */
export function claimableAt(steps: readonly StepRow[]): Date | null {
  const step = frontier(steps);
  if (step === null || step.status === "error") return null;
  return new Date(Math.max(step.notBefore.getTime(), step.leaseUntil.getTime()));
}

/**
 * A claim on a claimable row (pure): it becomes `running` under a fresh lease. An abandoned row
 * (running, lease expired) that has already used its last attempt becomes an `error` instead.
 */
export function claimStep(row: StepRow, now: Date): StepRow {
  if (!isClaimable(row, now)) {
    throw new RangeError(`claimStep: ${row.stage} (${row.status}) is not claimable`);
  }
  if (row.status === "running" && row.attempt >= MAX_ATTEMPTS) {
    return {
      ...row,
      status: "error",
      leaseUntil: EPOCH,
      finishedAt: now,
      error: `lease_expired: attempt ${row.attempt} of ${MAX_ATTEMPTS} did not finish`,
    };
  }
  const continuing = row.status === "waiting";
  return {
    ...row,
    status: "running",
    attempt: continuing ? row.attempt : row.attempt + 1,
    leaseUntil: new Date(now.getTime() + LEASE_MS),
    startedAt: continuing ? (row.startedAt ?? now) : now,
    finishedAt: null,
  };
}

function assertDelay(retryInMs: number): void {
  if (!Number.isInteger(retryInMs) || retryInMs < 0 || retryInMs > LEASE_MS) {
    throw new RangeError(`retryInMs must be a whole number of ms in 0..${LEASE_MS}`);
  }
}

/** What a stage's outcome does to its (running) row — pure; attempts are counted at claim time. */
export function applyOutcome(row: StepRow, outcome: StageOutcome, now: Date): StepRow {
  if (row.status !== "running") {
    throw new RangeError(`applyOutcome: ${row.stage} is ${row.status}, not running`);
  }
  if (row.startedAt === null) {
    throw new RangeError(`applyOutcome: running ${row.stage} has no start`);
  }
  const released = { ...row, leaseUntil: EPOCH };
  switch (outcome.kind) {
    case "ok":
      return { ...released, status: "ok", output: outcome.output, finishedAt: now, error: null };
    case "skipped":
      return {
        ...released,
        status: "skipped",
        output: { reason: outcome.reason },
        finishedAt: now,
        error: null,
      };
    case "waiting":
      assertDelay(outcome.retryInMs);
      if (now.getTime() - row.startedAt.getTime() > MAX_WAIT_MS) {
        return {
          ...released,
          status: "error",
          output: outcome.output,
          finishedAt: now,
          error: `wait_timeout: still waiting ${MAX_WAIT_MS / 60_000} min after the attempt started`,
        };
      }
      return {
        ...released,
        status: "waiting",
        output: outcome.output,
        notBefore: new Date(now.getTime() + outcome.retryInMs),
        finishedAt: null,
        error: null,
      };
    case "error": {
      const error = outcome.error.slice(0, ERROR_MAX_CHARS);
      const output = outcome.output === undefined ? row.output : outcome.output;
      if (outcome.retryable && row.attempt < MAX_ATTEMPTS) {
        return {
          ...released,
          output,
          status: "pending",
          notBefore: new Date(now.getTime() + RETRY_DELAY_MS * row.attempt),
          finishedAt: null,
          error,
        };
      }
      return { ...released, output, status: "error", finishedAt: now, error };
    }
    default:
      return assertNever(outcome, "stage outcome");
  }
}

/**
 * A stage that outlived its budget (pure): a retryable `stage_timeout`, never runnable again before
 * claim + maxDuration (the lease's end + TIMEOUT_GRACE_MS) — also when it is terminal, so that a
 * visitor's retry keeps the same floor.
 */
export function applyTimeout(row: StepRow, now: Date, budgetMs: number = STAGE_BUDGET_MS): StepRow {
  const next = applyOutcome(
    row,
    { kind: "error", error: `stage_timeout: exceeded ${budgetMs} ms`, retryable: true },
    now,
  );
  const floor = row.leaseUntil.getTime() + TIMEOUT_GRACE_MS;
  return { ...next, notBefore: new Date(Math.max(next.notBefore.getTime(), floor)) };
}

/** The dossier's status, read off its steps (it drives `dossiers.status`). */
export function dossierStatus(steps: readonly StepRow[]): DossierStatus {
  const rows = ordered(steps);
  if (rows.some((s) => s.status === "error")) return "failed";
  if (rows.every((s) => DONE.has(s.status))) return "succeeded";
  if (rows.every((s) => s.status === "pending" && s.attempt === 0)) return "pending";
  return "running";
}

/** `<stage>: <error>` for the failed stage — what `dossiers.error` shows — or null. */
export function dossierError(steps: readonly StepRow[]): string | null {
  const failed = ordered(steps).find((s) => s.status === "error");
  return failed === undefined ? null : `${failed.stage}: ${failed.error ?? "unknown error"}`;
}

/** What a stage's handler sees: every earlier stage's output and its own stored output. */
export function stageOutputs(
  steps: readonly StepRow[],
  stage: Stage,
): Partial<Record<Stage, Json>> {
  const rows = ordered(steps);
  const upTo = STAGES.indexOf(stage);
  return Object.fromEntries(rows.slice(0, upTo + 1).map((s) => [s.stage, s.output]));
}

/**
 * "Retry from this stage" (spec §6.4): only an `error` stage, and only while nothing after it is ok.
 * The row starts over — pending, attempt 0 — but keeps its output, so a stored job id is reused,
 * and keeps any later not_before (a timed-out stage's floor), so a retry never makes it run sooner.
 */
export function retryStep(steps: readonly StepRow[], stage: Stage, now: Date): RetryDecision {
  const rows = ordered(steps);
  const index = STAGES.indexOf(stage);
  const row = rows[index];
  if (row === undefined || row.status !== "error") return { ok: false, reason: "not_error" };
  if (rows.slice(index + 1).some((s) => s.status === "ok")) {
    return { ok: false, reason: "later_stage_ok" };
  }
  return {
    ok: true,
    row: {
      ...row,
      status: "pending",
      attempt: 0,
      leaseUntil: EPOCH,
      notBefore: new Date(Math.max(now.getTime(), row.notBefore.getTime())),
      startedAt: null,
      finishedAt: null,
      error: null,
    },
  };
}
