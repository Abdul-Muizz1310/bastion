import { describe, expect, it } from "vitest";
import { inkprintCertificateUrl, receiptView } from "@/features/dossier/receipt-view";
import {
  auditReceiptRow,
  CERT_A,
  CERT_B,
  DEBATE_ID,
  DOC_ID,
  documentRow,
  dossierRow,
  ENVELOPE_ID,
  envelopeReceiptRow,
  evidenceRow,
  passageRow,
  perfReceiptRow,
  REQUEST_ID,
  transcriptFixture,
  transcriptReceipt,
} from "./fixtures";

/**
 * Spec 21 §6.5–6.6: the public receipt, read from what bastion stored. Every payload is parsed, not
 * cast: one that does not parse is shown as unreadable (verification will fail it), never guessed.
 */

function view(over: Partial<Parameters<typeof receiptView>[0]> = {}) {
  return receiptView({
    dossier: dossierRow(),
    evidence: [passageRow(), evidenceRow()],
    documents: [documentRow()],
    receipts: [transcriptReceipt(), perfReceiptRow(), envelopeReceiptRow(), auditReceiptRow()],
    ...over,
  });
}

describe("receiptView: evidence", () => {
  it("anchors each row at e-<key> and links its certificate to inkprint's public page", () => {
    const [passage, web] = view().evidence;
    expect(passage).toMatchObject({
      n: 1,
      key: "d5152b39-p12",
      anchor: "e-d5152b39-p12",
      kind: "passage",
      product: "inkthread",
      certificateId: CERT_A,
      certificateUrl: `https://inkprint-frontend.vercel.app/certificates/${CERT_A}`,
      document: { documentId: DOC_ID, page: 1, title: "uspto-fee-schedule.pdf" },
      link: null,
    });
    expect(web).toMatchObject({
      n: 2,
      kind: "web",
      product: "magpie",
      link: "https://news.ycombinator.com/item?id=41",
      document: null,
      certificateId: CERT_B,
    });
  });

  it("maps each certificate to its evidence key, for the transcript's citations", () => {
    expect(view().certificateKeys.get(CERT_A)).toBe("d5152b39-p12");
    expect(view().certificateKeys.get(CERT_B)).toBe("w-hackernews-41");
  });

  it("never links a URL that is not http(s)", () => {
    const row = evidenceRow({ url: "javascript:alert(1)", locator: { kind: "url", url: "javascript:alert(1)" } });
    expect(view({ evidence: [row] }).evidence[0]?.link).toBeNull();
  });

  it("reads a v1 row (no kind, no locator) from its url column, and an uncertified row has no link", () => {
    const v1 = evidenceRow({ kind: null, product: null, locator: null, excerpt: null, certificateId: null });
    expect(view({ evidence: [v1] }).evidence[0]).toMatchObject({
      kind: null,
      product: "magpie",
      link: "https://news.ycombinator.com/item?id=41",
      certificateId: null,
      certificateUrl: null,
      excerpt: null,
    });
  });

  it("encodes the certificate id it puts in inkprint's URL", () => {
    expect(inkprintCertificateUrl("a/b")).toBe("https://inkprint-frontend.vercel.app/certificates/a%2Fb");
  });
});

describe("receiptView: transcript", () => {
  it("shows the transcript the envelope names, with its rounds", () => {
    const t = view().transcript;
    expect(t.kind).toBe("ok");
    if (t.kind !== "ok") return;
    expect(t.value).toMatchObject({
      debateId: DEBATE_ID,
      hash: transcriptFixture().transcript_hash,
      verdict: "TRUE",
      confidence: 0.82,
      signatureAlg: "Ed25519",
    });
    expect(t.value.rounds).toHaveLength(3);
  });

  it("prefers the envelope's debate over a later transcript, and takes the latest without an envelope", () => {
    const later = transcriptReceipt({
      id: "r-later",
      ref: "11111111-1111-4111-8111-111111111111",
      createdAt: new Date("2026-10-20T11:00:00Z"),
      payload: { ...transcriptFixture(), debate_id: "11111111-1111-4111-8111-111111111111", claim: "later" },
    });
    const withEnvelope = view({ receipts: [transcriptReceipt(), later, envelopeReceiptRow()] }).transcript;
    expect(withEnvelope.kind === "ok" && withEnvelope.value.debateId).toBe(DEBATE_ID);
    const without = view({ receipts: [transcriptReceipt(), later] }).transcript;
    expect(without.kind === "ok" && without.value.claim).toBe("later");
  });

  it("says a stored transcript that does not parse is unreadable", () => {
    const t = view({ receipts: [transcriptReceipt({ payload: { rounds: "nope" } })] }).transcript;
    expect(t.kind).toBe("unreadable");
  });

  it("has none when no debate finished", () => {
    expect(view({ receipts: [] }).transcript.kind).toBe("none");
  });
});

describe("receiptView: perf, envelope, audit, documents", () => {
  it("reads the perf receipt per service, a service that did not answer with why", () => {
    const p = view().perf;
    expect(p.kind).toBe("ok");
    if (p.kind !== "ok") return;
    expect(p.value.hash).toBe("d".repeat(64));
    expect(p.value.services[0]).toMatchObject({ service: "inkprint", error: null });
    expect(p.value.services[0]?.queries[0]?.suggestions[0]?.sql).toMatch(/^CREATE INDEX/);
    expect(p.value.services[1]).toMatchObject({ service: "magpie", queries: [], error: "asleep" });
  });

  it("says a perf payload that does not parse is unreadable", () => {
    expect(view({ receipts: [perfReceiptRow({ payload: { services: 3 } })] }).perf.kind).toBe("unreadable");
  });

  it("reads the envelope: id, signature, manifest hash and the metadata inkprint signed", () => {
    const e = view().envelope;
    expect(e.kind).toBe("ok");
    if (e.kind !== "ok") return;
    expect(e.value).toMatchObject({
      id: ENVELOPE_ID,
      signature: "ZW52ZWxvcGUtc2lnbmF0dXJl",
      manifestHash: "e".repeat(64),
      certificateIds: [CERT_A, CERT_B],
    });
    expect(e.value.metadata).toContainEqual(["request_id", REQUEST_ID]);
    expect(e.value.metadata).toContainEqual(["debate_id", DEBATE_ID]);
  });

  it("reads the audit digest and the events it covers", () => {
    const a = view().audit;
    expect(a).toEqual({
      kind: "ok",
      value: { digest: "8".repeat(64), upToEventId: 420, eventCount: 37, requestId: REQUEST_ID },
    });
  });

  it("groups the document excerpts under their document, by page", () => {
    const [doc] = view().documents;
    expect(doc).toMatchObject({ documentId: DOC_ID, kind: "sample", title: "uspto-fee-schedule.pdf" });
    expect(doc?.excerpts).toEqual([{ key: "d5152b39-p12", page: 1, bbox: [72, 140, 540, 260], title: "Patent fees" }]);
  });

  it("drops an excerpt whose locator does not parse, rather than drawing it anywhere", () => {
    const bad = passageRow({ locator: { kind: "document", documentId: DOC_ID, page: 0, bbox: [1, 2] } });
    expect(view({ evidence: [bad] }).documents[0]?.excerpts).toEqual([]);
  });
});
