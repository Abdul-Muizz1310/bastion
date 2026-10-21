import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { driveDossier } from "@/dossier/drive-dossier";
import {
  initialSteps,
  STAGES,
  type Stage,
  type StageHandler,
  type StageOutcome,
  type StepRow,
} from "@/dossier/stages";
import { dueDossiers } from "@/dossier/store";
import { getDb } from "@/lib/db/client";
import { dossierSteps, dossiers } from "@/lib/db/schema";

/**
 * Spec 21 §6.2 "The sweep" and "The foreground loop", against a real Postgres: which dossiers the
 * sweep selects (pending or running v2 dossiers whose frontier stage is due, oldest first), and that
 * a sweep and a page nudge driving one dossier at the same time still run every stage exactly once.
 *
 * Commits rows (deleted afterwards); runs only against a local, disposable server, like runner.test.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(DATABASE_URL);

const created: string[] = [];
const ago = (ms: number) => new Date(Date.now() - ms);

async function newDossier(opts: {
  status?: "pending" | "running" | "succeeded" | "failed";
  createdAt?: Date;
  steps?: boolean;
}): Promise<string> {
  const id = randomUUID();
  created.push(id);
  await getDb()
    .insert(dossiers)
    .values({
      id,
      visitor: "v_kk6eooepno",
      claim: "integration: the sweep finds what is due",
      sources: [],
      mode: "rapid",
      status: opts.status ?? "pending",
      requestId: `it-sweep-${id}`,
      createdAt: opts.createdAt ?? ago(60_000),
    });
  if (opts.steps ?? true)
    await getDb()
      .insert(dossierSteps)
      .values(initialSteps(id, ago(60_000)));
  return id;
}

async function setStep(id: string, stage: Stage, values: Partial<StepRow>): Promise<void> {
  await getDb()
    .update(dossierSteps)
    .set(values)
    .where(and(eq(dossierSteps.dossierId, id), eq(dossierSteps.stage, stage)));
}

const mine = (ids: readonly string[]) => ids.filter((id) => created.includes(id));

afterAll(async () => {
  if (LOCAL && created.length > 0) {
    await getDb().delete(dossiers).where(inArray(dossiers.id, created));
  }
});

describe.skipIf(!LOCAL)("the sweep against Postgres (spec 21 §6.2)", () => {
  it("selects pending or running v2 dossiers whose frontier stage is due — and nothing else", async () => {
    const now = new Date();
    const fresh = await newDossier({ status: "pending" });
    const abandoned = await newDossier({ status: "running" });
    await setStep(abandoned, "wake", { status: "running", attempt: 1, leaseUntil: ago(1_000) });

    const leased = await newDossier({ status: "running" });
    await setStep(leased, "wake", {
      status: "running",
      attempt: 1,
      leaseUntil: new Date(now.getTime() + 200_000),
    });
    const waiting = await newDossier({ status: "running" });
    await setStep(waiting, "wake", { status: "ok" });
    await setStep(waiting, "gather", {
      status: "waiting",
      attempt: 1,
      notBefore: new Date(now.getTime() + 60_000),
    });
    // Later stages are pending and look due, but the frontier (gather) is not: not selected.
    const succeeded = await newDossier({ status: "succeeded" });
    const failed = await newDossier({ status: "failed" });
    await setStep(failed, "wake", { status: "error", attempt: 3 });
    const v1 = await newDossier({ status: "pending", steps: false });

    const due = mine(await dueDossiers(now, 500));
    expect(new Set(due)).toEqual(new Set([fresh, abandoned]));
    for (const not of [leased, waiting, succeeded, failed, v1]) expect(due).not.toContain(not);
  });

  it("lists the oldest first, at most `limit`", async () => {
    const now = new Date();
    const oldest = await newDossier({ createdAt: new Date("2000-01-01T00:00:00Z") });
    const older = await newDossier({ createdAt: new Date("2000-01-02T00:00:00Z") });
    await newDossier({ createdAt: new Date("2000-01-03T00:00:00Z") });
    expect(await dueDossiers(now, 2)).toEqual([oldest, older]);
  });

  it("a sweep and a page nudge driving one dossier at once run every stage exactly once", async () => {
    const id = await newDossier({ status: "pending" });
    const calls = new Map<Stage, number>();
    const handler =
      (stage: Stage): StageHandler =>
      async () => {
        calls.set(stage, (calls.get(stage) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 40));
        const outcome: StageOutcome =
          stage === "gather"
            ? { kind: "skipped", reason: "no sources" }
            : { kind: "ok", output: { stage } };
        return outcome;
      };
    const handlers = Object.fromEntries(STAGES.map((s) => [s, handler(s)])) as Record<
      Stage,
      StageHandler
    >;
    const deadlineMs = Date.now() + 300_000;
    const [sweep, nudge] = await Promise.all([
      driveDossier(id, { driver: "sweep", deadlineMs, invocation: "itsweep1", handlers }),
      driveDossier(id, { driver: "visitor", deadlineMs, invocation: "itnudge1", handlers }),
    ]);
    expect(Object.fromEntries(calls)).toEqual(Object.fromEntries(STAGES.map((s) => [s, 1])));
    // Between them they ran each stage once; whoever ran the last one saw the dossier succeed.
    const ran = [...sweep.stages, ...nudge.stages].map((s) => s.stage).sort();
    expect(ran).toEqual([...STAGES].sort());
    const [row] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    expect(row?.status).toBe("succeeded");
    expect(await dueDossiers(new Date(), 500)).not.toContain(id);
  });
});
