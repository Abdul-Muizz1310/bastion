import { describe, expect, it } from "vitest";
import { dueAt, frontier, isDue, NUDGE_GRACE_MS, nudgeAt } from "@/features/dossier/live/nudge";
import { stepView, viewsAt } from "../fixtures";

/**
 * Spec 21 §6.6, "The nudge" (carry from Task 5: after a stage_timeout nothing advances by itself).
 * The frontier stage is due when it runs on an expired lease, or waits / is pending past its
 * nextAt with no lease held. Pure: time comes in as `now` (ms).
 */

const NOW = Date.parse("2026-10-20T10:05:00.000Z");
const before = (ms: number) => new Date(NOW - ms).toISOString();
const after = (ms: number) => new Date(NOW + ms).toISOString();

describe("frontier", () => {
  it("is the first stage that is not ok or skipped", () => {
    const steps = viewsAt("seal", "waiting");
    steps[1] = stepView("gather", "skipped");
    expect(frontier(steps)?.stage).toBe("seal");
  });

  it("is null once every stage is ok or skipped, and for no steps at all", () => {
    expect(frontier(viewsAt("record", "ok"))).toBeNull();
    expect(frontier([])).toBeNull();
  });
});

describe("isDue — lease expired OR nextAt passed", () => {
  it("a running stage whose lease expired is due (a crashed invocation)", () => {
    expect(isDue(stepView("seal", "running", { leaseUntil: before(1) }), NOW)).toBe(true);
  });

  it("a running stage under a live lease is not", () => {
    expect(isDue(stepView("seal", "running", { leaseUntil: after(60_000) }), NOW)).toBe(false);
  });

  it("a running stage that holds no lease at all is due (nothing protects it)", () => {
    expect(isDue(stepView("seal", "running", { leaseUntil: null }), NOW)).toBe(true);
  });

  it("a waiting stage is due once its nextAt has passed", () => {
    expect(isDue(stepView("debate", "waiting", { nextAt: before(1) }), NOW)).toBe(true);
    expect(isDue(stepView("debate", "waiting", { nextAt: new Date(NOW).toISOString() }), NOW)).toBe(true);
    expect(isDue(stepView("debate", "waiting", { nextAt: after(3_000) }), NOW)).toBe(false);
  });

  it("a pending stage after a stage_timeout is held until its floor passes, then due", () => {
    const timedOut = stepView("seal", "pending", {
      attempt: 1,
      error: "stage_timeout: exceeded 240000 ms",
      nextAt: after(25_000),
    });
    expect(isDue(timedOut, NOW)).toBe(false);
    expect(isDue(timedOut, NOW + 25_000)).toBe(true);
  });

  it("a pending stage with no nextAt is due at once", () => {
    expect(isDue(stepView("wake", "pending"), NOW)).toBe(true);
  });

  it("a pending or waiting stage that still holds a lease is not due until it ends", () => {
    const leased = stepView("debate", "waiting", { nextAt: before(1), leaseUntil: after(10_000) });
    expect(isDue(leased, NOW)).toBe(false);
    expect(isDue(leased, NOW + 10_000)).toBe(true);
  });

  it.each(["ok", "skipped", "error"] as const)("a %s stage is never due", (status) => {
    expect(isDue(stepView("seal", status, { nextAt: before(1), leaseUntil: before(1) }), NOW)).toBe(
      false,
    );
  });
});

describe("dueAt and nudgeAt", () => {
  it("dueAt is the lease's end for a running stage, the later of nextAt and the lease otherwise", () => {
    expect(dueAt(stepView("seal", "running", { leaseUntil: after(9_000) }))).toBe(NOW + 9_000);
    expect(dueAt(stepView("seal", "waiting", { nextAt: after(3_000), leaseUntil: after(5_000) }))).toBe(
      NOW + 5_000,
    );
    expect(dueAt(stepView("seal", "pending"))).toBe(0);
    expect(dueAt(stepView("seal", "error"))).toBeNull();
  });

  it("nudgeAt is the frontier's dueAt plus the grace, so the runner's own chain goes first", () => {
    expect(NUDGE_GRACE_MS).toBe(5_000);
    expect(nudgeAt(viewsAt("debate", "waiting", { nextAt: after(3_000) }))).toBe(
      NOW + 3_000 + NUDGE_GRACE_MS,
    );
  });

  it("nudgeAt is null when the frontier is an error (a retry is the visitor's) or none is left", () => {
    expect(nudgeAt(viewsAt("seal", "error", { error: "x" }))).toBeNull();
    expect(nudgeAt(viewsAt("record", "ok"))).toBeNull();
  });
});
