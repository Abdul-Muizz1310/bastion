import { describe, expect, it, vi } from "vitest";
import { paperTrail } from "@/capabilities/paper-trail";
import type { TranscriptRecord } from "@/dossier/receipts";
import { POLL_MS } from "@/dossier/stages";
import { debateStage, ROUNDS } from "@/dossier/stages/debate";
import type { GatewayResult } from "@/platform/gateway/result";
import { dossier, fixture, stageCtx } from "./helpers";

type Created = ReturnType<typeof paperTrail.debate.output.parse>;
type Got = ReturnType<typeof paperTrail.debateGet.output.parse>;
type Tr = ReturnType<typeof paperTrail.transcript.output.parse>;

const res = <T>(data: T): GatewayResult<T> => ({ ok: true, data, status: 200, requestId: "r", ms: 1 });
const fail = (error: "budget_exhausted" | "downstream_error", status = 500) =>
  ({ ok: false, error, status, requestId: "r", ms: 1 }) as const;

const created = () => paperTrail.debate.output.parse(fixture("paper-trail", "debate-create.json"));
const running = () => paperTrail.debateGet.output.parse(fixture("paper-trail", "debate-running.json"));
const done = () => paperTrail.debateGet.output.parse(fixture("paper-trail", "debate.json"));
const transcript = () => paperTrail.transcript.output.parse(fixture("paper-trail", "transcript.json"));
const DEBATE_ID = created().debate_id;

const sealed = [
  { evidenceId: "e1", certificateId: "00000000-0000-4000-8000-000000000001", url: "https://x.org/a", title: "A", text: "ta" },
  { evidenceId: "e2", certificateId: "00000000-0000-4000-8000-000000000002", url: "", title: "", text: "tb" },
];

function setup(over: {
  start?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  transcript?: ReturnType<typeof vi.fn>;
  items?: typeof sealed;
} = {}) {
  const start = over.start ?? vi.fn(async () => res<Created>(created()));
  const get = over.get ?? vi.fn(async () => res<Got>(done()));
  const tr = over.transcript ?? vi.fn(async () => res<Tr>(transcript()));
  const records: TranscriptRecord[] = [];
  const stage = debateStage(
    {
      start: start as never,
      get: get as never,
      transcript: tr as never,
      sealed: async () => over.items ?? sealed,
      record: async (_id, t) => {
        records.push(t);
      },
    },
    "https://bastion.test",
  );
  return { start, get, tr, records, stage };
}

const first = (mode: "rapid" | "standard" | "adversarial" = "rapid") =>
  stageCtx({ dossier: dossier({ mode, claim: "the claim" }) });
const polling = () =>
  stageCtx({ dossier: dossier({ claim: "the claim" }), outputs: { debate: { debateId: DEBATE_ID } } });

describe("debate stage", () => {
  it("maps modes to rounds", () => {
    expect(ROUNDS).toEqual({ rapid: 1, standard: 2, adversarial: 3 });
  });

  it.each([
    ["rapid", 1],
    ["standard", 2],
    ["adversarial", 3],
  ] as const)("starts a %s debate with %i rounds and a url for every pooled item", async (mode, rounds) => {
    const { stage, start } = setup();
    const out = await stage(first(mode));
    expect(out).toEqual({ kind: "waiting", output: { debateId: DEBATE_ID }, retryInMs: POLL_MS });
    const input = start.mock.calls[0]?.[1];
    expect(input).toMatchObject({ claim: "the claim", max_rounds: rounds });
    expect(input.evidence_pool).toEqual([
      { certificate_id: sealed[0]?.certificateId, url: "https://x.org/a", title: "A", text: "ta" },
      {
        certificate_id: sealed[1]?.certificateId,
        url: "https://bastion.test/d/550e8400-e29b-41d4-a716-446655440000#e-e2",
        title: sealed[1]?.certificateId,
        text: "tb",
      },
    ]);
    expect(paperTrail.debate.input.safeParse(input).success).toBe(true);
  });

  it("omits the evidence pool when nothing was sealed", async () => {
    const { stage, start } = setup({ items: [] });
    await stage(first());
    expect(start.mock.calls[0]?.[1]).toEqual({ claim: "the claim", max_rounds: 1 });
  });

  it("never starts a second debate when one is stored", async () => {
    const { stage, start } = setup({ get: vi.fn(async () => res<Got>(running())) });
    const out = await stage(polling());
    expect(start).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "waiting", output: { debateId: DEBATE_ID }, retryInMs: POLL_MS });
  });

  it("keeps waiting while the debate is pending", async () => {
    const { stage } = setup({ get: vi.fn(async () => res<Got>({ ...running(), status: "pending" })) });
    expect((await stage(polling())).kind).toBe("waiting");
  });

  it("a budget_exhausted start is a non-retryable error with that code", async () => {
    const { stage } = setup({ start: vi.fn(async () => fail("budget_exhausted", 429)) });
    const out = await stage(first());
    expect(out).toMatchObject({ kind: "error", retryable: false });
    expect(out.kind === "error" && out.error).toContain("budget_exhausted");
  });

  it("a transient start failure is retryable", async () => {
    const { stage } = setup({ start: vi.fn(async () => fail("downstream_error", 503)) });
    expect(await stage(first())).toMatchObject({ kind: "error", retryable: true });
  });

  it("a failed debate is a non-retryable error", async () => {
    const { stage, tr, records } = setup({ get: vi.fn(async () => res<Got>({ ...running(), status: "error" })) });
    const out = await stage(polling());
    expect(out).toEqual({ kind: "error", error: `debate_failed: ${DEBATE_ID}`, retryable: false });
    expect(tr).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });

  it("a failed poll maps to a stage error and stores nothing", async () => {
    const { stage, records } = setup({ get: vi.fn(async () => fail("downstream_error", 502)) });
    expect(await stage(polling())).toMatchObject({ kind: "error", retryable: true });
    expect(records).toHaveLength(0);
  });

  it("on done stores the transcript receipt and the verdict from the parsed transcript", async () => {
    const { stage, records, tr } = setup();
    const out = await stage(polling());
    const t = transcript();
    expect(tr.mock.calls[0]?.[1]).toBe(DEBATE_ID);
    expect(records).toEqual([
      {
        debateId: DEBATE_ID,
        transcriptHash: t.transcript_hash,
        signature: t.signature,
        payload: t,
        verdict: t.verdict,
        confidence: t.confidence,
      },
    ]);
    expect(out).toEqual({
      kind: "ok",
      output: { debateId: DEBATE_ID, verdict: t.verdict, confidence: t.confidence },
    });
  });

  it("does not store a verdict when the transcript cannot be fetched", async () => {
    const { stage, records } = setup({ transcript: vi.fn(async () => fail("downstream_error", 500)) });
    expect(await stage(polling())).toMatchObject({ kind: "error", retryable: true });
    expect(records).toHaveLength(0);
  });

  it("treats a stored output without a debate id as no debate", async () => {
    const { stage, start } = setup();
    await stage(stageCtx({ dossier: dossier({ claim: "c" }), outputs: { debate: { nope: 1 } } }));
    expect(start).toHaveBeenCalledOnce();
  });
});
