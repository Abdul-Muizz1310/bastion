import { describe, expect, it } from "vitest";
import { parseStreamEvent } from "@/features/dossier/live/events";

/**
 * Spec 21 §6.6: the browser parses every SSE event from the stream route — never casts it. Anything
 * outside the contract is dropped (null), so a malformed event cannot corrupt the timeline.
 */

const STEP = {
  stage: "debate",
  status: "waiting",
  attempt: 1,
  error: null,
  nextAt: "2026-10-20T10:00:03.000Z",
  leaseUntil: null,
  startedAt: "2026-10-20T10:00:00.000Z",
  finishedAt: null,
  note: "debate 889d7f2b is running",
};

describe("parseStreamEvent", () => {
  it("reads a step event", () => {
    expect(parseStreamEvent("step", JSON.stringify(STEP))).toEqual({ type: "step", step: STEP });
  });

  it("reads a status event and a done event", () => {
    const status = { status: "running", verdict: null, confidence: null };
    expect(parseStreamEvent("status", JSON.stringify(status))).toEqual({ type: "status", status });
    const done = { status: "succeeded", verdict: "TRUE", confidence: 0.82 };
    expect(parseStreamEvent("done", JSON.stringify(done))).toEqual({ type: "done", done });
    const deleted = { status: "failed", reason: "dossier_deleted" };
    expect(parseStreamEvent("done", JSON.stringify(deleted))).toEqual({
      type: "done",
      done: { status: "failed", verdict: null, confidence: null, reason: "dossier_deleted" },
    });
  });

  it("reads timeout and heartbeat", () => {
    expect(parseStreamEvent("timeout", "{}")).toEqual({ type: "timeout" });
    expect(parseStreamEvent("heartbeat", JSON.stringify({ t: "x" }))).toEqual({ type: "heartbeat" });
  });

  it.each([
    ["an unknown stage", { ...STEP, stage: "adjudicate" }],
    ["an unknown status", { ...STEP, status: "started" }],
    ["a negative attempt", { ...STEP, attempt: -1 }],
    ["a fractional attempt", { ...STEP, attempt: 1.5 }],
    ["a time that is not a date", { ...STEP, nextAt: "soon" }],
    ["a missing field", { ...STEP, note: undefined }],
  ])("drops a step event with %s", (_what, body) => {
    expect(parseStreamEvent("step", JSON.stringify(body))).toBeNull();
  });

  it("drops a status outside the dossier's four, and a confidence outside 0..1", () => {
    expect(parseStreamEvent("status", JSON.stringify({ status: "done", verdict: null, confidence: null }))).toBeNull();
    expect(
      parseStreamEvent("status", JSON.stringify({ status: "running", verdict: "TRUE", confidence: 7 })),
    ).toBeNull();
  });

  it("drops data that is not JSON, and an event type it does not know", () => {
    expect(parseStreamEvent("step", "{not json")).toBeNull();
    expect(parseStreamEvent("state", JSON.stringify(STEP))).toBeNull();
  });
});
