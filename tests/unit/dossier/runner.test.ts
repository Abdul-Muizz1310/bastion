import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StageHandler, StageOutcome, StepRow } from "@/dossier/stages";
import type { Dossier } from "@/lib/db/schema";

/**
 * Spec 21 §6.2 — `advance` runs one stage per invocation: claim, run its handler inside the 240 s
 * budget, record the outcome, audit it. The store is replaced by an in-memory one built from the
 * same pure transitions (the real SQL is proven in tests/integration/db/runner.test.ts), so these
 * tests are about the runner's own decisions.
 */

const mem = vi.hoisted(() => ({
  dossiers: new Map<string, unknown>(),
  steps: new Map<string, unknown[]>(),
}));
const { appendEvent } = vi.hoisted(() => ({ appendEvent: vi.fn() }));

vi.mock("@/platform/audit/write", () => ({ appendEvent }));
vi.mock("@/dossier/store", async () => {
  const s = await import("@/dossier/stages");
  const rows = (id: string) => (mem.steps.get(id) ?? []) as StepRow[];
  const put = (row: StepRow) =>
    mem.steps.set(
      row.dossierId,
      rows(row.dossierId).map((r) => (r.stage === row.stage ? row : r)),
    );
  return {
    findDossier: vi.fn(async (id: string) => mem.dossiers.get(id) ?? null),
    loadSteps: vi.fn(async (id: string) => rows(id)),
    claimNext: vi.fn(async (id: string, now: Date) => {
      if (rows(id).length === 0) return null;
      const stage = s.nextRunnable(rows(id), now);
      const row = rows(id).find((r) => r.stage === stage);
      if (row === undefined) return null;
      const claimed = s.claimStep(row, now);
      put(claimed);
      return claimed;
    }),
    recordOutcome: vi.fn(async (claimed: StepRow, next: StepRow) => {
      const current = rows(claimed.dossierId).find((r) => r.stage === claimed.stage);
      const fenced =
        current?.status === "running" &&
        current.attempt === claimed.attempt &&
        current.leaseUntil.getTime() === claimed.leaseUntil.getTime();
      if (!fenced) return { recorded: false };
      put(next);
      const steps = rows(claimed.dossierId);
      return { recorded: true, dossier: s.dossierStatus(steps), steps };
    }),
    resetStep: vi.fn(async (id: string, stage: (typeof s.STAGES)[number], now: Date) => {
      if (rows(id).length === 0) return { ok: false, reason: "not_error" };
      const decision = s.retryStep(rows(id), stage, now);
      if (!decision.ok) return decision;
      put(decision.row);
      return { ok: true, dossier: s.dossierStatus(rows(id)) };
    }),
  };
});

import { advance, retryStage, UnknownDossierError } from "@/dossier/runner";
import {
  initialSteps,
  LEASE_MS,
  MAX_ATTEMPTS,
  STAGE_BUDGET_MS,
  STAGES,
  type Stage,
} from "@/dossier/stages";
import * as store from "@/dossier/store";
import { visitorId } from "@/platform/visitor";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const clock = () => NOW;
/** A real, branded visitor id ("v_kk6eooepno"), derived rather than cast. */
const VISITOR = visitorId("203.0.113.7", "2026-10-20", new Uint8Array(32).fill(7));

const dossier: Dossier = {
  id: ID,
  userId: null,
  visitor: VISITOR,
  claim: "Water boils at 100 C at sea level",
  sources: ["hackernews"],
  mode: "rapid",
  status: "pending",
  verdict: null,
  confidence: null,
  requestId: "req-dossier-1",
  envelopeId: null,
  error: null,
  createdAt: at(-60_000),
  updatedAt: at(-60_000),
};

function seed(overrides: Partial<Record<Stage, Partial<StepRow>>> = {}) {
  mem.dossiers.set(ID, dossier);
  mem.steps.set(
    ID,
    initialSteps(ID, at(-1000)).map((r) => ({ ...r, ...overrides[r.stage] })),
  );
}

const stepOf = (stage: Stage) =>
  (mem.steps.get(ID) as StepRow[]).find((r) => r.stage === stage) as StepRow;

const answer = (outcome: StageOutcome) => vi.fn<StageHandler>(async () => outcome);

