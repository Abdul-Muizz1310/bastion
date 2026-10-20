import { describe, expect, it } from "vitest";
import { EMPTY_SUMMARY, summarize, summarizeRow } from "@/dossier/step-summary";
import type { StepRow } from "@/dossier/stages";

/**
 * Spec 21 §6.6, "The live run": the few small facts a step's note needs, read off its output —
 * never the output itself. `summarize` is the pure reference; the stream's SQL projection
 * (`loadStepSummaries`) must agree with it row for row (tests/integration/db/step-summaries).
 */

describe("summarize", () => {
  it("counts an array output (gather's and read's candidates) and keeps nothing of it", () => {
    const s = summarize([{ key: "w-1", text: "x".repeat(100_000) }, { key: "w-2", text: "y" }]);
    expect(s).toEqual({ ...EMPTY_SUMMARY, length: 2 });
    expect(JSON.stringify(s).length).toBeLessThan(400);
  });

  it("keeps the small fields a note reads, by type", () => {
    expect(
      summarize({
        reason: "no_sources",
        live: ["inkprint", "paper-trail"],
        asleep: ["magpie"],
        certified: 4,
        total: 5,
        debateId: "889d7f2b-33c0",
        verdict: "TRUE",
        confidence: 0.82,
        perfReceiptHash: "abc",
        envelopeId: "env",
        auditDigest: "dig",
        failedDebateIds: ["x"],
        other: { big: "z".repeat(10_000) },
      }),
    ).toEqual({
      length: null,
      reason: "no_sources",
      live: ["inkprint", "paper-trail"],
      asleep: ["magpie"],
      certified: 4,
      total: 5,
      debateId: "889d7f2b-33c0",
      verdict: "TRUE",
      confidence: 0.82,
      perfReceiptHash: "abc",
      envelopeId: "env",
      auditDigest: "dig",
    });
  });

  it("drops a field of the wrong type, an empty string, and a list that is not all strings", () => {
    expect(
      summarize({ certified: "four", debateId: "", verdict: 7, live: ["inkprint", 3], asleep: "magpie" }),
    ).toEqual(EMPTY_SUMMARY);
  });

  it("reads nothing from a scalar or null output", () => {
    expect(summarize(null)).toEqual(EMPTY_SUMMARY);
    expect(summarize("asleep")).toEqual(EMPTY_SUMMARY);
    expect(summarize(3)).toEqual(EMPTY_SUMMARY);
  });

  it("summarizeRow swaps a row's output for its summary", () => {
    const row: StepRow = {
      dossierId: "d",
      stage: "seal",
      status: "ok",
      attempt: 1,
      leaseUntil: new Date(0),
      notBefore: new Date(0),
      startedAt: null,
      finishedAt: null,
      output: { certified: 2, total: 2 },
      error: null,
    };
    const summary = summarizeRow(row);
    expect(summary).not.toHaveProperty("output");
    expect(summary.summary).toMatchObject({ certified: 2, total: 2 });
    expect(summary.stage).toBe("seal");
  });
});
