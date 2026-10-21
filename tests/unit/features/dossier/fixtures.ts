import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Transcript } from "@/capabilities/paper-trail";
import type { StoredReceipt } from "@/dossier/receipts";
import { STAGES, type Stage, type StepRow, type StepStatus } from "@/dossier/stages";
import type { StepView } from "@/features/dossier/step-view";
import type { Dossier, DossierDocument, EvidenceItem } from "@/lib/db/schema";

/** Test-only rows for the dossier pages: a dossier, its steps, evidence, documents and receipts. */

export const DOSSIER_ID = "5b1e0c3a-9d4f-4e2b-8a6c-7f1d2e3c4b5a";
export const REQUEST_ID = "req-5b1e0c3a";
export const CERT_A = "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b";
export const CERT_B = "7c0d1e2f-3a4b-4c5d-8e6f-9a0b1c2d3e4f";
export const CERT_C = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
export const DOC_ID = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
export const DEBATE_ID = "889d7f2b-33c0-432a-b956-8a360f7b9497";
export const ENVELOPE_ID = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";

const EPOCH = new Date(0);
const T0 = new Date("2026-10-20T10:00:00.000Z");

export function dossierRow(over: Partial<Dossier> = {}): Dossier {
  return {
    id: DOSSIER_ID,
    userId: null,
    visitor: "v_kk6eooepno",
    claim: "The USPTO basic filing fee for a utility patent is 350 dollars.",
    sources: ["hackernews"],
    mode: "standard",
    status: "succeeded",
    verdict: "TRUE",
    confidence: "0.82",
    requestId: REQUEST_ID,
    envelopeId: ENVELOPE_ID,
    error: null,
    createdAt: T0,
    updatedAt: new Date("2026-10-20T10:04:00.000Z"),
    ...over,
  };
}

export function stepRow(stage: Stage, over: Partial<StepRow> = {}): StepRow {
  return {
    dossierId: DOSSIER_ID,
    stage,
    status: "ok",
    attempt: 1,
    leaseUntil: EPOCH,
    notBefore: T0,
    startedAt: T0,
    finishedAt: new Date(T0.getTime() + 1_000),
    output: {},
    error: null,
    ...over,
  };
}

/** Eight rows, each ok unless `over` says otherwise. */
export function stepRows(over: Partial<Record<Stage, Partial<StepRow>>> = {}): StepRow[] {
  return STAGES.map((stage) => stepRow(stage, over[stage] ?? {}));
}

export function stepView(stage: Stage, status: StepStatus, over: Partial<StepView> = {}): StepView {
  return {
    stage,
    status,
    attempt: status === "pending" ? 0 : 1,
    error: null,
    nextAt: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    note: null,
    ...over,
  };
}

/** Eight views, ok up to `upTo` (exclusive), then `status` at `upTo`, then pending. */
export function viewsAt(upTo: Stage, status: StepStatus, over: Partial<StepView> = {}): StepView[] {
  const at = STAGES.indexOf(upTo);
  return STAGES.map((stage, i) =>
    i < at
      ? stepView(stage, "ok")
      : i === at
        ? stepView(stage, status, over)
        : stepView(stage, "pending"),
  );
}

export function evidenceRow(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    dossierId: DOSSIER_ID,
    source: "magpie",
    stableId: "w-hackernews-41",
    url: "https://news.ycombinator.com/item?id=41",
    title: "USPTO fees discussed",
    certificateId: CERT_B,
    contentHash: "a".repeat(64),
    kind: "web",
    product: "magpie",
    locator: { kind: "url", url: "https://news.ycombinator.com/item?id=41" },
    excerpt: "The basic filing fee is listed at 350 dollars for large entities.",
    inkprintHash: "b".repeat(64),
    createdAt: T0,
    ...over,
  };
}

export function passageRow(over: Partial<EvidenceItem> = {}): EvidenceItem {
  return evidenceRow({
    id: "e0000000-0000-4000-8000-000000000002",
    source: "inkthread",
    stableId: "d5152b39-p12",
    url: `https://bastion.example/d/${DOSSIER_ID}#e-d5152b39-p12`,
    title: "Patent fees",
    certificateId: CERT_A,
    kind: "passage",
    product: "inkthread",
    locator: {
      kind: "document",
      documentId: DOC_ID,
      sha256: "3".repeat(64),
      page: 1,
      bbox: [72, 140, 540, 260],
      nodeId: "p:12",
    },
    excerpt: "Basic filing fee - Utility 350.00",
    ...over,
  });
}

