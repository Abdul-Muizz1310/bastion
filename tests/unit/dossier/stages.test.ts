import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  claimableAt,
  claimStep,
  dossierError,
  dossierStatus,
  initialSteps,
  LEASE_MS,
  MAX_ATTEMPTS,
  nextRunnable,
  POLL_MS,
  RETRY_DELAY_MS,
  retryStep,
  STAGE_BUDGET_MS,
  STAGES,
  type Stage,
  type StageOutcome,
  type StepRow,
  stageOutputs,
  stepRowSchema,
} from "@/dossier/stages";

/**
 * Spec 21 §6.2 / §6.4 — the durable runner's pure state machine. A dossier is eight `dossier_steps`
 * rows; these functions decide which stage may run, what a claim and an outcome do to a row, and what
 * the dossier's status is. No I/O: the store applies what they decide.
 */

const ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const EPOCH = new Date(0);
const at = (ms: number) => new Date(NOW.getTime() + ms);

/** The eight rows of a fresh dossier, with per-stage overrides. */
function steps(overrides: Partial<Record<Stage, Partial<StepRow>>> = {}): StepRow[] {
  return initialSteps(ID, at(-1000)).map((row) => ({ ...row, ...overrides[row.stage] }));
}

function row(stage: Stage, overrides: Partial<StepRow> = {}): StepRow {
  const found = steps({ [stage]: overrides }).find((r) => r.stage === stage);
  if (!found) throw new Error(`no ${stage}`);
  return found;
}

const done = (...stages: Stage[]) =>
  Object.fromEntries(stages.map((s) => [s, { status: "ok" as const }])) as Partial<
    Record<Stage, Partial<StepRow>>
  >;

