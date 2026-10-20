import { describe, expect, it, vi } from "vitest";
import {
  type CreateDeps,
  createBodySchema,
  createDossier,
  MAX_CLAIM,
} from "@/dossier/create";
import type { VisitorId } from "@/platform/visitor";

/**
 * Spec 21 §3, §4 (Budgets), §6.3 — composing a dossier: the body schema, the catalog checks, the
 * budget reserved before anything is written (and given back when the write fails), the audit.
 */

const DOC_A = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const DOC_B = "0b6d1f0e-9a4a-4a3e-8f1e-2b3c4d5e6f70";
const JOB = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const VISITOR = "v_kk6eooepno" as VisitorId;

const parse = (v: unknown) => createBodySchema.safeParse(v);

describe("createBodySchema", () => {
  it("accepts a claim with sources and defaults the mode to standard", () => {
    const r = parse({ claim: "  water is wet  ", sources: ["hn"], documents: [] });
    expect(r.success && r.data).toMatchObject({ claim: "water is wet", mode: "standard" });
  });

  it.each([
    ["an empty claim", { claim: "   ", sources: ["hn"] }],
    ["a claim over 1024 characters", { claim: "x".repeat(MAX_CLAIM + 1), sources: ["hn"] }],
    ["no evidence selected", { claim: "c", sources: [], documents: [] }],
    ["six sources", { claim: "c", sources: ["a", "b", "c", "d", "e", "f"] }],
    ["a repeated source", { claim: "c", sources: ["hn", "hn"] }],
    ["a bad slug", { claim: "c", sources: ["../x"] }],
    ["four documents", { claim: "c", documents: [DOC_A, DOC_B, JOB, "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"].map(sample) }],
    ["a repeated document", { claim: "c", documents: [sample(DOC_A), sample(DOC_A)] }],
    ["an unknown mode", { claim: "c", sources: ["hn"], mode: "yolo" }],
    ["an unknown key", { claim: "c", sources: ["hn"], extra: 1 }],
    ["a non-uuid document", { claim: "c", documents: [sample("nope")] }],
  ])("refuses %s", (_name, body) => {
    expect(parse(body).success).toBe(false);
  });

  it("accepts an upload without a job_id (a deduplicated one) and stores null", async () => {
    const r = parse({ claim: "c", documents: [{ document_id: DOC_A, kind: "upload" }] });
    expect(r.success).toBe(true);
    const d = deps();
    await createDossier(createBodySchema.parse({ claim: "c", documents: [{ document_id: DOC_A, kind: "upload" }] }), ctx, d);
    expect(vi.mocked(d.insert).mock.calls[0]?.[2]?.[0]?.jobId).toBeNull();
  });

  it("accepts documents alone, samples and uploads", () => {
    const r = parse({
      claim: "c",
      documents: [sample(DOC_A), { document_id: DOC_B, kind: "upload", job_id: JOB }],
    });
    expect(r.success).toBe(true);
  });
});

function sample(document_id: string) {
  return { document_id, kind: "sample" as const };
}

function deps(over: Partial<CreateDeps> = {}): CreateDeps {
  return {
    knownSources: vi.fn().mockResolvedValue(new Set(["hn", "arxiv"])),
    knownSamples: vi.fn().mockResolvedValue(new Set([DOC_A])),
    reserve: vi.fn().mockResolvedValue({ ok: true, left: 5 }),
    release: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(undefined),
    audit: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-10-20T10:00:00Z"),
    newId: () => "11111111-1111-4111-8111-111111111111",
    ...over,
  };
}

const input = (over: Record<string, unknown> = {}) =>
  createBodySchema.parse({ claim: "c", sources: ["hn"], documents: [], ...over });
const ctx = { visitor: VISITOR, requestId: "req-1" };

describe("createDossier", () => {
  it("reserves the debate budget, inserts the dossier and audits it", async () => {
    const d = deps();
    const r = await createDossier(input({ documents: [sample(DOC_A)], mode: "rapid" }), ctx, d);
    expect(r).toEqual({
      ok: true,
      dossierId: "11111111-1111-4111-8111-111111111111",
      requestId: "req-1",
    });
    expect(d.reserve).toHaveBeenCalledWith("debate", 1);
    const [row, steps, docs] = vi.mocked(d.insert).mock.calls[0] ?? [];
    expect(row).toMatchObject({
      visitor: VISITOR,
      claim: "c",
      sources: ["hn"],
      mode: "rapid",
      status: "pending",
      requestId: "req-1",
    });
    expect(steps).toHaveLength(8);
    expect(docs).toEqual([{ dossierId: row?.id, documentId: DOC_A, kind: "sample", jobId: null }]);
    expect(d.audit).toHaveBeenCalledWith({
      actor: VISITOR,
      action: "dossier.created",
      entityType: "dossier",
      entityId: "11111111-1111-4111-8111-111111111111",
      service: "bastion",
      requestId: "req-1",
      metadata: { sources: 1, documents: 1, mode: "rapid" },
    });
  });

  it("stores an upload's job id and ignores one sent with a sample", async () => {
    const d = deps();
    await createDossier(
      input({
        sources: [],
        documents: [
          { document_id: DOC_A, kind: "sample", job_id: JOB },
          { document_id: DOC_B, kind: "upload", job_id: JOB },
        ],
      }),
      ctx,
      d,
    );
    const docs = vi.mocked(d.insert).mock.calls[0]?.[2];
    expect(docs?.map((x) => x.jobId)).toEqual([null, JOB]);
  });

  it("refuses an unknown source with 422 before reserving anything", async () => {
    const d = deps();
    const r = await createDossier(input({ sources: ["hn", "nope"] }), ctx, d);
    expect(r).toMatchObject({ ok: false, status: 422, error: "invalid_input" });
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("refuses a sample that inkthread does not list", async () => {
    const d = deps();
    const r = await createDossier(input({ documents: [sample(DOC_B)] }), ctx, d);
    expect(r).toMatchObject({ ok: false, status: 422, error: "invalid_input" });
    expect(d.reserve).not.toHaveBeenCalled();
  });

  it("does not ask for a catalog it does not need", async () => {
    const d = deps();
    await createDossier(input({ sources: [], documents: [{ document_id: DOC_B, kind: "upload", job_id: JOB }] }), ctx, d);
    expect(d.knownSources).not.toHaveBeenCalled();
    expect(d.knownSamples).not.toHaveBeenCalled();
  });

  it("answers 503 when the catalog is unreachable", async () => {
    const d = deps({ knownSources: vi.fn().mockResolvedValue(null) });
    const r = await createDossier(input(), ctx, d);
    expect(r).toMatchObject({ ok: false, status: 503, error: "catalog_unavailable" });
    expect(d.reserve).not.toHaveBeenCalled();
  });

  it("answers 429 budget_exhausted with no rows written", async () => {
    const d = deps({ reserve: vi.fn().mockResolvedValue({ ok: false, left: 0 }) });
    const r = await createDossier(input(), ctx, d);
    expect(r).toMatchObject({ ok: false, status: 429, error: "budget_exhausted" });
    expect(r.ok === false && r.retryAfterS).toBeGreaterThan(0);
    expect(d.insert).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
    expect(d.release).not.toHaveBeenCalled();
  });

  it("releases the budget and rethrows when the insert fails", async () => {
    const d = deps({ insert: vi.fn().mockRejectedValue(new Error("db down")) });
    await expect(createDossier(input(), ctx, d)).rejects.toThrow("db down");
    expect(d.release).toHaveBeenCalledWith("debate", 1);
    expect(d.audit).not.toHaveBeenCalled();
  });
});
