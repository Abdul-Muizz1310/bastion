import { describe, expect, it } from "vitest";
import { initialLive, type LiveState, liveReducer } from "@/features/dossier/live/model";
import { connectionWords, nudgeWords } from "@/features/dossier/live/words";
import { viewsAt } from "../fixtures";

/**
 * Spec 21 §6.6: what the live island says about its stream and its nudges — in words, so a paused
 * (hidden) tab and a stream that stopped trying are never silent.
 */

const running = () =>
  initialLive({ status: "running", verdict: null, confidence: null, steps: viewsAt("seal", "running") });
const withConnection = (state: "open" | "reconnecting" | "paused" | "failed"): LiveState =>
  liveReducer(running(), { type: "connection", state });

describe("connectionWords", () => {
  it.each([
    ["connecting", running(), /connecting to the live run/],
    ["open", withConnection("open"), /following the live run/],
    ["reconnecting", withConnection("reconnecting"), /reconnecting/],
    ["paused", withConnection("paused"), /paused while this tab is hidden/],
    ["failed", withConnection("failed"), /stopped following: bastion’s stream did not open five times in a row/],
  ])("says %s", (_what, state, words) => {
    expect(connectionWords(state).text).toMatch(words);
  });

  it("offers a reload only when the stream stopped trying", () => {
    expect(connectionWords(withConnection("failed")).reload).toBe(true);
    expect(connectionWords(withConnection("reconnecting")).reload).toBe(false);
  });

  it("says where a failed run stopped, and that a finished one is loading its receipt", () => {
    const failed = initialLive({
      status: "failed",
      verdict: null,
      confidence: null,
      steps: viewsAt("seal", "error", { error: "x" }),
    });
    expect(connectionWords(failed).text).toBe("the run stopped at seal: retry it from that stage below.");
    const done = liveReducer(running(), { type: "event", event: { type: "ended" } });
    expect(connectionWords(done).text).toMatch(/loading its receipt/);
  });
});

describe("nudgeWords", () => {
  const at = Date.parse("2026-10-20T10:05:03Z");
  it.each([
    [{ kind: "ok" as const, nextAt: null, dossier: "running" as const }, "This page nudged the runner at 10:05:03 UTC: the stage it shows was due."],
    [{ kind: "rate_limited" as const, retryAfterS: 40 }, "The runner told this page to wait 40 s before nudging again (10:05:03 UTC)."],
    [{ kind: "gone" as const }, "bastion no longer knows this dossier."],
  ])("words %j", (outcome, words) => {
    expect(nudgeWords(outcome, at)).toBe(words);
  });
});
