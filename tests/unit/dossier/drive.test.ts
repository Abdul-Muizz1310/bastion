import { describe, expect, it, vi } from "vitest";
import {
  DRIVE_MARGIN_MS,
  driveLoop,
  INLINE_WAIT_MAX_MS,
  MAX_IDLE_ROUNDS,
  MIN_ROUND_MS,
} from "@/dossier/drive";
import type { AdvanceResult } from "@/dossier/runner";
import { STAGE_BUDGET_MS } from "@/dossier/stages";

/**
 * Spec 21 §6.2 "The foreground loop": one request drives successive stages while its budget lasts.
 * Each round claims one stage (the runner's claim, lease and fencing are unchanged) and gives it
 * min(240 s, remaining − 20 s); it continues at once when the next stage is due, sleeps in-process
 * when it is due within 10 s, and stops when the dossier ends, when the next stage is further out,
 * when nothing is due, when the margin is reached, or after repeated rounds that claim nothing.
 */

const START = 1_000_000;
const DEADLINE = START + 300_000;

/** A fake clock and a scripted runner: each round costs `ms` and answers the next result. */
function harness(rounds: Array<{ ms: number; result: (now: number) => AdvanceResult }>) {
  let clock = START;
  const budgets: number[] = [];
  const slept: number[] = [];
  const advanceOnce = vi.fn(async (stageBudgetMs: number) => {
    budgets.push(stageBudgetMs);
    const round = rounds.shift();
    if (round === undefined) throw new Error("the loop asked for more rounds than scripted");
    clock += round.ms;
    return round.result(clock);
  });
  const deps = {
    advanceOnce,
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      slept.push(ms);
      clock += ms;
    }),
  };
  return { deps, budgets, slept, at: () => clock };
}

const ran =
  (
    stage: AdvanceResult["ran"],
    status: AdvanceResult["status"],
    nextIn: number | null,
    dossier: AdvanceResult["dossier"] = "running",
  ) =>
  (now: number): AdvanceResult => ({
    ran: stage,
    status,
    dossier,
    nextAt: nextIn === null ? null : new Date(now + nextIn),
  });

