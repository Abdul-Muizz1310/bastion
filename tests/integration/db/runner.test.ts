import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { advance } from "@/dossier/runner";
import {
  initialSteps,
  LEASE_MS,
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  STAGES,
  type Stage,
  type StageHandler,
  type StageOutcome,
  type StepRow,
} from "@/dossier/stages";
import { claimNext, loadSteps, recordOutcome, resetStep } from "@/dossier/store";
import { getDb } from "@/lib/db/client";
import { dossierSteps, dossiers, events } from "@/lib/db/schema";

/**
 * Spec 21 §6.2 / §10 — the durable runner against a real Postgres: stage claiming and leases (two
 * concurrent advancers, one wins), lease expiry, fenced recording, the dossier status kept in step
 * with the steps, and "retry from this stage".
 *
 * These tests COMMIT rows — dossiers (deleted afterwards, cascading to their steps) and audit
 * events (append-only, so they stay). They therefore run only against a local, disposable server:
 * CI's service container or `docker run -p 5433:5432 -e POSTGRES_PASSWORD=pg postgres:16`, migrated
 * with `node scripts/migrate.mjs --force`. Any other DATABASE_URL (Neon) skips them.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(DATABASE_URL);

const EPOCH = new Date(0);
const created: string[] = [];

async function newDossier(t0: Date, steps = true): Promise<string> {
  const id = randomUUID();
  created.push(id);
  await getDb()
    .insert(dossiers)
    .values({
      id,
      visitor: "v_kk6eooepno",
      claim: "integration: the runner claims each stage once",
      sources: [],
      mode: "rapid",
      status: "pending",
      requestId: `it-runner-${id}`,
    });
  if (steps) await getDb().insert(dossierSteps).values(initialSteps(id, t0));
  return id;
}

async function setStep(id: string, stage: Stage, values: Partial<StepRow>): Promise<void> {
  await getDb()
    .update(dossierSteps)
    .set(values)
    .where(and(eq(dossierSteps.dossierId, id), eq(dossierSteps.stage, stage)));
}

async function step(id: string, stage: Stage): Promise<StepRow> {
  const found = (await loadSteps(id)).find((s) => s.stage === stage);
  if (found === undefined) throw new Error(`no ${stage} row`);
  return found;
}

async function dossierRow(id: string) {
  const [row] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
  return row;
}

const after = (t0: Date, ms: number) => new Date(t0.getTime() + ms);

/** Handlers that answer ok (gather skipped), counting calls and overlapping for `delayMs`. */
function countingHandlers(delayMs: number) {
  const calls = new Map<Stage, number>();
  const make =
    (stage: Stage): StageHandler =>
    async () => {
      calls.set(stage, (calls.get(stage) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, delayMs));
      const outcome: StageOutcome =
        stage === "gather"
          ? { kind: "skipped", reason: "no sources" }
          : { kind: "ok", output: { stage } };
      return outcome;
    };
  const map = Object.fromEntries(STAGES.map((stage) => [stage, make(stage)])) as Record<
    Stage,
    StageHandler
  >;
  return { map, calls };
}

afterAll(async () => {
  if (LOCAL && created.length > 0) {
    await getDb().delete(dossiers).where(inArray(dossiers.id, created));
  }
});