export function documentRow(over: Partial<DossierDocument> = {}): DossierDocument {
  return {
    dossierId: DOSSIER_ID,
    documentId: DOC_ID,
    sha256: "3".repeat(64),
    title: "uspto-fee-schedule.pdf",
    kind: "sample",
    graphHash: "4".repeat(64),
    pageCount: 15,
    jobId: null,
    ...over,
  };
}

const ROOT = resolve(__dirname, "../../../fixtures/downstream");

export function transcriptFixture(): Transcript {
  return JSON.parse(readFileSync(resolve(ROOT, "paper-trail/transcript.json"), "utf8")) as Transcript;
}

export function receipt(over: Partial<StoredReceipt> & Pick<StoredReceipt, "kind">): StoredReceipt {
  return {
    id: `r-${over.kind}-${over.ref ?? "x"}`,
    ref: null,
    hash: "c".repeat(64),
    signature: null,
    payload: null,
    createdAt: T0,
    ...over,
  };
}

export function transcriptReceipt(over: Partial<StoredReceipt> = {}): StoredReceipt {
  const t = transcriptFixture();
  return receipt({
    kind: "transcript",
    ref: t.debate_id,
    hash: t.transcript_hash,
    signature: t.signature,
    payload: t as unknown as StoredReceipt["payload"],
    ...over,
  });
}

export function perfReceiptRow(over: Partial<StoredReceipt> = {}): StoredReceipt {
  return receipt({
    kind: "perf",
    hash: "d".repeat(64),
    payload: {
      dossier_id: DOSSIER_ID,
      request_id: REQUEST_ID,
      services: [
        {
          service: "inkprint",
          queries: [
            {
              id: "q1",
              fingerprint: "SELECT * FROM certificates WHERE content_hash = ?",
              calls: 3,
              total_ms: 41.5,
              max_ms: 20.1,
              suggestions: [
                {
                  kind: "index",
                  sql: "CREATE INDEX ix_certificates_content_hash ON certificates (content_hash);",
                },
              ],
            },
          ],
        },
        { service: "magpie", queries: [], error: "asleep" },
      ],
    },
    ...over,
  });
}

export function envelopeReceiptRow(over: Partial<StoredReceipt> = {}): StoredReceipt {
  return receipt({
    kind: "envelope",
    ref: ENVELOPE_ID,
    hash: "e".repeat(64),
    signature: "ZW52ZWxvcGUtc2lnbmF0dXJl",
    payload: {
      envelope_id: ENVELOPE_ID,
      envelope_manifest: { "c2pa.hash.data": "f".repeat(64) },
      envelope_signature: "ZW52ZWxvcGUtc2lnbmF0dXJl",
      created_at: "2026-10-20T10:03:30.000Z",
      audit_up_to: 412,
      request: {
        dossier_id: DOSSIER_ID,
        evidence_cert_ids: [CERT_A, CERT_B],
        debate_transcript_hash: transcriptFixture().transcript_hash,
        perf_receipt_hash: "d".repeat(64),
        metadata: {
          request_id: REQUEST_ID,
          audit_digest_at_envelope: "9".repeat(64),
          audit_up_to: "412",
          graph_hashes: "4".repeat(64),
          transcript_signature: transcriptFixture().signature ?? "",
          debate_id: DEBATE_ID,
        },
      },
    },
    ...over,
  });
}

export function auditReceiptRow(over: Partial<StoredReceipt> = {}): StoredReceipt {
  return receipt({
    kind: "audit",
    ref: REQUEST_ID,
    hash: "8".repeat(64),
    payload: { request_id: REQUEST_ID, up_to_event_id: 420, event_count: 37 },
    ...over,
  });
}

export function certificateReceiptRow(certificateId: string, key: string): StoredReceipt {
  return receipt({
    kind: "certificate",
    ref: certificateId,
    hash: "b".repeat(64),
    signature: "c2ln",
    payload: { text: "certified text", key },
  });
}
