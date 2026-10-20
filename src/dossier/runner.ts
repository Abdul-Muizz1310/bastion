import { type Actor, SYSTEM_ACTOR } from "@/platform/audit/event";
import { appendEvent } from "@/platform/audit/write";
import {
  applyOutcome,
  applyTimeout,
  claimableAt,
  type DossierRow,
  type DossierStatus,
  dossierStatus,
  STAGE_BUDGET_MS,
  type Stage,
  type StageContext,
  type StageHandler,
  type StageOutcome,
  type StepRow,
  type StepStatus,
  stageOutputs,
} from "./stages";
import { claim, findDossier, loadSteps, recordOutcome, resetStep } from "./store";

/**
 * The durable runner (spec 21 §6.2, DR-0035): `advance` claims the dossier's next runnable stage,
 * runs **one** stage handler within the stage budget, records the outcome and returns. It is
 * idempotent — a concurrent caller finds nothing to claim — and never lets a handler's failure
 * escape: a throw or an overrun becomes a retryable error on the row (an overrun is held off until
 * the claiming invocation is gone), a malformed outcome a non-retryable one. A recorded outcome that
 * changes the row's status or attempt appends one audit event, acting as `bastion` (ruling O).
 */

/**
 * `ran`/`status`: the stage this invocation ran and the status it recorded — both null when nothing
 * was claimable; `status` alone is null when the result was discarded because the lease was lost.
 * `nextAt`: when the next stage becomes claimable (null once the dossier is finished or failed).
 */
export type AdvanceResult = {
  ran: Stage | null;
  status: StepStatus | null;
  dossier: DossierStatus;
  nextAt: Date | null;
};

export type AdvanceOptions = { now?: () => Date; stageBudgetMs?: number };

export type RetryResult =
  | { ok: true; dossier: DossierStatus }
  | { ok: false; reason: "unknown_dossier" | "not_error" | "later_stage_ok" };

export class UnknownDossierError extends Error {
  readonly dossierId: string;

  constructor(dossierId: string) {
    super(`unknown dossier: ${dossierId}`);
    this.name = "UnknownDossierError";
    this.dossierId = dossierId;
  }
}

const systemClock = () => new Date();

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How a handler run ended: with an outcome (a throw becomes a retryable error), or out of time. */
type Run = { kind: "settled"; outcome: StageOutcome } | { kind: "timeout" };

/**
 * Run a handler within its budget. At the budget its `signal` is aborted and the runner stops
 * waiting; the handler itself may run on, which `applyTimeout` accounts for.
 */
async function runHandler(
  handler: StageHandler,
  base: Omit<StageContext, "signal">,
  budgetMs: number,
): Promise<Run> {
  const budget = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overrun = new Promise<Run>((resolve) => {
    timer = setTimeout(() => {
      budget.abort(new DOMException(`stage budget of ${budgetMs} ms exceeded`, "TimeoutError"));
      resolve({ kind: "timeout" });
    }, budgetMs);
  });
  const run = Promise.resolve()
    .then(() => handler({ ...base, signal: budget.signal }))
    .then(
      (outcome): Run => ({ kind: "settled", outcome }),
      (err: unknown): Run => ({
        kind: "settled",
        outcome: { kind: "error", error: `stage_threw: ${message(err)}`, retryable: true },
      }),
    );
  try {
    return await Promise.race([run, overrun]);
  } finally {
    clearTimeout(timer);
  }
}

/** The settled row; an outcome the machine refuses (e.g. a bad delay) fails the stage instead. */
function settle(claimed: StepRow, run: Run, now: Date, budgetMs: number): StepRow {
  switch (run.kind) {
    case "timeout":
      return applyTimeout(claimed, now, budgetMs);
    case "settled":
      try {
        return applyOutcome(claimed, run.outcome, now);
      } catch (err) {
        return applyOutcome(
          claimed,
          { kind: "error", error: `invalid_outcome: ${message(err)}`, retryable: false },
          now,
        );
      }
    default:
      throw new TypeError(`unexpected run: ${JSON.stringify(run satisfies never)}`);
  }
}