describe.skipIf(!LOCAL)("durable runner against Postgres (spec 21 §6.2)", () => {
  it("two concurrent claimNext on one dossier: exactly one gets the row, the others null", async () => {
    for (let trial = 0; trial < 5; trial++) {
      const t0 = new Date();
      const id = await newDossier(after(t0, -1000));
      const claims = await Promise.all(Array.from({ length: 8 }, () => claimNext(id, t0)));
      const winners = claims.filter((c) => c !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({ stage: "wake", status: "running", attempt: 1 });
      expect(await step(id, "wake")).toMatchObject({ status: "running", attempt: 1 });
      expect((await dossierRow(id))?.status).toBe("running");
    }
  });

  it("two concurrent advancers: every stage runs exactly once and the dossier succeeds", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    const { map, calls } = countingHandlers(50);
    const now = () => t0;
    for (let round = 0; round < STAGES.length; round++) {
      const [a, b] = await Promise.all([advance(id, map, { now }), advance(id, map, { now })]);
      const ran = [a.ran, b.ran].filter((s) => s !== null);
      expect(ran).toEqual([STAGES[round]]);
    }
    expect(Object.fromEntries(calls)).toEqual(Object.fromEntries(STAGES.map((s) => [s, 1])));
    expect(await dossierRow(id)).toMatchObject({ status: "succeeded", error: null });
    const audit = await getDb()
      .select({ action: events.action })
      .from(events)
      .where(and(eq(events.requestId, `it-runner-${id}`), like(events.action, "dossier.stage.%")));
    expect(audit.map((e) => e.action).sort()).toEqual(
      [...Array(7).fill("dossier.stage.ok"), "dossier.stage.skipped"].sort(),
    );
  });

  it("re-claims a stage whose lease expired, as a new attempt; never one with a live lease", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    await setStep(id, "wake", { status: "running", attempt: 1, leaseUntil: after(t0, 60_000) });
    expect(await claimNext(id, t0)).toBeNull();

    await setStep(id, "wake", { leaseUntil: after(t0, -1) });
    const reclaimed = await claimNext(id, t0);
    expect(reclaimed).toMatchObject({ stage: "wake", status: "running", attempt: 2 });
    expect(reclaimed?.leaseUntil).toEqual(after(t0, LEASE_MS));
  });

  it("fails an abandoned stage on its last attempt, and the dossier with it", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    await setStep(id, "wake", {
      status: "running",
      attempt: MAX_ATTEMPTS,
      leaseUntil: after(t0, -1),
    });
    const claimed = await claimNext(id, t0);
    expect(claimed).toMatchObject({ status: "error", attempt: MAX_ATTEMPTS, leaseUntil: EPOCH });
    const dossier = await dossierRow(id);
    expect(dossier?.status).toBe("failed");
    expect(dossier?.error).toMatch(/^wake: lease_expired/);
  });

  it("records a stage that throws as a retryable error and releases its lease", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    const boom: StageHandler = async () => {
      throw new Error("boom");
    };
    const { map } = countingHandlers(0);
    const result = await advance(id, { ...map, wake: boom }, { now: () => t0 });
    expect(result).toMatchObject({ ran: "wake", status: "pending", dossier: "running" });
    expect(await step(id, "wake")).toMatchObject({
      status: "pending",
      attempt: 1,
      error: "stage_threw: boom",
      leaseUntil: EPOCH,
      notBefore: after(t0, RETRY_DELAY_MS),
    });
    expect(await claimNext(id, after(t0, RETRY_DELAY_MS - 1))).toBeNull();
    expect(await claimNext(id, after(t0, RETRY_DELAY_MS))).toMatchObject({ attempt: 2 });
  });

  it("discards a result whose lease was lost to a later claim", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    const first = await claimNext(id, t0);
    if (first === null) throw new Error("first claim failed");
    const second = await claimNext(id, after(t0, LEASE_MS + 1));
    expect(second).toMatchObject({ attempt: 2 });

    const late = await recordOutcome(
      first,
      { ...first, status: "ok", leaseUntil: EPOCH, finishedAt: t0, output: { late: true } },
      t0,
    );
    expect(late).toEqual({ recorded: false });
    expect(await step(id, "wake")).toMatchObject({ status: "running", attempt: 2, output: {} });
  });

  it("parks a waiting stage until its not_before", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    const { map } = countingHandlers(0);
    const wait: StageHandler = async () => ({
      kind: "waiting",
      output: { job: "j1" },
      retryInMs: 3000,
    });
    const result = await advance(id, { ...map, wake: wait }, { now: () => t0 });
    expect(result).toEqual({
      ran: "wake",
      status: "waiting",
      dossier: "running",
      nextAt: after(t0, 3000),
    });
    expect(await claimNext(id, after(t0, 2999))).toBeNull();
    expect(await claimNext(id, after(t0, 3000))).toMatchObject({
      status: "running",
      attempt: 1,
      output: { job: "j1" },
    });
  });

  it("keeps dossiers.status and error in step with a failed stage", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    const { map } = countingHandlers(0);
    const refuse: StageHandler = async () => ({
      kind: "error",
      error: "budget_exhausted",
      retryable: false,
    });
    const result = await advance(id, { ...map, wake: refuse }, { now: () => t0 });
    expect(result).toEqual({ ran: "wake", status: "error", dossier: "failed", nextAt: null });
    expect(await dossierRow(id)).toMatchObject({
      status: "failed",
      error: "wake: budget_exhausted",
    });
    expect(await claimNext(id, after(t0, 60_000))).toBeNull();
  });

  it("resets only an error stage with nothing ok after it, and the dossier recovers", async () => {
    const t0 = new Date();
    const id = await newDossier(after(t0, -1000));
    await setStep(id, "wake", { status: "ok" });
    await setStep(id, "gather", { status: "error", attempt: 3, error: "x", output: { kept: 1 } });
    await setStep(id, "read", { status: "ok" });
    expect(await resetStep(id, "gather", t0)).toEqual({ ok: false, reason: "later_stage_ok" });

    await setStep(id, "read", { status: "pending" });
    expect(await resetStep(id, "wake", t0)).toEqual({ ok: false, reason: "not_error" });
    expect(await resetStep(id, "gather", t0)).toEqual({ ok: true, dossier: "running" });
    expect(await step(id, "gather")).toMatchObject({
      status: "pending",
      attempt: 0,
      error: null,
      output: { kept: 1 },
    });
    expect(await dossierRow(id)).toMatchObject({ status: "running", error: null });
    expect(await claimNext(id, t0)).toMatchObject({ stage: "gather", attempt: 1 });
  });

  it("does nothing for a dossier without step rows (v1)", async () => {
    const id = await newDossier(new Date(), false);
    expect(await claimNext(id, new Date())).toBeNull();
    expect(await resetStep(id, "wake", new Date())).toEqual({ ok: false, reason: "not_error" });
  });
});
