import { and, eq, lt, lte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb } from "@/lib/db/client";
import { dossierDocuments, dossierSteps, dossiers } from "@/lib/db/schema";
import {
  claimStep,
  type DossierRow,
  type DossierStatus,
  dossierError,
  dossierStatus,
  nextRunnable,
  retryStep,
  type Stage,
  type StepRow,
  stepRowSchema,
} from "./stages";
import type { OutputSummary, StepSummaryRow } from "./step-summary";

/**
 * The step machine's Postgres adapter (spec 21 §6.2). Every decision is made by the pure functions
 * in `./stages`; this module applies them so that concurrent invocations cannot both win:
 *
 * - a claim is an `UPDATE … WHERE` fenced on the row as it was read (status, attempt) *and* on the
 *   spec's claim predicate (`lease_until < now AND not_before <= now`). Two claimants race on the
 *   row lock; the loser re-evaluates the WHERE against the winner's row and updates nothing.
 * - a result is recorded only while the claim still holds (status running, same attempt, same
 *   lease), so an invocation whose lease expired and was re-claimed cannot overwrite the new run.
 * - `dossiers.status` / `error` are recomputed from the steps in the same transaction as the write.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/** A claim: the row as this invocation read it, and the row it wrote. */
export type Claim = { previous: StepRow; claimed: StepRow };

export type Recorded =
  | { recorded: true; dossier: DossierStatus; steps: StepRow[] }
  | { recorded: false };

export type Reset =
  | { ok: true; dossier: DossierStatus }
  | { ok: false; reason: "not_error" | "later_stage_ok" };

function toStepRow(row: unknown): StepRow {
  return stepRowSchema.parse(row);
}

/** Every column the machine writes, from a row the pure transitions produced. */
function columns(row: StepRow) {
  return {
    status: row.status,
    attempt: row.attempt,
    leaseUntil: row.leaseUntil,
    notBefore: row.notBefore,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    output: row.output,
    error: row.error,
  };
}

async function selectSteps(db: Executor, dossierId: string): Promise<StepRow[]> {
  const rows = await db.select().from(dossierSteps).where(eq(dossierSteps.dossierId, dossierId));
  return rows.map(toStepRow);
}

/** `dossiers.status` and `error`, recomputed from the steps as this transaction sees them. */
async function syncDossier(tx: Tx, dossierId: string, now: Date) {
  const steps = await selectSteps(tx, dossierId);
  const status = dossierStatus(steps);
  await tx
    .update(dossiers)
    .set({ status, error: dossierError(steps), updatedAt: now })
    .where(eq(dossiers.id, dossierId));
  return { status, steps };
}

