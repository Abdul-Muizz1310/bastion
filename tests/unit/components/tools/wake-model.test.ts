import { describe, expect, it } from "vitest";
import {
  gateView,
  initialWake,
  rewakeAll,
  wakeAnswered,
  wakeStarted,
} from "@/components/tools/wake-model";

/**
 * The wake gate's state (spec 21 §5.1, Ruling F): checking → waking (elapsed seconds) → the wake
 * route's own answer. Pure, so the page's timing is the only thing the browser adds.
 */

const T0 = 1_000_000;

describe("the wake gate", () => {
  it("starts checking every service, with nothing enabled", () => {
    const view = gateView(initialWake(["inkthread"]), "inkthread", T0);
    expect(view.ready).toBe(false);
    expect(view.state).toBe("checking");
    expect(view.rows).toEqual([{ service: "inkthread", state: "checking" }]);
    expect(view.retry).toBe(false);
  });

  it("counts whole seconds while a wake is in flight", () => {
    const state = wakeStarted(initialWake(["inkthread"]), "inkthread", T0);
    const view = gateView(state, "inkthread", T0 + 23_900);
    expect(view.state).toBe("waking");
    expect(view.rows[0]).toEqual({ service: "inkthread", state: "waking", detail: "23 s" });
    expect(view.ready).toBe(false);
  });

  it("is ready once the wake route answers live for every service", () => {
    let state = wakeStarted(initialWake(["inkthread"]), "inkthread", T0);
    state = wakeAnswered(state, "inkthread", { kind: "answer", state: "live", latencyMs: 412 }, T0 + 500);
    const view = gateView(state, "inkthread", T0 + 9_000);
    expect(view.ready).toBe(true);
    expect(view.state).toBe("live");
    expect(view.rows[0]).toMatchObject({ state: "live", detail: "412 ms" });
    expect(view.retry).toBe(false);
  });

  it("says how long a cold start took", () => {
    let state = wakeStarted(initialWake(["magpie"]), "magpie", T0);
    state = wakeAnswered(state, "magpie", { kind: "answer", state: "live", latencyMs: 58_400 }, T0 + 58_400);
    expect(gateView(state, "magpie", T0 + 60_000).rows[0]?.detail).toBe("woke in 58 s");
  });

  it("waits for every service: one live and one still waking is not ready", () => {
    let state = initialWake(["paper-trail", "inkprint"]);
    state = wakeStarted(state, "paper-trail", T0);
    state = wakeStarted(state, "inkprint", T0);
    state = wakeAnswered(state, "paper-trail", { kind: "answer", state: "live", latencyMs: 30 }, T0);
    const view = gateView(state, "dossier", T0 + 2_000);
    expect(view.ready).toBe(false);
    expect(view.state).toBe("waking");
  });

  it.each([
    ["asleep", "asleep"],
    ["down", "down"],
  ] as const)("shows an %s answer as %s and offers a retry", (answer, shown) => {
    let state = wakeStarted(initialWake(["inkprint"]), "inkprint", T0);
    state = wakeAnswered(state, "inkprint", { kind: "answer", state: answer, latencyMs: 90_000 }, T0 + 90_000);
    const view = gateView(state, "inkprint", T0 + 90_000);
    expect(view.ready).toBe(false);
    expect(view.state).toBe(shown);
    expect(view.retry).toBe(true);
  });

  it("shows a failed wake request as unknown — never a guessed state — with a retry", () => {
    let state = wakeStarted(initialWake(["inkprint"]), "inkprint", T0);
    state = wakeAnswered(state, "inkprint", { kind: "failed", detail: "network" }, T0 + 100);
    const view = gateView(state, "inkprint", T0 + 100);
    expect(view.state).toBe("unknown");
    expect(view.rows[0]).toMatchObject({ state: "unknown", detail: "the wake request failed" });
    expect(view.retry).toBe(true);
    expect(view.ready).toBe(false);
  });

  it("says when a rate-limited wake may be retried", () => {
    let state = wakeStarted(initialWake(["inkprint"]), "inkprint", T0);
    state = wakeAnswered(state, "inkprint", { kind: "rate_limited", retryAfterS: 17 }, T0);
    const view = gateView(state, "inkprint", T0);
    expect(view.rows[0]).toMatchObject({ state: "unknown", detail: "too many wakes · retry in 17 s" });
    expect(view.retry).toBe(true);
  });

  it("takes the worst settled state for the product: down over unknown over asleep", () => {
    let state = initialWake(["paper-trail", "inkprint", "magpie"]);
    for (const s of ["paper-trail", "inkprint", "magpie"] as const) state = wakeStarted(state, s, T0);
    state = wakeAnswered(state, "paper-trail", { kind: "answer", state: "asleep", latencyMs: 1 }, T0);
    state = wakeAnswered(state, "inkprint", { kind: "failed", detail: "x" }, T0);
    expect(gateView(state, "x", T0).state).toBe("waking");
    state = wakeAnswered(state, "magpie", { kind: "answer", state: "down", latencyMs: 1 }, T0);
    expect(gateView(state, "x", T0).state).toBe("down");
  });

  it("is live at once for a product with no service of its own (bastion)", () => {
    const view = gateView(initialWake([]), "bastion", T0);
    expect(view.ready).toBe(true);
    expect(view.state).toBe("live");
    expect(view.rows).toEqual([]);
  });

  it("restarts a service's wake on retry", () => {
    let state = wakeStarted(initialWake(["inkprint"]), "inkprint", T0);
    state = wakeAnswered(state, "inkprint", { kind: "failed", detail: "x" }, T0);
    state = wakeStarted(state, "inkprint", T0 + 5_000);
    expect(gateView(state, "inkprint", T0 + 7_000).rows[0]).toMatchObject({
      state: "waking",
      detail: "2 s",
    });
  });

  it("refuses a service the gate does not hold", () => {
    expect(() => wakeStarted(initialWake(["inkprint"]), "magpie", T0)).toThrow(RangeError);
    expect(() =>
      wakeAnswered(initialWake(["inkprint"]), "magpie", { kind: "failed", detail: "x" }, T0),
    ).toThrow(RangeError);
  });

  it("refuses a repeated service", () => {
    expect(() => initialWake(["inkprint", "inkprint"])).toThrow(RangeError);
  });

  it("announces the phase in words for assistive tech, without the ticking seconds", () => {
    let state = wakeStarted(initialWake(["inkprint"]), "inkprint", T0);
    const waking = gateView(state, "inkprint", T0 + 3_000).announcement;
    expect(waking).toBe(gateView(state, "inkprint", T0 + 9_000).announcement);
    expect(waking).toMatch(/waking inkprint/i);
    state = wakeAnswered(state, "inkprint", { kind: "answer", state: "live", latencyMs: 1 }, T0);
    expect(gateView(state, "inkprint", T0).announcement).toMatch(/inkprint is live/i);
  });

  it("re-gates a live product when a call finds it asleep: every service waking, nothing enabled", () => {
    let state = initialWake(["inkprint", "magpie"]);
    for (const s of ["inkprint", "magpie"] as const) {
      state = wakeStarted(state, s, T0);
      state = wakeAnswered(state, s, { kind: "answer", state: "live", latencyMs: 9 }, T0);
    }
    expect(gateView(state, "x", T0).ready).toBe(true);
    const again = rewakeAll(state, T0 + 1_000);
    const view = gateView(again, "x", T0 + 3_000);
    expect(view.ready).toBe(false);
    expect(view.rows.map((r) => r.state)).toEqual(["waking", "waking"]);
    expect(view.rows[0]?.detail).toBe("2 s");
  });

  it("re-gating a product with no service leaves it live", () => {
    expect(gateView(rewakeAll(initialWake([]), T0), "bastion", T0).ready).toBe(true);
  });
});
