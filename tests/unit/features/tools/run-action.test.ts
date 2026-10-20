import { describe, expect, it, vi } from "vitest";
import type { ToolOutcome } from "@/features/tools/outcome";
import { needsLoad, nextLoad, runAction } from "@/features/tools/run-action";

/**
 * One workbench action (spec 21 §5.1, review fix 2): its outcome, or null when the page moved on —
 * and an asleep answer reported, so the wake gate can put the product back to waking.
 */

const signal = () => new AbortController().signal;

describe("runAction", () => {
  it("hands back the outcome, and says nothing about sleep for an answer", async () => {
    const onAsleep = vi.fn();
    const ok: ToolOutcome<number> = { ok: true, data: 1, status: 200, requestId: "r" };
    expect(await runAction(async () => ok, signal(), { onAsleep })).toBe(ok);
    expect(onAsleep).not.toHaveBeenCalled();
  });

  it("reports an asleep outcome once, so the gate wakes the product again", async () => {
    const onAsleep = vi.fn();
    const asleep: ToolOutcome<number> = { ok: false, kind: "asleep", requestId: "r" };
    expect(await runAction(async () => asleep, signal(), { onAsleep })).toBe(asleep);
    expect(onAsleep).toHaveBeenCalledTimes(1);
  });

  it("turns a throw into bastion unreachable, never a crash", async () => {
    const outcome = await runAction(async () => {
      throw new Error("boom");
    }, signal(), { onAsleep: vi.fn() });
    expect(outcome).toMatchObject({ ok: false, kind: "unreachable", requestId: null });
  });

  it("returns null and reports nothing once the page has moved on", async () => {
    const controller = new AbortController();
    const onAsleep = vi.fn();
    const outcome = await runAction(
      async () => {
        controller.abort();
        return { ok: false, kind: "asleep", requestId: "r" } as ToolOutcome<number>;
      },
      controller.signal,
      { onAsleep },
    );
    expect(outcome).toBeNull();
    expect(onAsleep).not.toHaveBeenCalled();
  });
});

describe("needsLoad (Ruling AI)", () => {
  it("loads what was never loaded", () => {
    expect(needsLoad(null)).toBe(true);
  });

  it("loads again what failed — an asleep first load retries once the gate reopens", () => {
    expect(needsLoad({ ok: false, kind: "asleep", requestId: "r" })).toBe(true);
    expect(needsLoad({ ok: false, kind: "unreachable", requestId: null })).toBe(true);
  });

  it("never reloads what already loaded", () => {
    expect(needsLoad({ ok: true, data: [], status: 200, requestId: "r" })).toBe(false);
  });
});

describe("nextLoad (review round 3: retry a first load at most once per failure)", () => {
  const failed: ToolOutcome<number> = { ok: false, kind: "asleep", requestId: "r" };
  const done: ToolOutcome<number> = { ok: true, data: 1, status: 200, requestId: "r" };

  it("loads what was never loaded, without spending the retry", () => {
    expect(nextLoad(null, false)).toEqual({ load: true, retried: false });
  });

  it("retries a failed first load once", () => {
    expect(nextLoad(failed, false)).toEqual({ load: true, retried: true });
  });

  it("does not retry it a second time: a load that keeps timing out never loops", () => {
    expect(nextLoad(failed, true)).toEqual({ load: false, retried: true });
  });

  it("clears the flag once a load succeeds, so a later failure gets its one retry again", () => {
    expect(nextLoad(done, true)).toEqual({ load: false, retried: false });
  });
});