describe("the runner's constants (plan: global constraints)", () => {
  it("has the eight stages in order", () => {
    expect(STAGES).toEqual([
      "wake",
      "gather",
      "read",
      "seal",
      "debate",
      "measure",
      "envelope",
      "record",
    ]);
  });

  it("uses a 240 s stage budget inside a 270 s lease, 3 s polls and 3 attempts", () => {
    expect(STAGE_BUDGET_MS).toBe(240_000);
    expect(LEASE_MS).toBe(270_000);
    expect(STAGE_BUDGET_MS).toBeLessThan(LEASE_MS);
    expect(POLL_MS).toBe(3_000);
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe("initialSteps", () => {
  it("is one pending row per stage, unleased, runnable from `now`", () => {
    const rows = initialSteps(ID, NOW);
    expect(rows.map((r) => r.stage)).toEqual([...STAGES]);
    for (const r of rows) {
      expect(r).toEqual({
        dossierId: ID,
        stage: r.stage,
        status: "pending",
        attempt: 0,
        leaseUntil: EPOCH,
        notBefore: NOW,
        startedAt: null,
        finishedAt: null,
        output: {},
        error: null,
      });
    }
  });
});

describe("nextRunnable", () => {
  it("starts a fresh dossier at wake", () => {
    expect(nextRunnable(steps(), NOW)).toBe("wake");
  });

  it("moves to the first stage after the ok and skipped ones", () => {
    expect(nextRunnable(steps(done("wake")), NOW)).toBe("gather");
    expect(nextRunnable(steps({ ...done("wake"), gather: { status: "skipped" } }), NOW)).toBe(
      "read",
    );
  });

  it("never runs a stage before its predecessor is ok or skipped", () => {
    // wake is waiting until later; gather is pending and would otherwise be claimable.
    const set = steps({ wake: { status: "waiting", notBefore: at(3000) } });
    expect(nextRunnable(set, NOW)).toBeNull();
  });

  it("does not run anything past an error stage", () => {
    expect(nextRunnable(steps({ ...done("wake"), gather: { status: "error" } }), NOW)).toBeNull();
  });

  it("returns null when every stage is ok or skipped", () => {
    expect(nextRunnable(steps(done(...STAGES)), NOW)).toBeNull();
  });

  it("holds a waiting stage until not_before, inclusive", () => {
    const waiting = (notBefore: Date) => steps({ wake: { status: "waiting", notBefore } });
    expect(nextRunnable(waiting(at(1)), NOW)).toBeNull();
    expect(nextRunnable(waiting(NOW), NOW)).toBe("wake");
    expect(nextRunnable(waiting(at(-1)), NOW)).toBe("wake");
  });

  it("holds a pending stage until not_before (a retry backoff)", () => {
    expect(nextRunnable(steps({ wake: { notBefore: at(5000) } }), NOW)).toBeNull();
  });

  it("does not claim a running stage while its lease is live, reclaims it once expired", () => {
    const running = (leaseUntil: Date) =>
      steps({ wake: { status: "running", attempt: 1, leaseUntil } });
    expect(nextRunnable(running(at(1)), NOW)).toBeNull();
    // lease_until < now is strict (spec: UPDATE … WHERE lease_until < now()).
    expect(nextRunnable(running(NOW), NOW)).toBeNull();
    expect(nextRunnable(running(at(-1)), NOW)).toBe("wake");
  });

  it("does not depend on the order the rows arrive in", () => {
    const set = steps(done("wake", "gather"));
    expect(nextRunnable([...set].reverse(), NOW)).toBe("read");
  });

  it("refuses a step set that is not exactly one row per stage of one dossier", () => {
    const set = steps();
    expect(() => nextRunnable(set.slice(1), NOW)).toThrow(RangeError);
    expect(() => nextRunnable([...set, row("wake")], NOW)).toThrow(RangeError);
    expect(() => nextRunnable([], NOW)).toThrow(RangeError);
    const foreign = set.map((r, i) => (i === 3 ? { ...r, dossierId: "other" } : r));
    expect(() => nextRunnable(foreign, NOW)).toThrow(RangeError);
  });
});

describe("claimStep", () => {
  it("starts a pending stage: running, attempt + 1, a 270 s lease", () => {
    const claimed = claimStep(row("wake"), NOW);
    expect(claimed).toMatchObject({
      stage: "wake",
      status: "running",
      attempt: 1,
      leaseUntil: at(LEASE_MS),
      startedAt: NOW,
      finishedAt: null,
    });
  });

  it("continues a waiting stage without spending an attempt", () => {
    const waiting = row("debate", {
      status: "waiting",
      attempt: 1,
      startedAt: at(-60_000),
      notBefore: NOW,
      output: { debate_id: "d1" },
    });
    expect(claimStep(waiting, NOW)).toMatchObject({
      status: "running",
      attempt: 1,
      startedAt: at(-60_000),
      leaseUntil: at(LEASE_MS),
      output: { debate_id: "d1" },
    });
  });

  it("re-claims an abandoned stage (expired lease) as a new attempt", () => {
    const abandoned = row("wake", { status: "running", attempt: 1, leaseUntil: at(-1) });
    expect(claimStep(abandoned, NOW)).toMatchObject({
      status: "running",
      attempt: 2,
      leaseUntil: at(LEASE_MS),
      startedAt: NOW,
    });
  });

  it("fails an abandoned stage that has used its last attempt instead of running it again", () => {
    const abandoned = row("seal", {
      status: "running",
      attempt: MAX_ATTEMPTS,
      leaseUntil: at(-1),
    });
    const claimed = claimStep(abandoned, NOW);
    expect(claimed).toMatchObject({
      status: "error",
      attempt: MAX_ATTEMPTS,
      leaseUntil: EPOCH,
      finishedAt: NOW,
    });
    expect(claimed.error).toMatch(/^lease_expired/);
  });

  it("refuses to claim a row that is not claimable", () => {
    expect(() => claimStep(row("wake", { status: "ok" }), NOW)).toThrow(RangeError);
    expect(() => claimStep(row("wake", { status: "error" }), NOW)).toThrow(RangeError);
    expect(() => claimStep(row("wake", { status: "skipped" }), NOW)).toThrow(RangeError);
    expect(() =>
      claimStep(row("wake", { status: "running", attempt: 1, leaseUntil: at(1) }), NOW),
    ).toThrow(RangeError);
    expect(() => claimStep(row("wake", { notBefore: at(1) }), NOW)).toThrow(RangeError);
  });
});

describe("applyOutcome", () => {
  const running = (overrides: Partial<StepRow> = {}) =>
    row("gather", {
      status: "running",
      attempt: 1,
      leaseUntil: at(LEASE_MS),
      startedAt: at(-500),
      ...overrides,
    });

  it("goes pending → running → ok, storing the output and releasing the lease", () => {
    const claimed = claimStep(row("gather"), at(-500));
    const ok = applyOutcome(claimed, { kind: "ok", output: { candidates: 4 } }, NOW);
    expect(ok).toMatchObject({
      status: "ok",
      attempt: 1,
      output: { candidates: 4 },
      leaseUntil: EPOCH,
      finishedAt: NOW,
      error: null,
    });
  });

  it("records a skip with its reason", () => {
    const skipped = applyOutcome(running(), { kind: "skipped", reason: "no sources" }, NOW);
    expect(skipped).toMatchObject({
      status: "skipped",
      output: { reason: "no sources" },
      leaseUntil: EPOCH,
      finishedAt: NOW,
      error: null,
    });
  });

  it("parks a waiting stage until retryInMs has passed, then it is runnable again", () => {
    const waiting = applyOutcome(
      running(),
      { kind: "waiting", output: { job: "j1" }, retryInMs: POLL_MS },
      NOW,
    );
    expect(waiting).toMatchObject({
      status: "waiting",
      attempt: 1,
      output: { job: "j1" },
      notBefore: at(POLL_MS),
      leaseUntil: EPOCH,
      finishedAt: null,
    });
    const set = steps({ wake: { status: "ok" }, gather: waiting });
    expect(nextRunnable(set, at(POLL_MS - 1))).toBeNull();
    expect(nextRunnable(set, at(POLL_MS))).toBe("gather");
  });

  it("does not spend attempts on waiting polls", () => {
    let current = claimStep(row("debate"), NOW);
    for (let poll = 0; poll < 10; poll++) {
      current = applyOutcome(
        current,
        { kind: "waiting", output: { debate_id: "d" }, retryInMs: POLL_MS },
        NOW,
      );
      current = claimStep(current, at(POLL_MS));
    }
    expect(current.attempt).toBe(1);
  });

  it("retries a retryable error up to 3 attempts, then the stage is an error", () => {
    const failure: StageOutcome = {
      kind: "error",
      error: "downstream_error: 502",
      retryable: true,
    };
    let clock = NOW.getTime();
    let current = claimStep(row("seal"), new Date(clock));
    const seen: Array<[string, number]> = [];
    for (;;) {
      current = applyOutcome(current, failure, new Date(clock));
      seen.push([current.status, current.attempt]);
      if (current.status !== "pending") break;
      clock = current.notBefore.getTime();
      current = claimStep(current, new Date(clock));
    }
    expect(seen).toEqual([
      ["pending", 1],
      ["pending", 2],
      ["error", 3],
    ]);
    expect(current.error).toBe("downstream_error: 502");
    expect(current.finishedAt).not.toBeNull();
  });

  it("backs a retry off by 5 s per attempt spent, keeps the output, records the error", () => {
    const retry = applyOutcome(
      running({ attempt: 2, output: { debate_id: "d1" } }),
      { kind: "error", error: "timeout", retryable: true },
      NOW,
    );
    expect(retry).toMatchObject({
      status: "pending",
      attempt: 2,
      notBefore: at(2 * RETRY_DELAY_MS),
      leaseUntil: EPOCH,
      output: { debate_id: "d1" },
      error: "timeout",
      finishedAt: null,
    });
  });

  it("makes a non-retryable error terminal on the first attempt", () => {
    const failed = applyOutcome(
      running(),
      { kind: "error", error: "budget_exhausted", retryable: false },
      NOW,
    );
    expect(failed).toMatchObject({
      status: "error",
      attempt: 1,
      error: "budget_exhausted",
      leaseUntil: EPOCH,
      finishedAt: NOW,
    });
    expect(nextRunnable(steps({ wake: { status: "ok" }, gather: failed }), at(60_000))).toBeNull();
  });

  it("caps a stored error at 1000 characters", () => {
    const failed = applyOutcome(
      running(),
      { kind: "error", error: "x".repeat(5000), retryable: false },
      NOW,
    );
    expect(failed.error).toHaveLength(1000);
  });

  it("only applies to a running row", () => {
    const outcome: StageOutcome = { kind: "ok", output: {} };
    for (const status of ["pending", "waiting", "ok", "error", "skipped"] as const) {
      expect(() => applyOutcome(row("gather", { status }), outcome, NOW)).toThrow(RangeError);
    }
  });

  it("refuses a waiting delay that is not a whole number of ms between 0 and a lease", () => {
    for (const retryInMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, LEASE_MS + 1]) {
      expect(() =>
        applyOutcome(running(), { kind: "waiting", output: {}, retryInMs }, NOW),
      ).toThrow(RangeError);
    }
    expect(applyOutcome(running(), { kind: "waiting", output: {}, retryInMs: 0 }, NOW).status).toBe(
      "waiting",
    );
  });
});

describe("unknown variants fail loudly (negative space)", () => {
  it("applyOutcome refuses an outcome kind it does not know", () => {
    const running = claimStep(row("wake"), NOW);
    const bogus = { kind: "maybe", output: {} } as unknown as StageOutcome;
    expect(() => applyOutcome(running, bogus, NOW)).toThrow(TypeError);
  });

  it("nextRunnable refuses a step status it does not know", () => {
    const set = steps({ wake: { status: "started" as unknown as StepRow["status"] } });
    expect(() => nextRunnable(set, NOW)).toThrow(TypeError);
  });
});

describe("dossierStatus", () => {
  it("is pending until a stage has started", () => {
    expect(dossierStatus(steps())).toBe("pending");
  });

  it("is running while any stage has started and none failed", () => {
    expect(dossierStatus(steps({ wake: { status: "running" } }))).toBe("running");
    expect(dossierStatus(steps({ wake: { status: "waiting" } }))).toBe("running");
    expect(dossierStatus(steps(done("wake")))).toBe("running");
    // a retryable error sends the stage back to pending; the run is still going.
    expect(
      dossierStatus(steps({ ...done("wake"), gather: { status: "pending", error: "x" } })),
    ).toBe("running");
  });

  it("is succeeded when every stage is ok or skipped", () => {
    expect(dossierStatus(steps({ ...done(...STAGES), gather: { status: "skipped" } }))).toBe(
      "succeeded",
    );
  });

  it("is failed when any stage is an error", () => {
    expect(dossierStatus(steps({ ...done("wake"), gather: { status: "error" } }))).toBe("failed");
  });

  it("refuses an incomplete step set", () => {
    expect(() => dossierStatus(steps().slice(0, 7))).toThrow(RangeError);
  });
});

describe("dossierError", () => {
  it("is null while no stage has failed", () => {
    expect(dossierError(steps({ wake: { status: "pending", error: "retrying" } }))).toBeNull();
  });

  it("names the failed stage and its error", () => {
    const set = steps({ ...done("wake"), gather: { status: "error", error: "asleep: magpie" } });
    expect(dossierError(set)).toBe("gather: asleep: magpie");
  });
});

describe("stageOutputs", () => {
  it("hands a stage its predecessors' outputs and its own stored output, nothing later", () => {
    const set = steps({
      wake: { status: "ok", output: { live: ["magpie"] } },
      gather: { status: "skipped", output: { reason: "no sources" } },
      read: { status: "waiting", output: { job: "j1" } },
      seal: { output: { stale: true } },
    });
    expect(stageOutputs(set, "read")).toEqual({
      wake: { live: ["magpie"] },
      gather: { reason: "no sources" },
      read: { job: "j1" },
    });
  });
});

describe("claimableAt", () => {
  it("is null when the dossier is finished or failed", () => {
    expect(claimableAt(steps(done(...STAGES)))).toBeNull();
    expect(claimableAt(steps({ wake: { status: "error" } }))).toBeNull();
  });

  it("is the next stage's not_before while it waits or is pending", () => {
    expect(claimableAt(steps({ wake: { status: "waiting", notBefore: at(3000) } }))).toEqual(
      at(3000),
    );
    expect(claimableAt(steps({ ...done("wake"), gather: { notBefore: at(-5) } }))).toEqual(at(-5));
  });

  it("is the lease's end while a stage is running", () => {
    expect(
      claimableAt(steps({ wake: { status: "running", leaseUntil: at(LEASE_MS), notBefore: NOW } })),
    ).toEqual(at(LEASE_MS));
  });
});

describe("retryStep (spec §6.4: retry from this stage)", () => {
  it("resets an error stage to pending with attempt 0, keeping its output", () => {
    const set = steps({
      ...done("wake", "gather", "read", "seal"),
      debate: {
        status: "error",
        attempt: 3,
        error: "failed",
        startedAt: at(-9000),
        finishedAt: at(-1000),
        output: { debate_id: "d1" },
      },
    });
    const decision = retryStep(set, "debate", NOW);
    expect(decision).toEqual({
      ok: true,
      row: {
        ...set[4],
        status: "pending",
        attempt: 0,
        error: null,
        notBefore: NOW,
        leaseUntil: EPOCH,
        startedAt: null,
        finishedAt: null,
        output: { debate_id: "d1" },
      },
    });
  });

  it("refuses a stage that is not an error", () => {
    for (const status of ["pending", "running", "waiting", "ok", "skipped"] as const) {
      expect(retryStep(steps({ wake: { status } }), "wake", NOW)).toEqual({
        ok: false,
        reason: "not_error",
      });
    }
  });

  it("refuses when a later stage is already ok", () => {
    const set = steps({ wake: { status: "error" }, gather: { status: "ok" } });
    expect(retryStep(set, "wake", NOW)).toEqual({ ok: false, reason: "later_stage_ok" });
  });
});

describe("stepRowSchema (rows read back from Postgres)", () => {
  it("accepts a stored row", () => {
    const parsed = stepRowSchema.parse({ ...row("wake"), output: { nested: [1, "a", null] } });
    expect(parsed.stage).toBe("wake");
  });

  it("rejects an unknown stage or status, a negative attempt and non-JSON output", () => {
    expect(stepRowSchema.safeParse({ ...row("wake"), stage: "adjudicate" }).success).toBe(false);
    expect(stepRowSchema.safeParse({ ...row("wake"), status: "started" }).success).toBe(false);
    expect(stepRowSchema.safeParse({ ...row("wake"), attempt: -1 }).success).toBe(false);
    expect(stepRowSchema.safeParse({ ...row("wake"), output: undefined }).success).toBe(false);
  });
});
