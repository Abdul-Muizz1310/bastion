import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NUDGE_GRACE_MS } from "@/features/dossier/live/nudge";
import { type AdvanceOutcome, createNudger } from "@/features/dossier/live/nudger";
import { stepView, viewsAt } from "../fixtures";

/**
 * Spec 21 §6.6, "The nudge": the page's fallback driver. It calls advance when the frontier stage
 * has been due for the grace period — single-flight (at most one call at a time), backing off on a
 * 429 for as long as it was told, on any other failure 15 s doubling to 2 min, and stopping for an
 * unknown dossier. Time is faked; the controller is the one the live island runs.
 */

const T0 = Date.parse("2026-10-20T10:05:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

type Deferred = { resolve: (o: AdvanceOutcome) => void; signal: AbortSignal };

function harness() {
  const calls: Deferred[] = [];
  const advance = vi.fn(
    (signal: AbortSignal) =>
      new Promise<AdvanceOutcome>((resolve) => {
        calls.push({ resolve, signal });
      }),
  );
  const nudger = createNudger({
    advance,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  return { advance, calls, nudger };
}

/** Lets the promise chain after a resolved advance run. */
async function settle(d: Deferred | undefined, outcome: AdvanceOutcome) {
  if (!d) throw new Error("no advance in flight");
  d.resolve(outcome);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createNudger", () => {
  it("waits until the frontier has been due for the grace, then calls advance once", async () => {
    const { advance, nudger } = harness();
    nudger.update(viewsAt("debate", "waiting", { nextAt: at(3_000) }));
    await vi.advanceTimersByTimeAsync(3_000 + NUDGE_GRACE_MS - 1);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("nudges a stage whose lease expired (a crashed run) and one held after a stage_timeout", async () => {
    const { advance, nudger } = harness();
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(advance).toHaveBeenCalledTimes(1);

    const second = harness();
    second.nudger.update(
      viewsAt("seal", "pending", { attempt: 1, error: "stage_timeout: x", nextAt: at(30_000) }),
    );
    await vi.advanceTimersByTimeAsync(30_000 + NUDGE_GRACE_MS);
    expect(second.advance).toHaveBeenCalledTimes(1);
  });

  it("keeps at most one advance in flight, whatever the stream says meanwhile", async () => {
    const { advance, calls, nudger } = harness();
    const due = viewsAt("seal", "running", { leaseUntil: at(-60_000) });
    nudger.update(due);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) {
      nudger.update([...due]);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(advance).toHaveBeenCalledTimes(1);
    expect(nudger.status().inFlight).toBe(true);
    await settle(calls[0], { kind: "ok", nextAt: null, dossier: "running" });
    expect(nudger.status().inFlight).toBe(false);
  });

  it("after an answered advance, waits for the nextAt it named (plus the grace) before nudging again", async () => {
    const { advance, calls, nudger } = harness();
    const stale = viewsAt("seal", "running", { leaseUntil: at(-60_000) });
    nudger.update(stale);
    await vi.advanceTimersByTimeAsync(0);
    await settle(calls[0], { kind: "ok", nextAt: at(20_000), dossier: "running" });
    // The stream has not caught up: the stale row still looks due.
    await vi.advanceTimersByTimeAsync(20_000 + NUDGE_GRACE_MS - 1);
    expect(advance).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it("backs off on a 429 for as long as it was told", async () => {
    const { advance, calls, nudger } = harness();
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    await settle(calls[0], { kind: "rate_limited", retryAfterS: 40 });
    await vi.advanceTimersByTimeAsync(39_999);
    expect(advance).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it("backs off 15 s after a failure, doubling to 2 min", async () => {
    const { advance, calls, nudger } = harness();
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      await settle(calls[i], { kind: "failed", detail: "advance answered 500" });
      const t = Date.now();
      while (advance.mock.calls.length === i + 1) await vi.advanceTimersByTimeAsync(1_000);
      waits.push(Date.now() - t);
    }
    expect(waits).toEqual([15_000, 30_000, 60_000, 120_000, 120_000]);
  });

  it("a success resets the failure backoff", async () => {
    const { advance, calls, nudger } = harness();
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    await settle(calls[0], { kind: "failed", detail: "x" });
    await vi.advanceTimersByTimeAsync(15_000);
    await settle(calls[1], { kind: "ok", nextAt: null, dossier: "running" });
    await vi.advanceTimersByTimeAsync(NUDGE_GRACE_MS);
    expect(advance).toHaveBeenCalledTimes(3);
    await settle(calls[2], { kind: "failed", detail: "x" });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(advance).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(4);
  });

  it("stops for good when advance says the dossier is unknown (404)", async () => {
    const { advance, calls, nudger } = harness();
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    await settle(calls[0], { kind: "gone" });
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(nudger.status().stopped).toBe(true);
  });

  it("never nudges an error stage (retry is the visitor's) nor a finished dossier", async () => {
    const { advance, nudger } = harness();
    nudger.update(viewsAt("seal", "error", { error: "inkprint.certifyBatch: downstream_error" }));
    await vi.advanceTimersByTimeAsync(600_000);
    nudger.update(viewsAt("record", "ok"));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(advance).not.toHaveBeenCalled();
  });

  it("re-plans when the stream moves on: a stage now under a live lease is not nudged", async () => {
    const { advance, nudger } = harness();
    nudger.update(viewsAt("debate", "waiting", { nextAt: at(3_000) }));
    await vi.advanceTimersByTimeAsync(4_000);
    nudger.update(viewsAt("debate", "running", { leaseUntil: at(270_000) }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(advance).not.toHaveBeenCalled();
    nudger.update([stepView("wake", "ok"), ...viewsAt("debate", "running", { leaseUntil: at(270_000) }).slice(1)]);
    await vi.advanceTimersByTimeAsync(270_000 - 64_000 + NUDGE_GRACE_MS);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("dispose aborts the call in flight and plans nothing more", async () => {
    const { advance, calls, nudger } = harness();
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    nudger.dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it("counts a thrown advance as a failure, never a crash", async () => {
    const advance = vi.fn(async () => {
      throw new Error("network");
    });
    const nudger = createNudger({
      advance,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    nudger.update(viewsAt("seal", "running", { leaseUntil: at(-60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(advance).toHaveBeenCalledTimes(2);
  });
});
