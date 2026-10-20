import { describe, expect, it } from "vitest";
import { bundleFilename, receiptsBundle } from "@/dossier/bundle";
import type { Dossier, EvidenceItem } from "@/lib/db/schema";
import { canonicalJson } from "@/platform/canonical-json";
import { dossier } from "./stages/helpers";
import { allReceipts, documents, DOSSIER } from "./verify-golden";

/**
 * The receipts bundle (spec 21 §6.3, §6.5): everything a stranger needs to re-check the dossier
 * without bastion — the dossier's public fields, its evidence, its documents and every receipt with
 * its payload — and nothing about who made it (no visitor, no user).
 */

const AT = new Date("2026-10-20T09:00:00.123Z");

const row = (over: Partial<Dossier> = {}): Dossier =>
  dossier({
    id: DOSSIER.id,
    requestId: DOSSIER.requestId,
    userId: "00000000-0000-4000-8000-0000000000aa",
    visitor: "v_kk6eooepno",
    status: "succeeded",
    verdict: "TRUE",
    confidence: "0.82",
    envelopeId: DOSSIER.id,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });

const evidence: EvidenceItem = {
  id: "e0000000-0000-4000-8000-000000000001",
  dossierId: DOSSIER.id,
  source: "magpie",
  stableId: "w-uspto-0",
  url: "https://example.org/fees",
  title: "Fees",
  certificateId: "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b",
  contentHash: "m0",
  kind: "web",
  product: "magpie",
  locator: { kind: "url", url: "https://example.org/fees" },
  excerpt: "The basic filing fee…",
  inkprintHash: "a".repeat(64),
  createdAt: AT,
};

const bundle = (over: Partial<Dossier> = {}) =>
  receiptsBundle({
    dossier: row(over),
    evidence: [evidence],
    documents: documents(),
    receipts: allReceipts(),
  }) as {
    dossier: Record<string, unknown>;
    evidence: Record<string, unknown>[];
    documents: Record<string, unknown>[];
    receipts: Record<string, unknown>[];
  };

describe("receiptsBundle", () => {
  it("holds the dossier's public fields only", () => {
    expect(bundle().dossier).toEqual({
      id: DOSSIER.id,
      claim: "small entity fees are reduced",
      sources: [],
      mode: "rapid",
      status: "succeeded",
      verdict: "TRUE",
      confidence: 0.82,
      request_id: DOSSIER.requestId,
      envelope_id: DOSSIER.id,
      error: null,
      created_at: "2026-10-20T09:00:00.123Z",
    });
    const text = canonicalJson(
      receiptsBundle({ dossier: row(), evidence: [], documents: [], receipts: [] }),
    );
    expect(text).not.toContain("v_kk6eooepno");
    expect(text).not.toContain("0000000000aa");
  });

  it("writes a dossier without a verdict yet as nulls", () => {
    expect(bundle({ verdict: null, confidence: null, envelopeId: null }).dossier).toMatchObject({
      verdict: null,
      confidence: null,
      envelope_id: null,
    });
  });

  it("holds each evidence item with its locator, excerpt, certificate and hashes", () => {
    expect(bundle().evidence).toEqual([
      {
        id: evidence.id,
        key: "w-uspto-0",
        kind: "web",
        product: "magpie",
        source: "magpie",
        url: "https://example.org/fees",
        title: "Fees",
        locator: { kind: "url", url: "https://example.org/fees" },
        excerpt: "The basic filing fee…",
        certificate_id: evidence.certificateId,
        content_hash: "m0",
        inkprint_hash: "a".repeat(64),
        created_at: "2026-10-20T09:00:00.123Z",
      },
    ]);
  });

  it("holds each document with its graph hash (what the documents check re-fetches)", () => {
    const [doc] = documents();
    expect(bundle().documents).toEqual([
      {
        document_id: doc?.documentId,
        kind: "sample",
        title: null,
        sha256: doc?.sha256,
        graph_hash: doc?.graphHash,
        page_count: 15,
      },
    ]);
  });

  it("holds every receipt with its full payload", () => {
    const receipts = allReceipts();
    expect(bundle().receipts).toEqual(
      receipts.map((r) => ({
        id: r.id,
        kind: r.kind,
        ref: r.ref,
        hash: r.hash,
        signature: r.signature,
        payload: r.payload,
        created_at: r.createdAt.toISOString(),
      })),
    );
  });

  it("is canonical JSON: the same dossier always downloads as the same bytes", () => {
    const a = canonicalJson(
      receiptsBundle({
        dossier: row(),
        evidence: [evidence],
        documents: documents(),
        receipts: allReceipts(),
      }),
    );
    const b = canonicalJson(
      receiptsBundle({
        dossier: row(),
        evidence: [evidence],
        documents: documents(),
        receipts: allReceipts(),
      }),
    );
    expect(a).toBe(b);
  });

  it("names the download after the dossier", () => {
    expect(bundleFilename(DOSSIER.id)).toBe(`dossier-${DOSSIER.id}.receipts.json`);
  });

  it("refuses to name a download after something that is not a dossier id", () => {
    expect(() => bundleFilename('x"; filename="evil')).toThrow(RangeError);
  });
});

describe("receiptsBundle never publishes an internal error's message (review round 1)", () => {
  const SQL = "syntax error at or near \"FROM\" in SELECT password_hash FROM users WHERE id = 7";

  it("reduces the dossier's stage_threw error to its bare code", () => {
    const bundle = receiptsBundle({
      dossier: row({ status: "failed", verdict: null, confidence: null, envelopeId: null, error: `debate: stage_threw: ${SQL}` }),
      evidence: [],
      documents: [],
      receipts: [],
    });
    const json = canonicalJson(bundle);
    expect(json).not.toContain("SELECT");
    expect(json).not.toContain("password_hash");
    expect((bundle as { dossier: { error: string } }).dossier.error).toBe("debate: stage_threw");
  });

  it("keeps a downstream error as recorded", () => {
    const bundle = receiptsBundle({
      dossier: row({ status: "failed", error: "debate: paper-trail.debate: budget_exhausted" }),
      evidence: [],
      documents: [],
      receipts: [],
    });
    expect((bundle as { dossier: { error: string } }).dossier.error).toBe(
      "debate: paper-trail.debate: budget_exhausted",
    );
  });
});

