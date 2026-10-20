import { describe, expect, it, vi } from "vitest";
import { HELD_REASON, whenLive } from "@/components/tools/held";

/**
 * Invariant 1 (spec 21 §5.1, review round 4): an action whose control cannot be `disabled` — an SVG
 * node, a file picker's answer — checks the gate itself: while it is not live the handler does
 * nothing but say why.
 */

describe("whenLive", () => {
  it("runs the action with its arguments while the gate is live", () => {
    const run = vi.fn();
    const onHeld = vi.fn();
    whenLive(true, run, onHeld)("p:1", 2);
    expect(run).toHaveBeenCalledWith("p:1", 2);
    expect(onHeld).not.toHaveBeenCalled();
  });

  it("does nothing but say why while the gate is not live", () => {
    const run = vi.fn();
    const onHeld = vi.fn();
    whenLive(false, run, onHeld)("p:1");
    expect(run).not.toHaveBeenCalled();
    expect(onHeld).toHaveBeenCalledTimes(1);
  });

  it("holds the action even when there is nothing to say", () => {
    const run = vi.fn();
    whenLive(false, run)("p:1");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("HELD_REASON", () => {
  it("says what unlocks the action, never that something failed", () => {
    expect(HELD_REASON).toMatch(/unlocks once the wake above answers live/);
    expect(HELD_REASON).not.toMatch(/fail|error/i);
  });
});
