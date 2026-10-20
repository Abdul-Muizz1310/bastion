import { describe, expect, it, vi } from "vitest";
import { inkprint } from "@/capabilities/inkprint";
import { auditDigest } from "@/dossier/receipt-math";
import type { EnvelopeReceipt, ReceiptKind, StoredReceipt } from "@/dossier/receipts";
import type { StageContext } from "@/dossier/stages";
import { envelopeStage } from "@/dossier/stages/envelope";
import type { DossierDocument, EvidenceItem } from "@/lib/db/schema";
import { canonicalJson } from "@/platform/canonical-json";
import type { RequestEvent } from "@/platform/audit/request-events";
import type { GatewayResult } from "@/platform/gateway/result";
import { sha256Hex } from "@/platform/sha256";
import { DOSSIER_ID, fixture, stageCtx } from "./helpers";

/**
 * Stage `envelope` (spec 21 §6.1): inkprint signs one envelope binding the dossier's certificates,
 * the transcript hash and the perf receipt hash, with the graph hashes and the audit digest as
 * metadata. Skipped when there is no transcript (or nothing was certified, which inkprint refuses).
 */

type Envelope = ReturnType<typeof inkprint.envelope.output.parse>;
type Input = { dossier_id: string; evidence_cert_ids: string[]; metadata: Record<string, string> };

const REQUEST_ID = "req-dossier-1";
const DEBATE_ID = "889d7f2b-33c0-432a-b956-8a360f7b9497";
const C1 = "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b";
const C3 = "3c0a7b2f-5d4e-4f60-8b8c-9d7e6f5a4b3c";
const AT = new Date("2026-10-20T10:00:00Z");

const envelopeFixture = () => inkprint.envelope.output.parse(fixture("inkprint", "envelope.json"));
const ok = (data: Envelope): GatewayResult<Envelope> => ({
  ok: true,
  data,
  status: 201,
  requestId: "r",
  ms: 1,
});

const receipt = (kind: ReceiptKind, over: Partial<StoredReceipt> = {}): StoredReceipt => ({
  id: `00000000-0000-4000-8000-00000000000${kind.length}`,
  kind,
  ref: null,
  hash: null,
  signature: null,
  payload: null,
  createdAt: AT,
  ...over,
});
const TRANSCRIPT = receipt("transcript", {
  ref: DEBATE_ID,
  hash: "5".repeat(64),
  signature: "tsig==",
});
const PERF = receipt("perf", { ref: REQUEST_ID, hash: "7".repeat(64) });

const item = (stableId: string, certificateId: string | null) =>
  ({ stableId, certificateId }) as EvidenceItem;
const doc = (documentId: string, graphHash: string | null) =>
  ({ documentId, graphHash }) as DossierDocument;

const EVENTS: RequestEvent[] = [
  { id: 3, action: "gateway.call", service: "magpie", createdAt: AT },
  { id: 5, action: "dossier.stage.ok", service: "bastion", createdAt: AT },
  { id: 8, action: "gateway.call", service: "slowquery", createdAt: AT },
  { id: 11, action: "dossier.stage.ok", service: "bastion", createdAt: AT },
];

function setup(
  opts: {
    receipts?: Partial<Record<ReceiptKind, StoredReceipt | null>>;
    evidence?: EvidenceItem[];
    documents?: DossierDocument[];
    answer?: GatewayResult<Envelope>;
  } = {},
) {
  const all = { transcript: TRANSCRIPT, perf: PERF, envelope: null, ...opts.receipts };
  const envelope = vi.fn(
    async (_ctx: unknown, _input: Input) => opts.answer ?? ok(envelopeFixture()),
  );
  const find = vi.fn(async (_id: string, kind: ReceiptKind, ref?: string) => {
    const r = all[kind as keyof typeof all] ?? null;
    return r !== null && ref !== undefined && r.ref !== ref ? null : r;
  });
  const events = vi.fn(async (_requestId: string, upTo?: number) =>
    EVENTS.filter((e) => upTo === undefined || e.id <= upTo),
  );
  const saved: EnvelopeReceipt[] = [];
  const stage = envelopeStage({
    envelope: envelope as never,
    evidence: async () => opts.evidence ?? [item("w-a", C1), item("w-b", null), item("w-c", C3)],
    documents: async () =>
      opts.documents ?? [doc("d2", "b".repeat(64)), doc("d1", "a".repeat(64)), doc("d3", null)],
    receipt: find,
    events,
    save: async (_id, r) => {
      saved.push(r);
      return { ...receipt("envelope"), ...r, kind: "envelope" };
    },
  });
  return { stage, envelope, events, find, saved };
}

const ctx = (outputs: StageContext["outputs"] = {}) =>
  stageCtx({
    outputs: {
      debate: { debateId: DEBATE_ID, verdict: "TRUE", confidence: 0.82, failedDebateIds: [] },
      measure: { perfReceiptHash: "7".repeat(64), auditUpTo: 8 },
      ...outputs,
    },
  });

