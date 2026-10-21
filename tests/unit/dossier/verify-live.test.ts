import { describe, expect, it, vi } from "vitest";
import type { StoredReceipt } from "@/dossier/receipts";
import { STAGES } from "@/dossier/stages";
import { CHECK_NAMES } from "@/dossier/verify";
import { dossierVerifier, type VerifyDeps } from "@/dossier/verify-live";
import type { DossierDocument, EvidenceItem } from "@/lib/db/schema";
import type { CallContext } from "@/platform/gateway/call";
import type { GatewayResult } from "@/platform/gateway/result";
import {
  allReceipts,
  DOSSIER,
  documents,
  edit,
  evidenceRows,
  eventsUpTo,
  failed,
  GOLDEN,
  GRAPH,
  ok,
  publicKeyBody,
  RECEIPT_KEY,
  TRANSCRIPT,
  verifyAllValid,
} from "./verify-golden";

/**
 * The verify shell (spec 21 §6.5): it reads the dossier's receipts and documents, asks each issuer
 * once — every certificate in one batch, each transcript, each key, each read document's graph —
 * in parallel, under the visitor's own call context, and hands the answers to the pure checks.
 * Nothing it computes is written anywhere.
 */

const CTX: CallContext = {
  actor: "v_kk6eooepno" as CallContext["actor"],
  requestId: "req-verify-1",
  clientIp: "203.0.113.9",
};

type Steps = Parameters<ReturnType<typeof dossierVerifier>>[2];
/** Every stage ran ok: the runner's rows for the golden (succeeded) dossier. */
const ALL_OK: Steps = STAGES.map((stage) => ({ stage, status: "ok" as const }));
const failedAt = (stage: (typeof STAGES)[number]): Steps =>
  STAGES.map((s, i) => ({
    stage: s,
    status:
      i < STAGES.indexOf(stage)
        ? ("ok" as const)
        : s === stage
          ? ("error" as const)
          : ("pending" as const),
  }));

/** A dossier still running: it implies no envelope, perf or audit receipt, and shows no verdict. */
const UNFINISHED = {
  ...DOSSIER,
  status: "running" as const,
  verdict: null,
  confidence: null,
  envelopeId: null,
};

function fakes(
  over: Partial<VerifyDeps> & {
    stored?: StoredReceipt[];
    rows?: EvidenceItem[];
    docs?: DossierDocument[];
  } = {},
) {
  const { stored, rows, docs, ...deps } = over;
  const all = {
    receipts: vi.fn(async (_id: string) => stored ?? allReceipts()),
    evidence: vi.fn(async (_id: string) => rows ?? evidenceRows()),
    documents: vi.fn(async (_id: string) => docs ?? documents()),
    events: vi.fn(async (_requestId: string, upTo: number) => eventsUpTo(upTo)),
    verifyBatch: vi.fn(async () => ok(verifyAllValid())),
    transcript: vi.fn(async () => ok(structuredClone(TRANSCRIPT))),
    receiptKey: vi.fn(async () => ok(RECEIPT_KEY)),
    publicKey: vi.fn(async () => ok(publicKeyBody())),
    graph: vi.fn(async () => ok(GRAPH)),
    ...deps,
  } satisfies VerifyDeps;
  const verifier = dossierVerifier(all);
  type Row = Parameters<typeof verifier>[0];
  /** The raw answer: legacy, or the checks. */
  const run = (dossier: Row, ctx: CallContext, steps: Steps = ALL_OK) =>
    verifier(dossier, ctx, steps);
  return {
    deps: all,
    run,
    /** The checks of a dossier that is not legacy. */
    verify: async (dossier: Row, ctx: CallContext, steps: Steps = ALL_OK) => {
      const answer = await run(dossier, ctx, steps);
      if (answer.legacy) throw new Error("unexpectedly legacy");
      return answer.checks;
    },
  };
}

