import { describe, expect, it } from "vitest";
import { initialLive, liveReducer } from "@/features/dossier/live/model";
import { type SlipFacts, slipView } from "@/features/dossier/slip-view";
import { stepView, viewsAt } from "./fixtures";

/**
 * Spec 21 §6.6, "The live card" (review round 1): the verdict slip beside the claim. Rendered from
 * the server's facts; while the island follows a run, its status, stamp and confidence come from
 * the stream, and counts the stream does not carry never read as stale zeros.
 */

const ID = "5b1e0c3a-9d4f-4e2b-8a6c-7f1d2e3c4b5a";

function facts(over: Partial<SlipFacts> = {}): SlipFacts {
  return {
    id: ID,
    status: "running",
    verdict: null,
    confidence: null,
    evidence: { items: 0, certified: 0 },
    documents: 1,
    envelopeId: null,
    mode: "standard",
    ...over,
  };
}

const line = (v: ReturnType<typeof slipView>, label: string) => v.lines.find(([l]) => l === label)?.[1];

function live(steps = viewsAt("debate", "running")) {
  return initialLive({ status: "running", verdict: null, confidence: null, steps });
}

describe("slipView", () => {
  it("a status event with a verdict changes the slip: stamp, confidence, status", () => {
    const before = live();
    expect(slipView(facts(), before).stamp).toBeNull();
    const after = liveReducer(before, {
      type: "event",
      event: { type: "status", status: { status: "running", verdict: "TRUE", confidence: 0.82 } },
    });
    const v = slipView(facts(), after);
    expect(v.stamp).toEqual({ text: "true", tone: "pass" });
    expect(line(v, "confidence")).toBe("82 %");
    expect(line(v, "status")).toBe("running");
  });

  it("follows the status the stream sends (queued → running → sealed)", () => {
    const queued = initialLive({ status: "pending", verdict: null, confidence: null, steps: viewsAt("wake", "pending") });
    expect(line(slipView(facts({ status: "pending" }), queued), "status")).toBe("queued");
    const moving = liveReducer(queued, {
      type: "event",
      event: { type: "status", status: { status: "running", verdict: null, confidence: null } },
    });
    expect(line(slipView(facts({ status: "pending" }), moving), "status")).toBe("running");
  });

  it("while unfinished, counts the stream does not carry are never stale zeros", () => {
    const v = slipView(facts(), live(viewsAt("seal", "running")));
    expect(line(v, "evidence")).toBe("after seal");
    expect(line(v, "envelope")).toBe("after the run");
    expect(v.lines.some(([, value]) => /^0 items/.test(value))).toBe(false);
  });

  it("reads seal's own count once seal is ok, and its reason when it was skipped", () => {
    const sealed = live(viewsAt("debate", "running"));
    const withNote = liveReducer(sealed, {
      type: "event",
      event: { type: "step", step: stepView("seal", "ok", { note: "certified 12 of 12" }) },
    });
    expect(line(slipView(facts(), withNote), "evidence")).toBe("certified 12 of 12");
    const skipped = liveReducer(sealed, {
      type: "event",
      event: { type: "step", step: stepView("seal", "skipped", { note: "no evidence to seal" }) },
    });
    expect(line(slipView(facts(), skipped), "evidence")).toBe("no evidence to seal");
  });

  it("names the envelope once its stage is ok", () => {
    const sealedRun = liveReducer(live(viewsAt("record", "running")), {
      type: "event",
      event: { type: "step", step: stepView("envelope", "ok", { note: "envelope 550e8400" }) },
    });
    expect(line(slipView(facts(), sealedRun), "envelope")).toBe("envelope 550e8400");
  });

  it("shows the server's counts for a finished or failed dossier", () => {
    const done = facts({
      status: "succeeded",
      verdict: "FALSE",
      confidence: 0.66,
      evidence: { items: 3, certified: 2 },
      envelopeId: "550e8400-e29b-41d4-a716-446655440000",
    });
    const v = slipView(done, null);
    expect(v.stamp).toEqual({ text: "false", tone: "fail" });
    expect(line(v, "evidence")).toBe("3 items · 2 certified");
    expect(line(v, "envelope")).toBe("550e8400");
    expect(line(v, "status")).toBe("sealed");
    expect(v.verifyLink).toBe(true);
    const failed = slipView(facts({ status: "failed" }), null);
    expect(line(failed, "envelope")).toBe("not sealed");
    expect(failed.noVerdict).toMatch(/stopped before the debate finished/);
  });

  it("offers the verify link only on a finished or failed page", () => {
    expect(slipView(facts(), live()).verifyLink).toBe(false);
    expect(slipView(facts({ status: "failed" }), null).verifyLink).toBe(true);
  });
});
