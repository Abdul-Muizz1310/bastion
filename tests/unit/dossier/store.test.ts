import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The step store's own control flow (spec 21 §6.2): which statements it issues, in what order, and
 * what it does with what Postgres answers — a malformed id never reaches the database, a lost claim
 * race or a lost lease writes nothing more, the dossier row is re-synced inside the same transaction,
 * rows read back are parsed. That the fenced UPDATEs really are atomic is proven against Postgres in
 * tests/integration/db/runner.test.ts; here `getDb()` is a fake that answers from queues.
 */

type Call = { op: "select" | "update"; table?: unknown; values?: unknown; lock?: string };

const fake = vi.hoisted(() => ({
  selects: [] as unknown[][],
  returnings: [] as unknown[][],
  calls: [] as Call[],
  transactions: 0,
}));

vi.mock("@/lib/db/client", () => {
  const thenable = (value: () => unknown) => ({
    // biome-ignore lint/suspicious/noThenProperty: a drizzle query is awaited as a thenable.
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve().then(value).then(resolve, reject),
  });
  const db = {
    select: () => {
      const call: Call = { op: "select" };
      fake.calls.push(call);
      const query = {
        from: (table: unknown) => {
          call.table = table;
          return query;
        },
        where: () => query,
        limit: () => query,
        for: (lock: string) => {
          call.lock = lock;
          return query;
        },
        ...thenable(() => fake.selects.shift() ?? []),
      };
      return query;
    },
    update: (table: unknown) => {
      const call: Call = { op: "update", table };
      fake.calls.push(call);
      const query = {
        set: (values: unknown) => {
          call.values = values;
          return query;
        },
        where: () => query,
        returning: () => Promise.resolve(fake.returnings.shift() ?? []),
        ...thenable(() => []),
      };
      return query;
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      fake.transactions += 1;
      return cb(db);
    },
  };
  return { getDb: () => db };
});

import { claimStep, initialSteps, LEASE_MS, type Stage, type StepRow } from "@/dossier/stages";
import { claimNext, findDossier, loadSteps, recordOutcome, resetStep } from "@/dossier/store";
import { dossierSteps, dossiers } from "@/lib/db/schema";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

function steps(overrides: Partial<Record<Stage, Partial<StepRow>>> = {}): StepRow[] {
  return initialSteps(ID, at(-1000)).map((r) => ({ ...r, ...overrides[r.stage] }));
}

const updatesOf = (table: unknown) =>
  fake.calls.filter((c) => c.op === "update" && c.table === table);

beforeEach(() => {
  fake.selects.length = 0;
  fake.returnings.length = 0;
  fake.calls.length = 0;
  fake.transactions = 0;
});

describe("malformed ids never reach Postgres", () => {
  it.each(["", "nope", `${ID}x`, "'; DROP TABLE dossiers; --"])("%j", async (id) => {
    expect(await findDossier(id)).toBeNull();
    expect(await loadSteps(id)).toEqual([]);
    expect(await claimNext(id, NOW)).toBeNull();
    expect(fake.calls).toEqual([]);
  });
});

describe("findDossier / loadSteps", () => {
  it("returns the dossier row or null", async () => {
    fake.selects.push([{ id: ID }]);
    expect(await findDossier(ID)).toEqual({ id: ID });
    expect(await findDossier(ID)).toBeNull();
  });

  it("parses the step rows it reads back", async () => {
    fake.selects.push(steps());
    expect((await loadSteps(ID)).map((s) => s.stage)).toHaveLength(8);
    fake.selects.push([{ ...steps()[0], status: "started" }]);
    await expect(loadSteps(ID)).rejects.toThrow();
  });
});