/**
 * Ruling O: a stage outcome is audited only when it changes the row's status or attempt, so the
 * polls of a waiting stage write one `dossier.stage.waiting` row, not one every 3 s; each failed
 * attempt is still audited (pending → pending with a new attempt).
 */
function isTransition(previous: StepRow, next: StepRow): boolean {
  return previous.status !== next.status || previous.attempt !== next.attempt;
}

async function auditOutcome(dossier: DossierRow, row: StepRow): Promise<void> {
  await appendEvent({
    actor: SYSTEM_ACTOR,
    action: `dossier.stage.${row.status}`,
    entityType: "dossier",
    entityId: dossier.id,
    service: "bastion",
    requestId: dossier.requestId,
    metadata: {
      stage: row.stage,
      attempt: row.attempt,
      ...(row.error === null ? {} : { error: row.error }),
    },
  });
}

async function idle(dossier: DossierRow, ran: Stage | null): Promise<AdvanceResult> {
  const steps = await loadSteps(dossier.id);
  if (steps.length === 0) {
    // A v1 dossier has no step machine: report what it stored and run nothing.
    return { ran: null, status: null, dossier: dossier.status, nextAt: null };
  }
  return { ran, status: null, dossier: dossierStatus(steps), nextAt: claimableAt(steps) };
}

export async function advance(
  dossierId: string,
  handlers: Readonly<Record<Stage, StageHandler>>,
  options: AdvanceOptions = {},
): Promise<AdvanceResult> {
  const now = options.now ?? systemClock;
  const dossier = await findDossier(dossierId);
  if (dossier === null) throw new UnknownDossierError(dossierId);

  const claimedPair = await claim(dossier.id, now());
  if (claimedPair === null) return idle(dossier, null);
  const { previous, claimed } = claimedPair;

  if (claimed.status === "error") {
    // An abandoned stage on its last attempt: the claim itself failed it (and synced the dossier).
    await auditOutcome(dossier, claimed);
    const steps = await loadSteps(dossier.id);
    return {
      ran: claimed.stage,
      status: claimed.status,
      dossier: dossierStatus(steps),
      nextAt: claimableAt(steps),
    };
  }

  const steps = await loadSteps(dossier.id);
  const budgetMs = options.stageBudgetMs ?? STAGE_BUDGET_MS;
  const run = await runHandler(
    handlers[claimed.stage],
    {
      dossier,
      requestId: dossier.requestId,
      outputs: stageOutputs(steps, claimed.stage),
      now: now(),
      attempt: claimed.attempt,
      startedAt: claimed.startedAt ?? now(),
    },
    budgetMs,
  );
  const finished = now();
  const next = settle(claimed, run, finished, budgetMs);
  const recorded = await recordOutcome(claimed, next, finished);
  if (!recorded.recorded) {
    console.warn("dossier runner: lease lost before recording; result discarded", {
      dossierId: dossier.id,
      stage: claimed.stage,
      attempt: claimed.attempt,
    });
    return idle(dossier, claimed.stage);
  }
  if (isTransition(previous, next)) await auditOutcome(dossier, next);
  return {
    ran: claimed.stage,
    status: next.status,
    dossier: recorded.dossier,
    nextAt: claimableAt(recorded.steps),
  };
}

/** "Retry from this stage" (spec §6.4), on behalf of `actor`; audited when it resets the stage. */
export async function retryStage(
  dossierId: string,
  stage: Stage,
  actor: Actor,
  now: Date = new Date(),
): Promise<RetryResult> {
  const dossier = await findDossier(dossierId);
  if (dossier === null) return { ok: false, reason: "unknown_dossier" };
  const reset = await resetStep(dossier.id, stage, now);
  if (!reset.ok) return reset;
  await appendEvent({
    actor,
    action: "dossier.stage.retry",
    entityType: "dossier",
    entityId: dossier.id,
    service: "bastion",
    requestId: dossier.requestId,
    metadata: { stage },
  });
  return reset;
}
