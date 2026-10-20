import { describe, expect, it, vi } from "vitest";
import { inkprint } from "@/capabilities/inkprint";
import type { SealedRecord } from "@/dossier/evidence";
import type { Candidate } from "@/dossier/select-evidence";
import { MAX_SEALED, sealStage } from "@/dossier/stages/seal";
import type { GatewayResult } from "@/platform/gateway/result";
import type { EvidenceItem } from "@/lib/db/schema";
import { dossier, fixture, stageCtx } from "./helpers";

type Batch = ReturnType<typeof inkprint.certifyBatch.output.parse>;
type Items = Array<{ text: string; author: string; metadata?: Record<string, string> }>;

const fixtureBatch = (): Batch =>
  inkprint.certifyBatch.output.parse(fixture("inkprint", "certificates-batch.json"));
const okBatch = (n: number): GatewayResult<Batch> => {
  const base = fixtureBatch().certificates[0];
  if (!base) throw new Error("fixture");
  const certificates = Array.from({ length: n }, (_, i) => ({
    ...base,
    certificate_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    fingerprints: { ...base.fingerprints, sha256: String(i).padStart(64, "0") },
  }));
  return { ok: true, data: { certificates }, status: 200, requestId: "r", ms: 1 };
};

const cand = (n: number): Candidate => ({
  key: `w-s-${String(n).padStart(2, "0")}`,
  kind: "web",
  product: "magpie",
  title: `fee ${n}`,
  url: `https://example.org/${n}`,
  text: `small entity fees are reduced ${n}`,
  locator: { kind: "url", url: `https://example.org/${n}` },
});
const many = (n: number) => Array.from({ length: n }, (_, i) => cand(i));

function setup(opts: { existing?: Array<Partial<EvidenceItem>>; certify?: ReturnType<typeof vi.fn> } = {}) {
  const certify =
    opts.certify ?? vi.fn(async (_c: unknown, items: Items) => okBatch(items.length));
  const saved: SealedRecord[][] = [];
  const stage = sealStage({
    certifyBatch: certify as never,
    list: async () => (opts.existing ?? []) as EvidenceItem[],
    save: async (_id, recs) => {
      saved.push([...recs]);
      return recs.length;
    },
  });
  return { certify, saved, stage };
}

const ctxWith = (gather: Candidate[] | undefined, read?: Candidate[]) =>
  stageCtx({
    dossier: dossier({ claim: "small entity fees are reduced" }),
    outputs: {
      ...(gather ? { gather: gather as never } : {}),
      ...(read ? { read: read as never } : {}),
    },
  });

