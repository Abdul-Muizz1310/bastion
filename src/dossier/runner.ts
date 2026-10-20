import { type Actor, SYSTEM_ACTOR } from "@/platform/audit/event";
import { appendEvent } from "@/platform/audit/write";
import {
  applyOutcome,
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
import { claimNext, findDossier, loadSteps, recordOutcome, resetStep } from "./store";

/**
 * The durable runner (spec 21 §6.2, DR-0035): `advance` claims the dossier's next runnable stage,
 * runs **one** stage handler within the stage budget, records the outcome and returns. It is
 * idempotent — a concurrent caller finds nothing to claim — and never lets a handler's failure
 * escape: a throw or an overrun becomes a retryable error on the row, a malformed outcome a
 * non-retryable one. Every recorded outcome appends one audit event, acting as `bastion`.
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

/** The handler's outcome — or a retryable error if it throws or outlives the budget. */
async function runHandler(
  handler: StageHandler,
  ctx: StageContext,
  budgetMs: number,
): Promise<StageOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overrun = new Promise<StageOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          kind: "error",
          error: `stage_timeout: exceeded ${budgetMs} ms`,
          retryable: true,
        }),
      budgetMs,
    );
  });
  const run = Promise.resolve()
    .then(() => handler(ctx))
    .catch(
      (err: unknown): StageOutcome => ({
        kind: "error",
        error: `stage_threw: ${message(err)}`,
        retryable: true,
      }),
    );
  try {
    return await Promise.race([run, overrun]);
  } finally {
    clearTimeout(timer);
  }
}

/** The settled row; an outcome the machine refuses (e.g. a bad delay) fails the stage instead. */
function settle(claimed: StepRow, outcome: StageOutcome, now: Date): StepRow {
  try {
    return applyOutcome(claimed, outcome, now);
  } catch (err) {
    return applyOutcome(
      claimed,
      { kind: "error", error: `invalid_outcome: ${message(err)}`, retryable: false },
      now,
    );
  }
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

  const claimed = await claimNext(dossier.id, now());
  if (claimed === null) return idle(dossier, null);

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
  const ctx: StageContext = {
    dossier,
    requestId: dossier.requestId,
    outputs: stageOutputs(steps, claimed.stage),
    now: now(),
  };
  const outcome = await runHandler(
    handlers[claimed.stage],
    ctx,
    options.stageBudgetMs ?? STAGE_BUDGET_MS,
  );
  const finished = now();
  const next = settle(claimed, outcome, finished);
  const recorded = await recordOutcome(claimed, next, finished);
  if (!recorded.recorded) {
    console.warn("dossier runner: lease lost before recording; result discarded", {
      dossierId: dossier.id,
      stage: claimed.stage,
      attempt: claimed.attempt,
    });
    return idle(dossier, claimed.stage);
  }
  await auditOutcome(dossier, next);
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
