import { describe, expect, it } from "vitest";
import {
  onePerStage,
  sortByStage,
  stepFingerprint,
  stepNote,
  stepView,
} from "@/features/dossier/step-view";
import { stepRow, viewsAt } from "./fixtures";

/**
 * Spec 21 §6.6, "The live run": what a `step` event (and the page's first render) carries for one
 * `dossier_steps` row — never the row's output, only a one-line note about it.
 */

const LEASE = new Date("2026-10-20T10:04:30.000Z");
const NEXT = new Date("2026-10-20T10:00:03.000Z");

describe("stepView", () => {
  it("carries not_before as nextAt for a waiting row, and no lease once it is released", () => {
    const v = stepView(
      stepRow("debate", {
        status: "waiting",
        attempt: 1,
        notBefore: NEXT,
        finishedAt: null,
        output: { debateId: "889d7f2b-33c0-432a-b956-8a360f7b9497", failedDebateIds: [] },
      }),
    );
    expect(v).toMatchObject({
      stage: "debate",
      status: "waiting",
      attempt: 1,
      nextAt: NEXT.toISOString(),
      leaseUntil: null,
      error: null,
      finishedAt: null,
      note: "debate 889d7f2b is running",
    });
  });

  it("carries not_before as nextAt for a pending row (a retry's backoff or a timed-out stage's floor)", () => {
    const v = stepView(
      stepRow("seal", { status: "pending", attempt: 1, notBefore: NEXT, error: "stage_timeout: x" }),
    );
    expect(v.nextAt).toBe(NEXT.toISOString());
    expect(v.error).toBe("stage_timeout: x");
  });

  it("carries the lease of a running row and no nextAt", () => {
    const v = stepView(stepRow("gather", { status: "running", leaseUntil: LEASE, finishedAt: null }));
    expect(v.leaseUntil).toBe(LEASE.toISOString());
    expect(v.nextAt).toBeNull();
    expect(v.note).toBeNull();
  });

  it.each(["ok", "skipped", "error"] as const)("has no nextAt for a settled (%s) row", (status) => {
    expect(stepView(stepRow("seal", { status, notBefore: NEXT })).nextAt).toBeNull();
  });

  it.each([
    ["stage_threw: connect ECONNREFUSED 10.0.0.7:5432 password=hunter2", "stage_threw"],
    ["invalid_outcome: retryInMs must be a whole number of ms in 0..270000", "invalid_outcome"],
  ])("publishes an internal error as its bare code, never the exception's message (%s)", (raw, code) => {
    const v = stepView(stepRow("seal", { status: "error", error: raw }));
    expect(v.error).toBe(code);
    expect(JSON.stringify(v)).not.toContain(raw.slice(code.length + 2));
  });

  it("keeps a downstream error as recorded (its code and the gateway's own detail)", () => {
    const v = stepView(stepRow("seal", { status: "error", error: "inkprint.certifyBatch: downstream_error (422)" }));
    expect(v.error).toBe("inkprint.certifyBatch: downstream_error (422)");
  });

  it("never carries the output itself (gather's candidates hold whole pages)", () => {
    const big = Array.from({ length: 3 }, (_, i) => ({ key: `w-${i}`, text: "x".repeat(10_000) }));
    const v = stepView(stepRow("gather", { output: big }));
    expect(JSON.stringify(v).length).toBeLessThan(1_000);
    expect(v.note).toBe("3 web candidates");
  });
});

describe("stepNote", () => {
  it.each([
    ["gather", { reason: "no_sources" }, "no web sources were picked"],
    ["read", { reason: "no_documents" }, "no documents were picked"],
    ["seal", { reason: "no_evidence" }, "no evidence to seal"],
    ["envelope", { reason: "no_transcript" }, "no debate ran, so there is nothing to seal"],
    ["envelope", { reason: "no_certificates" }, "nothing was certified, so there is no envelope"],
    ["envelope", { reason: "something_new" }, "skipped: something_new"],
    ["envelope", {}, "skipped"],
  ] as const)("says why %s was skipped (%j)", (stage, output, note) => {
    expect(stepNote(stage, "skipped", output)).toBe(note);
  });

  it("names what wake is waiting for, and what came up", () => {
    expect(stepNote("wake", "waiting", { live: ["inkprint"], asleep: ["magpie", "paper-trail"] })).toBe(
      "waiting for magpie, paper-trail to wake",
    );
    expect(stepNote("wake", "ok", { live: ["inkprint", "paper-trail"] })).toBe(
      "live: inkprint, paper-trail",
    );
  });

  it("summarises what each stage produced", () => {
    expect(stepNote("gather", "ok", [{}])).toBe("1 web candidate");
    expect(stepNote("read", "ok", [{}, {}])).toBe("2 passages and tables");
    expect(stepNote("read", "waiting", { docs: {} })).toBe("waiting for inkthread to finish reading");
    expect(stepNote("seal", "ok", { certified: 4, total: 5 })).toBe("certified 4 of 5");
    expect(stepNote("debate", "ok", { verdict: "TRUE", confidence: 0.82 })).toBe(
      "true · 82% confidence",
    );
    expect(stepNote("measure", "ok", { perfReceiptHash: "abcdef0123456789", auditUpTo: 3 })).toBe(
      "perf receipt abcdef01",
    );
    expect(stepNote("envelope", "ok", { envelopeId: "3e4f5a6b-7c8d" })).toBe("envelope 3e4f5a6b");
    expect(stepNote("record", "ok", { auditDigest: "8888888899999999" })).toBe(
      "audit digest 88888888",
    );
  });

  it("says nothing it cannot read (an output in an unexpected shape)", () => {
    expect(stepNote("seal", "ok", { certified: "four" })).toBeNull();
    expect(stepNote("debate", "waiting", { debateId: 7 })).toBeNull();
    expect(stepNote("wake", "waiting", "asleep")).toBe("waiting for the services to wake");
    expect(stepNote("seal", "running", {})).toBeNull();
    expect(stepNote("seal", "pending", {})).toBeNull();
    expect(stepNote("seal", "error", {})).toBeNull();
  });
});

describe("stepFingerprint", () => {
  const base = stepView(stepRow("debate", { status: "waiting", notBefore: NEXT, finishedAt: null }));

  it("is the same for the same row", () => {
    expect(stepFingerprint(base)).toBe(stepFingerprint({ ...base }));
  });

  it.each([
    ["status", { status: "running" as const }],
    ["attempt", { attempt: 2 }],
    ["error", { error: "boom" }],
    ["nextAt", { nextAt: "2026-10-20T10:00:06.000Z" }],
    ["leaseUntil", { leaseUntil: LEASE.toISOString() }],
    ["note", { note: "something else" }],
  ])("changes when its %s changes", (_what, change) => {
    expect(stepFingerprint({ ...base, ...change })).not.toBe(stepFingerprint(base));
  });
});

describe("sortByStage and onePerStage", () => {
  it("puts views in stage order, whatever order they came in", () => {
    const views = viewsAt("seal", "running");
    expect(sortByStage([...views].reverse()).map((v) => v.stage)).toEqual(views.map((v) => v.stage));
  });

  it("knows exactly one view per stage from a missing or a doubled one", () => {
    const views = viewsAt("seal", "running");
    expect(onePerStage(views)).toBe(true);
    expect(onePerStage(views.slice(1))).toBe(false);
    expect(onePerStage([...views.slice(1), views[1] ?? views[0]!])).toBe(false);
    expect(onePerStage([])).toBe(false);
  });
});
