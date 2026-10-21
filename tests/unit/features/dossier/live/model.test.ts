import { describe, expect, it } from "vitest";
import { initialLive, liveReducer } from "@/features/dossier/live/model";
import { stepView, viewsAt } from "../fixtures";

/** Spec 21 §6.6: the live island's state, folded from the stream's events. Pure. */

const running = () =>
  initialLive({ status: "running", verdict: null, confidence: null, steps: viewsAt("seal", "running") });

describe("liveReducer", () => {
  it("starts from the server's render, connecting while the dossier is unfinished", () => {
    const s = running();
    expect(s.connection).toBe("connecting");
    expect(s.finished).toBe(false);
    expect(s.steps.map((x) => x.stage)).toEqual([
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

  it("does not connect for a finished or failed dossier", () => {
    for (const status of ["succeeded", "failed"] as const) {
      const s = initialLive({ status, verdict: null, confidence: null, steps: viewsAt("seal", "ok") });
      expect(s.connection).toBe("closed");
      expect(s.finished).toBe(true);
    }
  });

  it("replaces the one stage a step event names, keeping stage order", () => {
    const next = stepView("seal", "ok", { note: "certified 4 of 5" });
    const s = liveReducer(running(), { type: "event", event: { type: "step", step: next } });
    expect(s.steps[3]).toEqual(next);
    expect(s.steps[2]?.stage).toBe("read");
    expect(s.steps).toHaveLength(8);
  });

  it("takes the status, verdict and confidence from a status event", () => {
    const s = liveReducer(running(), {
      type: "event",
      event: { type: "status", status: { status: "running", verdict: "TRUE", confidence: 0.5 } },
    });
    expect(s).toMatchObject({ status: "running", verdict: "TRUE", confidence: 0.5, finished: false });
  });

  it("finishes and closes on done", () => {
    const s = liveReducer(running(), {
      type: "event",
      event: { type: "done", done: { status: "succeeded", verdict: "FALSE", confidence: 0.7 } },
    });
    expect(s).toMatchObject({ status: "succeeded", verdict: "FALSE", finished: true, connection: "closed" });
  });

  it("tracks the connection: open, reconnecting after an error, reconnecting after a timeout", () => {
    let s = liveReducer(running(), { type: "connection", state: "open" });
    expect(s.connection).toBe("open");
    s = liveReducer(s, { type: "connection", state: "reconnecting" });
    expect(s.connection).toBe("reconnecting");
    s = liveReducer(s, { type: "event", event: { type: "timeout" } });
    expect(s.connection).toBe("reconnecting");
  });

  it("finishes on a done whose body did not parse, keeping what it knew (Ruling AK)", () => {
    const s = liveReducer(running(), { type: "event", event: { type: "ended" } });
    expect(s).toMatchObject({ finished: true, connection: "closed", status: "running" });
  });

  it("knows a paused stream (hidden tab) and one that stopped trying", () => {
    expect(liveReducer(running(), { type: "connection", state: "paused" }).connection).toBe("paused");
    expect(liveReducer(running(), { type: "connection", state: "failed" }).connection).toBe("failed");
  });

  it("ignores connection changes once finished", () => {
    const done = liveReducer(running(), {
      type: "event",
      event: { type: "done", done: { status: "failed", verdict: null, confidence: null } },
    });
    expect(liveReducer(done, { type: "connection", state: "reconnecting" }).connection).toBe("closed");
  });

  it("refuses initial steps that are not one per stage", () => {
    expect(() =>
      initialLive({ status: "running", verdict: null, confidence: null, steps: viewsAt("seal", "ok").slice(1) }),
    ).toThrow(RangeError);
  });

  it("starts with no steps for a dossier that predates the step machine", () => {
    const s = initialLive({ status: "succeeded", verdict: "TRUE", confidence: 0.9, steps: [] });
    expect(s.steps).toEqual([]);
  });
});