export async function findDossier(id: string): Promise<DossierRow | null> {
  if (!UUID.test(id)) return null;
  const rows = await getDb().select().from(dossiers).where(eq(dossiers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function loadSteps(dossierId: string): Promise<StepRow[]> {
  if (!UUID.test(dossierId)) return [];
  return selectSteps(getDb(), dossierId);
}

/*
 * The stream's read (spec 21 §6.6): every column but `output`, and a few small projections of it —
 * what `summarize` (./step-summary) reads, with the same types — so a 2 s poll never ships a
 * stage's whole output (gather's holds whole web pages). The keys are constants of this module.
 */
const out = dossierSteps.output;
const field = (key: string) => sql.raw(`'${key}'`);
const text = (key: string) =>
  sql<
    string | null
  >`case when jsonb_typeof(${out}->${field(key)}) = 'string' then nullif(${out}->>${field(key)}, '') end`;
const number = (key: string) =>
  sql<
    number | null
  >`case when jsonb_typeof(${out}->${field(key)}) = 'number' then (${out}->>${field(key)})::float8 end`;
const names = (key: string) =>
  sql<
    string[] | null
  >`case when jsonb_typeof(${out}->${field(key)}) = 'array' and not exists (select 1 from jsonb_array_elements(${out}->${field(key)}) as e(v) where jsonb_typeof(e.v) <> 'string') then ${out}->${field(key)} end`;

const summarySchema: z.ZodType<OutputSummary> = z.object({
  length: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
  live: z.array(z.string()).nullable(),
  asleep: z.array(z.string()).nullable(),
  certified: z.number().nullable(),
  total: z.number().nullable(),
  debateId: z.string().nullable(),
  verdict: z.string().nullable(),
  confidence: z.number().nullable(),
  perfReceiptHash: z.string().nullable(),
  envelopeId: z.string().nullable(),
  auditDigest: z.string().nullable(),
});

const summaryRowSchema = stepRowSchema.omit({ output: true }).extend({ summary: summarySchema });

export async function loadStepSummaries(dossierId: string): Promise<StepSummaryRow[]> {
  if (!UUID.test(dossierId)) return [];
  const rows = await getDb()
    .select({
      dossierId: dossierSteps.dossierId,
      stage: dossierSteps.stage,
      status: dossierSteps.status,
      attempt: dossierSteps.attempt,
      leaseUntil: dossierSteps.leaseUntil,
      notBefore: dossierSteps.notBefore,
      startedAt: dossierSteps.startedAt,
      finishedAt: dossierSteps.finishedAt,
      error: dossierSteps.error,
      length: sql<
        number | null
      >`case when jsonb_typeof(${out}) = 'array' then jsonb_array_length(${out}) end`,
      reason: text("reason"),
      live: names("live"),
      asleep: names("asleep"),
      certified: number("certified"),
      total: number("total"),
      debateId: text("debateId"),
      verdict: text("verdict"),
      confidence: number("confidence"),
      perfReceiptHash: text("perfReceiptHash"),
      envelopeId: text("envelopeId"),
      auditDigest: text("auditDigest"),
    })
    .from(dossierSteps)
    .where(eq(dossierSteps.dossierId, dossierId));
  return rows.map(
    ({
      length,
      reason,
      live,
      asleep,
      certified,
      total,
      debateId,
      verdict,
      confidence,
      perfReceiptHash,
      envelopeId,
      auditDigest,
      ...columns
    }) =>
      summaryRowSchema.parse({
        ...columns,
        summary: {
          length,
          reason,
          live,
          asleep,
          certified,
          total,
          debateId,
          verdict,
          confidence,
          perfReceiptHash,
          envelopeId,
          auditDigest,
        },
      }),
  );
}

/**
 * Claim the dossier's next runnable stage, atomically. The claimed row is `running`, or `error` when
 * an abandoned stage had used its last attempt; null when nothing is claimable (another invocation
 * holds the stage, it is not due yet, the dossier is finished or failed).
 */
export async function claimNext(dossierId: string, now: Date): Promise<StepRow | null> {
  return (await claim(dossierId, now))?.claimed ?? null;
}

/** `claimNext`, also handing back the row as it was read before the claim. */
export async function claim(dossierId: string, now: Date): Promise<Claim | null> {
  if (!UUID.test(dossierId)) return null;
  return getDb().transaction(async (tx) => {
    const steps = await selectSteps(tx, dossierId);
    if (steps.length === 0) return null;
    const stage = nextRunnable(steps, now);
    const observed = steps.find((s) => s.stage === stage);
    if (observed === undefined) return null;
    const claimed = await tx
      .update(dossierSteps)
      .set(columns(claimStep(observed, now)))
      .where(
        and(
          eq(dossierSteps.dossierId, dossierId),
          eq(dossierSteps.stage, observed.stage),
          eq(dossierSteps.status, observed.status),
          eq(dossierSteps.attempt, observed.attempt),
          lt(dossierSteps.leaseUntil, now),
          lte(dossierSteps.notBefore, now),
        ),
      )
      .returning();
    const row = claimed[0];
    if (row === undefined) return null;
    await syncDossier(tx, dossierId, now);
    return { previous: observed, claimed: toStepRow(row) };
  });
}

/** Write a stage's settled row — only while `claimed` still holds the stage. */
export async function recordOutcome(claimed: StepRow, next: StepRow, now: Date): Promise<Recorded> {
  if (next.dossierId !== claimed.dossierId || next.stage !== claimed.stage) {
    throw new RangeError("recordOutcome: next must be the claimed row's successor");
  }
  return getDb().transaction(async (tx) => {
    const written = await tx
      .update(dossierSteps)
      .set(columns(next))
      .where(
        and(
          eq(dossierSteps.dossierId, claimed.dossierId),
          eq(dossierSteps.stage, claimed.stage),
          eq(dossierSteps.status, "running"),
          eq(dossierSteps.attempt, claimed.attempt),
          eq(dossierSteps.leaseUntil, claimed.leaseUntil),
        ),
      )
      .returning({ stage: dossierSteps.stage });
    if (written.length === 0) return { recorded: false };
    const { status, steps } = await syncDossier(tx, claimed.dossierId, now);
    return { recorded: true, dossier: status, steps };
  });
}

/** Reset an `error` stage for "retry from this stage" — the steps are locked while deciding. */
export async function resetStep(dossierId: string, stage: Stage, now: Date): Promise<Reset> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(dossierSteps)
      .where(eq(dossierSteps.dossierId, dossierId))
      .for("update");
    const steps = rows.map(toStepRow);
    if (steps.length === 0) return { ok: false, reason: "not_error" };
    const decision = retryStep(steps, stage, now);
    if (!decision.ok) return decision;
    await tx
      .update(dossierSteps)
      .set(columns(decision.row))
      .where(and(eq(dossierSteps.dossierId, dossierId), eq(dossierSteps.stage, stage)));
    const { status } = await syncDossier(tx, dossierId, now);
    return { ok: true, dossier: status };
  });
}

export type NewDossier = typeof dossiers.$inferInsert;
export type NewDossierDocument = typeof dossierDocuments.$inferInsert;

/**
 * Creates a dossier, its step rows and its documents in ONE transaction: a dossier without step
 * rows would verify as `steps: fail`, so no partial dossier may ever be visible.
 */
export async function insertDossier(
  dossier: NewDossier,
  steps: readonly StepRow[],
  documents: readonly NewDossierDocument[],
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.insert(dossiers).values(dossier);
    await tx.insert(dossierSteps).values(steps.map(columnsWithKey));
    if (documents.length > 0) await tx.insert(dossierDocuments).values([...documents]);
  });
}

function columnsWithKey(row: StepRow) {
  return { dossierId: row.dossierId, stage: row.stage, ...columns(row) };
}