describe("verifyDossier", () => {
  it("re-checks every receipt of a really signed dossier: six checks, all pass", async () => {
    const { verify } = fakes();
    const checks = await verify(DOSSIER, CTX);
    expect(checks.map((c) => [c.name, c.state])).toEqual(CHECK_NAMES.map((n) => [n, "pass"]));
  });

  it("asks each issuer once, with the stored ids and texts, under the visitor's context", async () => {
    const { verify, deps } = fakes();
    await verify(DOSSIER, CTX);
    expect(deps.receipts).toHaveBeenCalledWith(DOSSIER.id);
    // By id only: no text, so inkprint re-embeds nothing; the text is bound exactly here.
    expect(deps.verifyBatch).toHaveBeenCalledExactlyOnceWith(CTX, {
      items: GOLDEN.certificates.map((c) => ({ certificate_id: c.id })),
    });
    expect(deps.evidence).toHaveBeenCalledWith(DOSSIER.id);
    expect(deps.transcript).toHaveBeenCalledExactlyOnceWith(CTX, TRANSCRIPT.debate_id);
    expect(deps.receiptKey).toHaveBeenCalledExactlyOnceWith(CTX);
    expect(deps.publicKey).toHaveBeenCalledExactlyOnceWith(CTX);
    expect(deps.graph).toHaveBeenCalledExactlyOnceWith(CTX, GOLDEN.documents[0]?.documentId);
  });

  it("recomputes the audit digests over exactly the stored bounds", async () => {
    const { verify, deps } = fakes();
    await verify(DOSSIER, CTX);
    expect(
      vi
        .mocked(deps.events)
        .mock.calls.map((c) => c.slice(0, 2))
        .sort(),
    ).toEqual(
      [
        [DOSSIER.requestId, GOLDEN.envelopeUpTo],
        [DOSSIER.requestId, GOLDEN.recordUpTo],
      ].sort(),
    );
  });

  it("asks nobody for a dossier with no receipts and no documents", async () => {
    const { verify, deps } = fakes({ stored: [], rows: [], docs: [] });
    // Only the runner's own rows are left to check.
    expect((await verify(UNFINISHED, CTX)).map((c) => [c.name, c.state])).toEqual([
      ["steps", "pass"],
    ]);
    for (const call of [
      deps.verifyBatch,
      deps.transcript,
      deps.receiptKey,
      deps.publicKey,
      deps.graph,
      deps.events,
    ]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it("reports only the checks the dossier has receipts for, in a fixed order", async () => {
    const stored = allReceipts().filter((r) => r.kind === "certificate" || r.kind === "perf");
    const { verify, deps } = fakes({ stored, docs: [] });
    const checks = await verify(UNFINISHED, CTX);
    expect(checks.map((c) => [c.name, c.state])).toEqual([
      ["certificates", "pass"],
      // Ruling AA: certified evidence implies an envelope; a running dossier has none yet.
      ["envelope", "unavailable"],
      ["perf", "pass"],
      ["steps", "pass"],
    ]);
    expect(deps.receiptKey).not.toHaveBeenCalled();
    // inkprint's key is fetched for the certificates even without an envelope.
    expect(deps.publicKey).toHaveBeenCalledExactlyOnceWith(CTX);
  });

  it("an issuer that is out makes its checks unavailable, never pass, and leaves the rest alone", async () => {
    const asleep = failed("asleep", 504);
    const { verify } = fakes({
      transcript: vi.fn(async () => asleep),
      graph: vi.fn(async () => asleep),
    });
    const states = Object.fromEntries((await verify(DOSSIER, CTX)).map((c) => [c.name, c.state]));
    expect(states).toEqual({
      certificates: "pass",
      transcript: "unavailable",
      envelope: "pass",
      perf: "pass",
      audit: "pass",
      documents: "unavailable",
      steps: "pass",
    });
  });

  it("an expired upload is reported as expired (Review focus #5)", async () => {
    const docs = documents().map((d) => ({ ...d, kind: "upload" as const }));
    const gone: GatewayResult<never> = failed("downstream_error", 404, { detail: "not found" });
    const { verify } = fakes({ docs, graph: vi.fn(async () => gone) });
    const checks = await verify(DOSSIER, CTX);
    expect(checks.find((c) => c.name === "documents")?.state).toBe("expired");
  });

  it("a tampered transcript fails, while everything else still passes", async () => {
    const stored = allReceipts().map((r) =>
      r.kind === "transcript" ? edit(r, ["payload", "verdict"], "FALSE") : r,
    );
    const { verify } = fakes({ stored });
    const checks = await verify(DOSSIER, CTX);
    expect(checks.find((c) => c.name === "transcript")?.state).toBe("fail");
    expect(checks.find((c) => c.name === "envelope")?.state).toBe("pass");
  });

  it("does not fetch a transcript for a receipt that names no debate (it fails)", async () => {
    const stored = allReceipts().map((r) => (r.kind === "transcript" ? { ...r, ref: null } : r));
    const { verify, deps } = fakes({ stored });
    const checks = await verify(DOSSIER, CTX);
    expect(deps.transcript).not.toHaveBeenCalled();
    expect(checks.find((c) => c.name === "transcript")?.state).toBe("fail");
  });

  it("a one-word edit of a certified text fails though inkprint answers valid:true", async () => {
    const edited = (GOLDEN.certificates[0]?.text ?? "").replace("pay", "do not pay");
    const stored = allReceipts().map((r, i) =>
      r.kind === "certificate" && i === 0 ? edit(r, ["payload", "text"], edited) : r,
    );
    const rows = edit(evidenceRows(), [0, "excerpt"], null);
    const { verify } = fakes({ stored, rows });
    const checks = await verify(DOSSIER, CTX);
    expect(checks.find((c) => c.name === "certificates")?.state).toBe("fail");
  });

  it("a verdict edited on the dossier row fails the transcript check", async () => {
    const { verify } = fakes();
    const checks = await verify({ ...DOSSIER, verdict: "FALSE" }, CTX);
    expect(checks.find((c) => c.name === "transcript")?.state).toBe("fail");
  });

  it("the envelope's audit digest counts only once the envelope verified", async () => {
    const { verify } = fakes({ publicKey: vi.fn(async () => failed("asleep", 504)) });
    const states = Object.fromEntries((await verify(DOSSIER, CTX)).map((c) => [c.name, c.state]));
    expect(states).toMatchObject({ envelope: "unavailable", audit: "unavailable" });
  });

  describe("a failed dossier without an envelope is judged by its envelope step (Ruling AB)", () => {
    const failedRow = { ...DOSSIER, status: "failed" as const, envelopeId: null };
    const stored = () => allReceipts().filter((r) => r.kind !== "envelope");

    it("failed before sealing (the debate stage errored): unavailable", async () => {
      const { verify } = fakes({ stored: stored() });
      const checks = await verify(failedRow, CTX, failedAt("debate"));
      expect(checks.find((c) => c.name === "envelope")).toMatchObject({
        state: "unavailable",
        detail: "the dossier failed before sealing",
      });
    });

    it("the envelope step ok but no envelope receipt: fail", async () => {
      const { verify } = fakes({ stored: stored() });
      const checks = await verify(failedRow, CTX, failedAt("record"));
      expect(checks.find((c) => c.name === "envelope")?.state).toBe("fail");
    });
  });

  it("does not ask inkprint when the dossier certified nothing", async () => {
    const stored = allReceipts().filter((r) => r.kind !== "certificate");
    const rows = evidenceRows().map((e) => ({ ...e, certificateId: null }));
    const { verify, deps } = fakes({ stored, rows });
    const checks = await verify(DOSSIER, CTX);
    expect(deps.verifyBatch).not.toHaveBeenCalled();
    expect(checks.find((c) => c.name === "certificates")).toBeUndefined();
  });

  it("reads no events for a receipt whose bound is unreadable (the audit check fails)", async () => {
    const stored = allReceipts().map((r) => (r.kind === "audit" ? { ...r, payload: { x: 1 } } : r));
    const { verify, deps } = fakes({ stored });
    const checks = await verify(DOSSIER, CTX);
    expect(deps.events).toHaveBeenCalledTimes(1);
    expect(checks.find((c) => c.name === "audit")?.state).toBe("fail");
  });

  it("checks inkthread only for documents that were read", async () => {
    const docs = [
      ...documents(),
      { ...documents()[0], documentId: "unread", graphHash: null } as DossierDocument,
    ];
    const { verify, deps } = fakes({ docs });
    await verify(DOSSIER, CTX);
    expect(deps.graph).toHaveBeenCalledTimes(1);
  });

  describe("legacy dossiers (amended Ruling Z)", () => {
    const v1 = {
      ...UNFINISHED,
      status: "succeeded" as const,
      visitor: null,
      verdict: "TRUE" as const,
    };

    it("a row with no step rows, no receipts and no visitor is legacy: no issuer is asked", async () => {
      const { run, deps } = fakes({ stored: [], rows: [], docs: [] });
      expect(await run(v1, CTX, [])).toEqual({ legacy: true });
      for (const call of [
        deps.verifyBatch,
        deps.transcript,
        deps.publicKey,
        deps.graph,
        deps.events,
      ]) {
        expect(call).not.toHaveBeenCalled();
      }
    });

    it("a v2 dossier whose step rows were deleted is not legacy: every check runs, steps fails", async () => {
      const { run } = fakes();
      const answer = await run(DOSSIER, CTX, []);
      if (answer.legacy) throw new Error("must not be legacy");
      const states = Object.fromEntries(answer.checks.map((c) => [c.name, c.state]));
      expect(states).toMatchObject({ certificates: "pass", transcript: "pass", steps: "fail" });
      expect(answer.checks.find((c) => c.name === "steps")?.detail).toBe(
        "receipts but no step rows",
      );
    });

    it("a row with a visitor but no step rows and no receipts is not legacy either", async () => {
      const { run } = fakes({ stored: [], rows: [], docs: [] });
      const answer = await run({ ...v1, visitor: "v_kk6eooepno" }, CTX, []);
      expect(answer.legacy).toBe(false);
    });
  });

  it("parses the row's status: an unknown one fails the receipts it cannot tell are owed", async () => {
    const { verify } = fakes({ stored: [], rows: [], docs: [] });
    const row = { ...UNFINISHED, status: "archived" as never };
    const checks = await verify(row, CTX);
    const failed = checks.filter((c) => c.state === "fail").map((c) => c.name);
    expect(failed).toEqual(["transcript", "perf", "audit"]);
    for (const c of checks.filter((x) => x.state === "fail")) {
      expect(c.detail).toContain("unknown dossier status");
    }
  });

  it("lets bastion's own failures (the database) propagate", async () => {
    const { verify } = fakes({ receipts: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(verify(DOSSIER, CTX)).rejects.toThrow("db down");
  });
});
