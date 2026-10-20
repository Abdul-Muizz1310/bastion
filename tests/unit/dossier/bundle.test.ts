import { describe, expect, it } from "vitest";
import { bundleAuditBound, bundleFilename, receiptsBundle } from "@/dossier/bundle";
import { auditDigest } from "@/dossier/receipt-math";
import type { StoredReceipt } from "@/dossier/receipts";
import type { Dossier, EvidenceItem } from "@/lib/db/schema";
import { canonicalJson } from "@/platform/canonical-json";
import { sha256Hex } from "@/platform/sha256";
import { dossier } from "./stages/helpers";
import {
  allReceipts,
  auditReceipt,
  DOSSIER,
  documents,
  ENVELOPE_REQUEST,
  EVENTS,
  envelopeReceipt,
  GOLDEN,
  perfReceipt,
} from "./verify-golden";

/**
 * The receipts bundle (spec 21 §6.3, §6.5): everything a stranger needs to re-check the dossier
 * without bastion — the dossier's public fields, its evidence, its documents, every receipt with
 * its payload and the audit events its digests cover — and nothing about who made it (no visitor,
 * no user, no event's actor or metadata).
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
    auditEvents: EVENTS,
  }) as {
    dossier: Record<string, unknown>;
    evidence: Record<string, unknown>[];
    documents: Record<string, unknown>[];
    receipts: Record<string, unknown>[];
    audit_events: unknown[][];
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
      receiptsBundle({ dossier: row(), evidence: [], documents: [], receipts: [], auditEvents: [] }),
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

  it("holds the audit events the digests cover, each exactly the digest's row", () => {
    expect(bundle().audit_events).toEqual(
      EVENTS.filter((e) => e.id <= GOLDEN.recordUpTo).map((e) => [
        e.id,
        e.action,
        e.service,
        e.createdAt.toISOString(),
      ]),
    );
  });

  it("recomputes both audit digests from the bundle alone (the download is all a stranger has)", () => {
    const parsed = JSON.parse(
      canonicalJson(
        receiptsBundle({
          dossier: row(),
          evidence: [evidence],
          documents: documents(),
          receipts: allReceipts(),
          auditEvents: EVENTS,
        }),
      ),
    ) as {
      receipts: { kind: string; hash: string; payload: Record<string, unknown> }[];
      audit_events: [number, string, string | null, string][];
    };
    const rows = parsed.audit_events;
    const asEvents = (upTo: number) =>
      rows
        .filter(([id]) => id <= upTo)
        .map(([id, action, service, at]) => ({ id, action, service, createdAt: new Date(at) }));

    const audit = parsed.receipts.find((r) => r.kind === "audit");
    const upTo = audit?.payload.up_to_event_id as number;
    expect(auditDigest(asEvents(upTo))).toBe(audit?.hash);
    expect(asEvents(upTo)).toHaveLength(audit?.payload.event_count as number);
    // Without bastion's code too: the JCS of the rows themselves, hashed.
    expect(sha256Hex(canonicalJson(rows.filter(([id]) => id <= upTo)))).toBe(audit?.hash);

    const envelope = parsed.receipts.find((r) => r.kind === "envelope");
    const signed = (envelope?.payload.request as typeof ENVELOPE_REQUEST).metadata as Record<string, string>;
    expect(auditDigest(asEvents(Number(signed.audit_up_to)))).toBe(signed.audit_digest_at_envelope);
  });

  it("never ships an event past the highest bound a receipt carries", () => {
    const later = { id: GOLDEN.recordUpTo + 1, action: "dossier.verified", service: "bastion", createdAt: new Date() };
    const rows = bundle().audit_events;
    const withLater = receiptsBundle({
      dossier: row(),
      evidence: [],
      documents: [],
      receipts: allReceipts(),
      auditEvents: [...EVENTS, later],
    }) as { audit_events: unknown[][] };
    expect(withLater.audit_events).toEqual(rows);
  });

  it("carries no events for a dossier with no audit or envelope receipt", () => {
    const b = receiptsBundle({
      dossier: row(),
      evidence: [],
      documents: [],
      receipts: [perfReceipt()],
      auditEvents: EVENTS,
    }) as { audit_events: unknown[] };
    expect(b.audit_events).toEqual([]);
  });

  it("orders the events by id whatever order they arrive in", () => {
    const b = receiptsBundle({
      dossier: row(),
      evidence: [],
      documents: [],
      receipts: allReceipts(),
      auditEvents: [...EVENTS].reverse(),
    }) as { audit_events: [number][] };
    expect(b.audit_events.map(([id]) => id)).toEqual(
      EVENTS.filter((e) => e.id <= GOLDEN.recordUpTo).map((e) => e.id),
    );
  });

  it("is canonical JSON: the same dossier always downloads as the same bytes", () => {
    const a = canonicalJson(
      receiptsBundle({
        dossier: row(),
        evidence: [evidence],
        documents: documents(),
        receipts: allReceipts(),
        auditEvents: EVENTS,
      }),
    );
    const b = canonicalJson(
      receiptsBundle({
        dossier: row(),
        evidence: [evidence],
        documents: documents(),
        receipts: allReceipts(),
        auditEvents: EVENTS,
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

describe("bundleAuditBound — how far the bundle's audit events reach", () => {
  const withPayload = (r: StoredReceipt, payload: StoredReceipt["payload"]): StoredReceipt => ({
    ...r,
    payload,
  });

  it("is the audit receipt's bound when the record stage ran", () => {
    expect(bundleAuditBound(allReceipts())).toBe(GOLDEN.recordUpTo);
  });

  it("is the envelope's signed bound when the dossier failed after sealing", () => {
    expect(bundleAuditBound([perfReceipt(), envelopeReceipt()])).toBe(GOLDEN.envelopeUpTo);
  });

  it("is the higher of the two, whichever order the receipts come in", () => {
    expect(bundleAuditBound([auditReceipt(), envelopeReceipt()])).toBe(GOLDEN.recordUpTo);
    expect(bundleAuditBound([envelopeReceipt(), auditReceipt()])).toBe(GOLDEN.recordUpTo);
  });

  it("is null with neither receipt, or with neither payload readable", () => {
    expect(bundleAuditBound([])).toBeNull();
    expect(bundleAuditBound([perfReceipt()])).toBeNull();
    expect(
      bundleAuditBound([withPayload(auditReceipt(), { up_to: 3 }), withPayload(envelopeReceipt(), null)]),
    ).toBeNull();
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
      auditEvents: [],
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
      auditEvents: [],
    });
    expect((bundle as { dossier: { error: string } }).dossier.error).toBe(
      "debate: paper-trail.debate: budget_exhausted",
    );
  });
});