describe("seal stage", () => {
  it("is skipped when neither gather nor read produced a candidate", async () => {
    const { stage, certify } = setup();
    expect(await stage(ctxWith(undefined))).toEqual({ kind: "skipped", reason: "no_evidence" });
    expect(await stage(ctxWith([], []))).toEqual({ kind: "skipped", reason: "no_evidence" });
    expect(certify).not.toHaveBeenCalled();
  });

  it("never certifies more than 12 candidates", async () => {
    const { stage, certify } = setup();
    const out = await stage(ctxWith(many(20), many(5).map((c) => ({ ...c, key: `p-${c.key}`, text: `other ${c.key}` }))));
    expect(out.kind).toBe("ok");
    expect(certify.mock.calls[0]?.[1]).toHaveLength(MAX_SEALED);
    expect(MAX_SEALED).toBe(12);
  });

  it("sends author bastion and all-string metadata", async () => {
    const { stage, certify } = setup();
    await stage(ctxWith([cand(1)]));
    const items = certify.mock.calls[0]?.[1] as Items;
    expect(items[0]).toEqual({
      text: "small entity fees are reduced 1",
      author: "bastion",
      metadata: {
        dossier_id: "550e8400-e29b-41d4-a716-446655440000",
        source: "magpie",
        kind: "web",
        key: "w-s-01",
        url: "https://example.org/1",
      },
    });
    expect(inkprint.certifyBatch.input.safeParse({ items }).success).toBe(true);
  });

  it("persists one record per certificate with the signature from the manifest", async () => {
    const { stage, saved } = setup();
    const out = await stage(ctxWith(many(2)));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toHaveLength(2);
    const first = saved[0]?.[0];
    expect(first).toMatchObject({
      certificateId: "00000000-0000-4000-8000-000000000000",
      contentHash: "0".repeat(64),
      text: first?.candidate.text,
    });
    expect(first?.signature).toBe(
      "q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJAA==",
    );
    expect(out).toEqual({ kind: "ok", output: { certified: 2, total: 2 } });
  });

  it("does not re-certify what a previous attempt already stored", async () => {
    const all = many(4);
    const existing = all.slice(0, 3).map((c) => ({ stableId: c.key, certificateId: "cert" }));
    const { stage, certify, saved } = setup({ existing });
    const out = await stage(ctxWith(all));
    const items = certify.mock.calls[0]?.[1] as Items;
    expect(items.map((i) => i.metadata?.key)).toEqual(["w-s-03"]);
    expect(saved[0]).toHaveLength(1);
    expect(out).toEqual({ kind: "ok", output: { certified: 1, total: 4 } });
  });

  it("makes no call at all when everything is already certified", async () => {
    const all = many(3);
    const existing = all.map((c) => ({ stableId: c.key, certificateId: "cert" }));
    const { stage, certify, saved } = setup({ existing });
    const out = await stage(ctxWith(all));
    expect(certify).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(out).toEqual({ kind: "ok", output: { certified: 0, total: 3 } });
  });

  it("counts earlier certificates against the 12 cap even if selection shifted", async () => {
    const all = many(30);
    const existing = Array.from({ length: 10 }, (_, i) => ({ stableId: `old-${i}`, certificateId: "c" }));
    const { stage, certify } = setup({ existing });
    await stage(ctxWith(all));
    expect(certify.mock.calls[0]?.[1]).toHaveLength(2);
  });

  it("does nothing when the cap is already reached", async () => {
    const existing = Array.from({ length: 12 }, (_, i) => ({ stableId: `old-${i}`, certificateId: "c" }));
    const { stage, certify } = setup({ existing });
    const out = await stage(ctxWith(many(30)));
    expect(certify).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "ok", output: { certified: 0, total: 12 } });
  });

  it("ignores stored rows that carry no certificate", async () => {
    const all = many(2);
    const { stage, certify } = setup({ existing: [{ stableId: all[0]?.key, certificateId: null }] });
    await stage(ctxWith(all));
    expect(certify.mock.calls[0]?.[1]).toHaveLength(2);
  });

  it("maps a failed call to a stage error and persists nothing", async () => {
    const certify = vi.fn(async () => ({
      ok: false as const,
      error: "budget_exhausted" as const,
      status: 429,
      requestId: "r",
      ms: 1,
    }));
    const { stage, saved } = setup({ certify });
    const out = await stage(ctxWith(many(2)));
    expect(out).toMatchObject({ kind: "error", retryable: false });
    expect(out.kind === "error" && out.error).toContain("budget_exhausted");
    expect(saved).toHaveLength(0);
  });

  it("refuses a response with the wrong number of certificates", async () => {
    const certify = vi.fn(async () => okBatch(1));
    const { stage, saved } = setup({ certify });
    const out = await stage(ctxWith(many(2)));
    expect(out).toEqual({ kind: "error", error: "seal: expected 2 certificates, got 1", retryable: false });
    expect(saved).toHaveLength(0);
  });

  it("stores a null signature when the manifest carries none", async () => {
    const certify = vi.fn(async () => {
      const r = okBatch(1);
      if (r.ok) r.data.certificates[0] = { ...r.data.certificates[0], manifest: {} } as never;
      return r;
    });
    const { stage, saved } = setup({ certify });
    await stage(ctxWith(many(1)));
    expect(saved[0]?.[0]?.signature).toBeNull();
  });
});