describe("driveLoop", () => {
  it("runs stage after stage while each next one is due, until the dossier finishes", async () => {
    const h = harness([
      { ms: 2_000, result: ran("wake", "ok", -1) },
      { ms: 13_700, result: ran("gather", "ok", -1) },
      { ms: 1_000, result: ran("read", "ok", -1) },
      { ms: 500, result: ran("record", "ok", null, "succeeded") },
    ]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(out.stopped).toBe("done");
    expect(out.stages).toEqual([
      { stage: "wake", status: "ok" },
      { stage: "gather", status: "ok" },
      { stage: "read", status: "ok" },
      { stage: "record", status: "ok" },
    ]);
    expect(out.last?.dossier).toBe("succeeded");
    expect(h.slept).toEqual([]);
  });

  it("gives each stage min(240 s, remaining − 20 s)", async () => {
    expect(DRIVE_MARGIN_MS).toBe(20_000);
    expect(STAGE_BUDGET_MS).toBe(240_000);
    const h = harness([
      { ms: 50_000, result: ran("wake", "ok", -1) },
      { ms: 1_000, result: ran("gather", "ok", -1) },
      { ms: 1_000, result: ran("read", "ok", null, "failed") },
    ]);
    await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    // 300 s left → 240 s; 250 s left → 230 s; 249 s left → 229 s.
    expect(h.budgets).toEqual([240_000, 230_000, 229_000]);
  });

  it("sleeps in-process for a stage due within 10 s, then continues", async () => {
    expect(INLINE_WAIT_MAX_MS).toBe(10_000);
    const h = harness([
      { ms: 1_000, result: ran("debate", "waiting", 3_000) },
      { ms: 1_000, result: ran("debate", "waiting", 3_000) },
      { ms: 1_000, result: ran("debate", "ok", null, "failed") },
    ]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(h.slept).toEqual([3_000, 3_000]);
    expect(out.stages.map((s) => s.status)).toEqual(["waiting", "waiting", "ok"]);
  });

  it("sleeps through a retry's backoff (5 s) and runs the next attempt", async () => {
    const h = harness([
      { ms: 13_700, result: ran("seal", "pending", 5_000) },
      { ms: 2_000, result: ran("seal", "ok", null, "succeeded") },
    ]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(h.slept).toEqual([5_000]);
    expect(out.stopped).toBe("done");
  });

  it("stops when the next stage is more than 10 s away", async () => {
    const h = harness([{ ms: 1_000, result: ran("debate", "waiting", 10_001) }]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(out.stopped).toBe("later");
    expect(h.slept).toEqual([]);
  });

  it("stops when nothing will become due (nextAt null) without the dossier ending", async () => {
    const h = harness([{ ms: 100, result: ran(null, null, null, "pending") }]);
    expect((await driveLoop({ deadlineMs: DEADLINE }, h.deps)).stopped).toBe("later");
  });

  it("starts a round only with at least 100 s for it after the margin (Ruling AM)", async () => {
    expect(MIN_ROUND_MS).toBe(100_000);
    const short = harness([]);
    const none = await driveLoop(
      { deadlineMs: START + DRIVE_MARGIN_MS + MIN_ROUND_MS - 1 },
      short.deps,
    );
    expect(none).toEqual({ last: null, stages: [], stopped: "budget" });
    expect(short.deps.advanceOnce).not.toHaveBeenCalled();

    const exact = harness([{ ms: 1_000, result: ran("wake", "ok", null, "failed") }]);
    await driveLoop({ deadlineMs: START + DRIVE_MARGIN_MS + MIN_ROUND_MS }, exact.deps);
    expect(exact.budgets).toEqual([MIN_ROUND_MS]);
  });

  it("starts no further round once less than the floor remains after a stage", async () => {
    // 181 s spent of 300: 119 s remain, 99 s after the margin — under the 100 s floor.
    const h = harness([{ ms: 181_000, result: ran("debate", "ok", -1) }]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(out.stopped).toBe("budget");
    expect(h.deps.advanceOnce).toHaveBeenCalledTimes(1);
    // 180 s spent: exactly the floor remains, so one more round runs.
    const edge = harness([
      { ms: 180_000, result: ran("debate", "ok", -1) },
      { ms: 1_000, result: ran("measure", "ok", null, "failed") },
    ]);
    await driveLoop({ deadlineMs: DEADLINE }, edge.deps);
    expect(edge.budgets).toEqual([240_000, MIN_ROUND_MS]);
  });

  it("does not sleep into less than the floor", async () => {
    // 178 s spent: waking 3 s later would leave 119 s — under the floor.
    const h = harness([{ ms: 178_000, result: ran("debate", "waiting", 3_000) }]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(out.stopped).toBe("budget");
    expect(h.slept).toEqual([]);
    // 177 s spent: waking leaves exactly the floor, so it sleeps and runs the poll.
    const edge = harness([
      { ms: 177_000, result: ran("debate", "waiting", 3_000) },
      { ms: 1_000, result: ran("debate", "ok", null, "failed") },
    ]);
    await driveLoop({ deadlineMs: DEADLINE }, edge.deps);
    expect(edge.slept).toEqual([3_000]);
  });

  it("starts no round after its slice ends, still giving each round the whole deadline", async () => {
    const h = harness([
      { ms: 60_000, result: ran("seal", "ok", -1) },
      { ms: 40_000, result: ran("debate", "waiting", 3_000) },
    ]);
    const out = await driveLoop({ deadlineMs: DEADLINE, startBeforeMs: START + 90_000 }, h.deps);
    expect(out.stopped).toBe("slice");
    // The second round started at 60 s (inside the slice) with the deadline's budget.
    expect(h.budgets).toEqual([240_000, 220_000]);
    expect(h.slept).toEqual([]);
  });

  it("retries a due stage it could not claim at most twice, then stops as contended", async () => {
    expect(MAX_IDLE_ROUNDS).toBe(3);
    const lost = () => ({ ms: 50, result: ran(null, null, -1) });
    const h = harness([lost(), lost(), lost()]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(out.stopped).toBe("contended");
    expect(h.deps.advanceOnce).toHaveBeenCalledTimes(3);
  });

  it("counts a result it could not record (lease lost) as a round that claimed nothing", async () => {
    const h = harness([
      { ms: 50, result: ran("seal", null, -1) },
      { ms: 50, result: ran("seal", "ok", null, "succeeded") },
    ]);
    const out = await driveLoop({ deadlineMs: DEADLINE }, h.deps);
    expect(out.stages).toEqual([{ stage: "seal", status: "ok" }]);
    expect(out.stopped).toBe("done");
  });

  it("propagates the runner's errors (an unknown dossier) to its caller", async () => {
    const deps = {
      advanceOnce: vi.fn(async () => {
        throw new RangeError("boom");
      }),
      now: () => START,
      sleep: vi.fn(async () => {}),
    };
    await expect(driveLoop({ deadlineMs: DEADLINE }, deps)).rejects.toThrow("boom");
  });
});