describe("envelope stage", () => {
  it("sends exactly the stored certificate ids, the stored hashes and string metadata", async () => {
    const { stage, envelope, events } = setup();
    await stage(ctx());
    const input = envelope.mock.calls[0]?.[1];
    expect(events).toHaveBeenCalledWith(REQUEST_ID, 8);
    expect(input).toEqual({
      dossier_id: DOSSIER_ID,
      evidence_cert_ids: [C1, C3],
      debate_transcript_hash: "5".repeat(64),
      perf_receipt_hash: "7".repeat(64),
      metadata: {
        request_id: REQUEST_ID,
        audit_digest_at_envelope: auditDigest(EVENTS.filter((e) => e.id <= 8)),
        audit_up_to: "8",
        graph_hashes: `${"a".repeat(64)},${"b".repeat(64)}`,
        transcript_signature: "tsig==",
        debate_id: DEBATE_ID,
      },
    });
    for (const value of Object.values(input?.metadata ?? {})) expect(typeof value).toBe("string");
    expect(inkprint.envelope.input.safeParse(input).success).toBe(true);
  });

  it("signs the audit digest up to measure's bound, so a retry sends the identical bundle", async () => {
    const { stage, envelope } = setup();
    await stage(ctx());
    await stage(ctx());
    expect(envelope.mock.calls[0]?.[1]).toEqual(envelope.mock.calls[1]?.[1]);
    expect(envelope.mock.calls[0]?.[1].metadata.audit_digest_at_envelope).not.toBe(
      auditDigest(EVENTS),
    );
  });

  it("writes an empty graph_hashes and transcript_signature when there are none", async () => {
    const { stage, envelope } = setup({
      documents: [],
      receipts: { transcript: { ...TRANSCRIPT, signature: null } },
    });
    await stage(ctx());
    expect(envelope.mock.calls[0]?.[1].metadata).toMatchObject({
      graph_hashes: "",
      transcript_signature: "",
    });
  });

  it("stores the envelope receipt and sets the dossier's envelope id through it", async () => {
    const { stage, saved } = setup();
    const out = await stage(ctx());
    const e = envelopeFixture();
    expect(saved).toEqual([
      {
        ref: e.envelope_id,
        hash: sha256Hex(canonicalJson(e.envelope_manifest)),
        signature: e.envelope_signature,
        payload: {
          envelope_id: e.envelope_id,
          envelope_manifest: e.envelope_manifest,
          envelope_signature: e.envelope_signature,
          created_at: e.created_at,
          audit_up_to: 8,
          request: expect.objectContaining({ evidence_cert_ids: [C1, C3] }),
        },
      },
    ]);
    expect(out).toEqual({ kind: "ok", output: { envelopeId: e.envelope_id } });
  });

  it("reuses a stored envelope: no second call", async () => {
    const stored = receipt("envelope", { ref: "e5f6a7b8-c9d0-4e1f-a2b3-c4d5e6f7a8b9" });
    const { stage, envelope, saved } = setup({ receipts: { envelope: stored } });
    expect(await stage(ctx())).toEqual({ kind: "ok", output: { envelopeId: stored.ref } });
    expect(envelope).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it.each([
    ["the debate output has no id", ctx({ debate: { failedDebateIds: [] } }), {}],
    ["there is no debate output", ctx({ debate: null }), {}],
    ["no transcript receipt is stored for the debate", ctx(), { receipts: { transcript: null } }],
    [
      "the stored transcript is another debate's",
      ctx(),
      { receipts: { transcript: { ...TRANSCRIPT, ref: "other" } } },
    ],
  ] as const)("is skipped with no_transcript when %s", async (_why, context, opts) => {
    const { stage, envelope } = setup(opts as never);
    expect(await stage(context)).toEqual({ kind: "skipped", reason: "no_transcript" });
    expect(envelope).not.toHaveBeenCalled();
  });

  it("is skipped with no_certificates when nothing was certified (inkprint needs one)", async () => {
    const { stage, envelope } = setup({ evidence: [item("w-a", null)] });
    expect(await stage(ctx())).toEqual({ kind: "skipped", reason: "no_certificates" });
    expect(envelope).not.toHaveBeenCalled();
  });

  it.each([
    [
      "no perf receipt is stored",
      { receipts: { perf: null } },
      ctx(),
      "envelope: no perf receipt is stored",
    ],
    [
      "the perf receipt has no hash",
      { receipts: { perf: { ...PERF, hash: null } } },
      ctx(),
      "envelope: no perf receipt is stored",
    ],
    [
      "the transcript receipt has no hash",
      { receipts: { transcript: { ...TRANSCRIPT, hash: null } } },
      ctx(),
      "envelope: the transcript receipt has no hash",
    ],
    [
      "measure recorded no audit bound",
      {},
      ctx({ measure: { perfReceiptHash: "7".repeat(64) } }),
      "envelope: measure recorded no audit bound",
    ],
    [
      "measure's audit bound is not an id",
      {},
      ctx({ measure: { auditUpTo: -1 } }),
      "envelope: measure recorded no audit bound",
    ],
    [
      "a stored envelope has no id",
      { receipts: { envelope: receipt("envelope") } },
      ctx(),
      "envelope: the stored envelope has no id",
    ],
  ] as const)("fails non-retryably when %s", async (_why, opts, context, error) => {
    const { stage, envelope } = setup(opts as never);
    expect(await stage(context)).toEqual({ kind: "error", error, retryable: false });
    expect(envelope).not.toHaveBeenCalled();
  });

  it.each([
    ["a conflict (another bundle was signed)", 409, false],
    ["an unknown certificate", 404, false],
    ["a server error", 503, true],
  ] as const)("maps %s to a stage error and stores nothing", async (_what, status, retryable) => {
    const { stage, saved } = setup({
      answer: { ok: false, error: "downstream_error", status, requestId: "r" },
    });
    const out = await stage(ctx());
    expect(out).toMatchObject({ kind: "error", retryable });
    expect(out.kind === "error" && out.error).toContain("inkprint.envelope");
    expect(saved).toHaveLength(0);
  });
});