describe("claimNext", () => {
  it("claims the runnable stage, re-syncs the dossier, all in one transaction", async () => {
    const before = steps();
    const claimed = claimStep(before[0] as StepRow, NOW);
    const afterClaim = before.map((r) => (r.stage === "wake" ? claimed : r));
    fake.selects.push(before, afterClaim);
    fake.returnings.push([claimed]);

    expect(await claimNext(ID, NOW)).toEqual(claimed);
    expect(fake.transactions).toBe(1);
    expect(updatesOf(dossierSteps)).toHaveLength(1);
    expect(updatesOf(dossierSteps)[0]?.values).toMatchObject({
      status: "running",
      attempt: 1,
      leaseUntil: at(LEASE_MS),
      startedAt: NOW,
    });
    expect(updatesOf(dossiers)[0]?.values).toEqual({
      status: "running",
      error: null,
      updatedAt: NOW,
    });
  });

  it("writes nothing when the dossier has no steps (v1) or nothing is claimable", async () => {
    fake.selects.push([]);
    expect(await claimNext(ID, NOW)).toBeNull();
    fake.selects.push(steps({ wake: { status: "running", attempt: 1, leaseUntil: at(60_000) } }));
    expect(await claimNext(ID, NOW)).toBeNull();
    expect(fake.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("returns null and leaves the dossier alone when it loses the race for the row", async () => {
    fake.selects.push(steps());
    fake.returnings.push([]);
    expect(await claimNext(ID, NOW)).toBeNull();
    expect(updatesOf(dossierSteps)).toHaveLength(1);
    expect(updatesOf(dossiers)).toEqual([]);
  });
});

describe("recordOutcome", () => {
  const claimed = claimStep(steps()[0] as StepRow, NOW);

  it("refuses to record a row for another stage or dossier", async () => {
    await expect(recordOutcome(claimed, { ...claimed, stage: "gather" }, NOW)).rejects.toThrow(
      RangeError,
    );
    await expect(recordOutcome(claimed, { ...claimed, dossierId: "x" }, NOW)).rejects.toThrow(
      RangeError,
    );
    expect(fake.calls).toEqual([]);
  });

  it("reports a lost lease and writes nothing more", async () => {
    fake.returnings.push([]);
    expect(await recordOutcome(claimed, { ...claimed, status: "ok" }, NOW)).toEqual({
      recorded: false,
    });
    expect(updatesOf(dossiers)).toEqual([]);
  });

  it("records, then re-syncs dossiers.status and error from the steps", async () => {
    const failed: StepRow = { ...claimed, status: "error", error: "x", leaseUntil: new Date(0) };
    const after = steps({ wake: failed });
    fake.returnings.push([{ stage: "wake" }]);
    fake.selects.push(after);
    expect(await recordOutcome(claimed, failed, NOW)).toEqual({
      recorded: true,
      dossier: "failed",
      steps: after,
    });
    expect(updatesOf(dossierSteps)[0]?.values).toMatchObject({ status: "error", error: "x" });
    expect(updatesOf(dossiers)[0]?.values).toEqual({
      status: "failed",
      error: "wake: x",
      updatedAt: NOW,
    });
  });
});

describe("resetStep", () => {
  it("locks the steps while it decides", async () => {
    fake.selects.push([]);
    expect(await resetStep(ID, "wake", NOW)).toEqual({ ok: false, reason: "not_error" });
    expect(fake.calls[0]).toMatchObject({ op: "select", table: dossierSteps, lock: "update" });
    expect(fake.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("passes the machine's refusal through and writes nothing", async () => {
    fake.selects.push(steps({ wake: { status: "error" }, gather: { status: "ok" } }));
    expect(await resetStep(ID, "wake", NOW)).toEqual({ ok: false, reason: "later_stage_ok" });
    expect(fake.calls.filter((c) => c.op === "update")).toEqual([]);
  });

  it("resets the stage and re-syncs the dossier", async () => {
    fake.selects.push(steps({ wake: { status: "ok" }, gather: { status: "error", attempt: 3 } }));
    fake.selects.push(steps({ wake: { status: "ok" } }));
    expect(await resetStep(ID, "gather", NOW)).toEqual({ ok: true, dossier: "running" });
    expect(updatesOf(dossierSteps)[0]?.values).toMatchObject({
      status: "pending",
      attempt: 0,
      error: null,
    });
    expect(updatesOf(dossiers)[0]?.values).toMatchObject({ status: "running", error: null });
  });
});