function handlers(overrides: Partial<Record<Stage, StageHandler>> = {}) {
  const all = Object.fromEntries(
    STAGES.map((s) => [s, answer({ kind: "ok", output: { stage: s } })]),
  ) as Record<Stage, ReturnType<typeof answer>>;
  return { ...all, ...overrides } as Record<Stage, StageHandler>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mem.dossiers.clear();
  mem.steps.clear();
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("advance — one stage per invocation", () => {
  it("runs the claimed stage's handler once, records ok and reports the next stage's time", async () => {
    seed();
    const map = handlers();
    const result = await advance(ID, map, { now: clock });
    expect(result).toEqual({ ran: "wake", status: "ok", dossier: "running", nextAt: at(-1000) });
    expect(map.wake).toHaveBeenCalledTimes(1);
    for (const stage of STAGES.slice(1)) expect(map[stage]).not.toHaveBeenCalled();
    expect(stepOf("wake")).toMatchObject({ status: "ok", attempt: 1, output: { stage: "wake" } });
  });

  it("hands the handler the dossier, its request id, earlier outputs and the clock", async () => {
    seed({
      wake: { status: "ok", output: { live: ["magpie"] } },
      gather: { status: "waiting", attempt: 1, output: { job: "j1" }, notBefore: at(-1) },
    });
    const map = handlers();
    await advance(ID, map, { now: clock });
    expect(map.gather).toHaveBeenCalledWith({
      dossier,
      requestId: "req-dossier-1",
      outputs: { wake: { live: ["magpie"] }, gather: { job: "j1" } },
      now: NOW,
    });
  });

  it("runs nothing when no stage is claimable", async () => {
    seed({ wake: { status: "waiting", attempt: 1, notBefore: at(3000) } });
    const map = handlers();
    const result = await advance(ID, map, { now: clock });
    expect(result).toEqual({ ran: null, status: null, dossier: "running", nextAt: at(3000) });
    for (const stage of STAGES) expect(map[stage]).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("refuses an unknown dossier without claiming anything", async () => {
    await expect(advance(ID, handlers(), { now: clock })).rejects.toBeInstanceOf(
      UnknownDossierError,
    );
    expect(store.claimNext).not.toHaveBeenCalled();
  });

  it("leaves a v1 dossier (no step rows) alone, reporting its stored status", async () => {
    mem.dossiers.set(ID, { ...dossier, status: "succeeded" });
    const map = handlers();
    const result = await advance(ID, map, { now: clock });
    expect(result).toEqual({ ran: null, status: null, dossier: "succeeded", nextAt: null });
    for (const stage of STAGES) expect(map[stage]).not.toHaveBeenCalled();
  });

  it("records a stage that throws as a retryable error, releasing its lease", async () => {
    seed();
    const map = handlers({
      wake: async () => {
        throw new Error("boom");
      },
    });
    const result = await advance(ID, map, { now: clock });
    expect(result).toMatchObject({ ran: "wake", status: "pending", dossier: "running" });
    expect(stepOf("wake")).toMatchObject({
      status: "pending",
      attempt: 1,
      error: "stage_threw: boom",
      leaseUntil: new Date(0),
    });
  });

  it("records a handler that throws synchronously, or throws a non-Error, the same way", async () => {
    seed();
    const sync: StageHandler = () => {
      throw "plain string";
    };
    await advance(ID, handlers({ wake: sync }), { now: clock });
    expect(stepOf("wake")).toMatchObject({ status: "pending", error: "stage_threw: plain string" });
  });

  it("ends a stage that outlives its budget as a retryable stage_timeout", async () => {
    seed();
    const hang: StageHandler = () => new Promise(() => {});
    const result = await advance(ID, handlers({ wake: hang }), { now: clock, stageBudgetMs: 5 });
    expect(result.status).toBe("pending");
    expect(stepOf("wake").error).toMatch(/^stage_timeout/);
  });

  it("gives a stage 240 s by default", async () => {
    vi.useFakeTimers();
    seed();
    const hang: StageHandler = () => new Promise(() => {});
    let settled = false;
    const run = advance(ID, handlers({ wake: hang }), { now: clock }).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(STAGE_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).status).toBe("pending");
  });

  it("fails a stage whose outcome is malformed, non-retryably", async () => {
    seed();
    const bad = answer({ kind: "waiting", output: {}, retryInMs: -1 });
    const result = await advance(ID, handlers({ wake: bad }), { now: clock });
    expect(result).toMatchObject({ ran: "wake", status: "error", dossier: "failed", nextAt: null });
    expect(stepOf("wake").error).toMatch(/^invalid_outcome: /);
  });

  it("fails an abandoned stage on its last attempt without running it again", async () => {
    seed({ wake: { status: "running", attempt: MAX_ATTEMPTS, leaseUntil: at(-1) } });
    const map = handlers();
    const result = await advance(ID, map, { now: clock });
    expect(result).toEqual({ ran: "wake", status: "error", dossier: "failed", nextAt: null });
    expect(map.wake).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dossier.stage.error",
        metadata: {
          stage: "wake",
          attempt: MAX_ATTEMPTS,
          error: expect.stringMatching(/^lease_expired/),
        },
      }),
    );
  });

  it("discards its result when the lease was lost meanwhile, and audits nothing", async () => {
    seed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(store.recordOutcome).mockResolvedValueOnce({ recorded: false });
    const result = await advance(ID, handlers(), { now: clock });
    expect(result).toMatchObject({ ran: "wake", status: null });
    expect(appendEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("lease"), expect.anything());
  });

  it("appends one audit event per stage outcome, as bastion, under the dossier's request id", async () => {
    seed();
    await advance(ID, handlers(), { now: clock });
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith({
      actor: "bastion",
      action: "dossier.stage.ok",
      entityType: "dossier",
      entityId: ID,
      service: "bastion",
      requestId: "req-dossier-1",
      metadata: { stage: "wake", attempt: 1 },
    });
  });

  it("audits a retryable error as the status it leaves (pending) with the error", async () => {
    seed();
    await advance(ID, handlers({ wake: answer({ kind: "error", error: "e", retryable: true }) }), {
      now: clock,
    });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dossier.stage.pending",
        metadata: { stage: "wake", attempt: 1, error: "e" },
      }),
    );
  });

  it("takes a dossier through all eight stages to succeeded, each handler once", async () => {
    seed();
    const map = handlers({ gather: answer({ kind: "skipped", reason: "no sources" }) });
    const seen: Array<[Stage | null, string | null, string]> = [];
    for (let i = 0; i < STAGES.length + 1; i++) {
      const r = await advance(ID, map, { now: clock });
      seen.push([r.ran, r.status, r.dossier]);
    }
    expect(seen).toEqual([
      ["wake", "ok", "running"],
      ["gather", "skipped", "running"],
      ["read", "ok", "running"],
      ["seal", "ok", "running"],
      ["debate", "ok", "running"],
      ["measure", "ok", "running"],
      ["envelope", "ok", "running"],
      ["record", "ok", "succeeded"],
      [null, null, "succeeded"],
    ]);
    for (const stage of STAGES) expect(map[stage]).toHaveBeenCalledTimes(1);
  });

  it("re-runs a waiting stage only once its poll interval has passed", async () => {
    seed();
    const map = handlers({ wake: answer({ kind: "waiting", output: { n: 1 }, retryInMs: 3000 }) });
    const first = await advance(ID, map, { now: clock });
    expect(first).toEqual({ ran: "wake", status: "waiting", dossier: "running", nextAt: at(3000) });
    expect((await advance(ID, map, { now: () => at(2999) })).ran).toBeNull();
    expect((await advance(ID, map, { now: () => at(3000) })).ran).toBe("wake");
    expect(stepOf("wake").attempt).toBe(1);
    expect(stepOf("wake").leaseUntil.getTime()).toBe(0);
    expect(LEASE_MS).toBeGreaterThan(STAGE_BUDGET_MS);
  });
});

describe("retryStage — retry from this stage (spec §6.4)", () => {
  it("resets an error stage and audits the visitor's retry", async () => {
    seed({ wake: { status: "error", attempt: 3, error: "x" } });
    const result = await retryStage(ID, "wake", VISITOR, NOW);
    // nothing has started again yet, so the dossier is pending until the next claim.
    expect(result).toEqual({ ok: true, dossier: "pending" });
    expect(stepOf("wake")).toMatchObject({ status: "pending", attempt: 0 });
    expect(appendEvent).toHaveBeenCalledWith({
      actor: VISITOR,
      action: "dossier.stage.retry",
      entityType: "dossier",
      entityId: ID,
      service: "bastion",
      requestId: "req-dossier-1",
      metadata: { stage: "wake" },
    });
  });

  it("answers unknown_dossier without touching any step", async () => {
    const result = await retryStage(ID, "wake", VISITOR, NOW);
    expect(result).toEqual({ ok: false, reason: "unknown_dossier" });
    expect(store.resetStep).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it("refuses a stage that is not an error, and audits nothing", async () => {
    seed();
    expect(await retryStage(ID, "wake", VISITOR, NOW)).toEqual({
      ok: false,
      reason: "not_error",
    });
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
