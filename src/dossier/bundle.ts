import { z } from "zod";
import type { Dossier, DossierDocument, EvidenceItem } from "@/lib/db/schema";
import type { Json } from "@/platform/canonical-json";
import { publicDossierError } from "./public-error";
import { type AuditEventForDigest, auditDigestRow } from "./receipt-math";
import type { StoredReceipt } from "./receipts";
import { auditBound, envelopeAuditBound } from "./verify";

/**
 * The receipts bundle (spec 21 §6.3, §6.5), pure: everything a stranger needs to re-check a dossier
 * without bastion — its public fields (claim, verdict, request id), its evidence, its documents
 * (with the graph hashes the documents check re-fetches), every receipt with its full payload, and
 * the audit events its digests cover, each as the digest's own row (`[id, action, service,
 * created_at]`), so both audit digests recompute from the download alone. Who made the dossier
 * (`visitor`, `user_id`) is not in it, nor any event's actor or metadata. Served as canonical JSON,
 * so the same dossier always downloads as the same bytes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = z.json().nullable();

export type BundleInputs = {
  dossier: Dossier;
  evidence: readonly EvidenceItem[];
  documents: readonly DossierDocument[];
  receipts: readonly StoredReceipt[];
  /** The request's events up to `bundleAuditBound(receipts)`; any past it are left out. */
  auditEvents: readonly AuditEventForDigest[];
};

/**
 * How far the bundle's audit events reach: the highest event id a stored receipt binds a digest to
 * (the audit receipt's `up_to_event_id`, the envelope's signed `audit_up_to`), or null when no
 * receipt binds one — then the bundle carries no events.
 */
export function bundleAuditBound(receipts: readonly StoredReceipt[]): number | null {
  const bounds = receipts.flatMap((r) => {
    const bound =
      r.kind === "audit" ? auditBound(r) : r.kind === "envelope" ? envelopeAuditBound(r) : null;
    return bound === null ? [] : [bound];
  });
  return bounds.length === 0 ? null : Math.max(...bounds);
}

function auditEventsJson(
  events: readonly AuditEventForDigest[],
  receipts: readonly StoredReceipt[],
): Json {
  const bound = bundleAuditBound(receipts);
  if (bound === null) return [];
  return events
    .filter((e) => e.id <= bound)
    .sort((a, b) => a.id - b.id)
    .map(auditDigestRow);
}

function dossierJson(d: Dossier): Json {
  return {
    id: d.id,
    claim: d.claim,
    sources: [...d.sources],
    mode: d.mode,
    status: d.status,
    verdict: d.verdict,
    confidence: d.confidence === null ? null : Number(d.confidence),
    request_id: d.requestId,
    envelope_id: d.envelopeId,
    // Never an internal error's message (review round 1): only its code.
    error: publicDossierError(d.error),
    created_at: d.createdAt.toISOString(),
  };
}

function evidenceJson(e: EvidenceItem): Json {
  return {
    id: e.id,
    key: e.stableId,
    kind: e.kind,
    product: e.product,
    source: e.source,
    url: e.url,
    title: e.title,
    locator: json.parse(e.locator ?? null),
    excerpt: e.excerpt,
    certificate_id: e.certificateId,
    content_hash: e.contentHash,
    inkprint_hash: e.inkprintHash,
    created_at: e.createdAt.toISOString(),
  };
}

function documentJson(d: DossierDocument): Json {
  return {
    document_id: d.documentId,
    kind: d.kind,
    title: d.title,
    sha256: d.sha256,
    graph_hash: d.graphHash,
    page_count: d.pageCount,
  };
}

function receiptJson(r: StoredReceipt): Json {
  return {
    id: r.id,
    kind: r.kind,
    ref: r.ref,
    hash: r.hash,
    signature: r.signature,
    payload: r.payload,
    created_at: r.createdAt.toISOString(),
  };
}

export function receiptsBundle(i: BundleInputs): Json {
  return {
    dossier: dossierJson(i.dossier),
    evidence: i.evidence.map(evidenceJson),
    documents: i.documents.map(documentJson),
    receipts: i.receipts.map(receiptJson),
    audit_events: auditEventsJson(i.auditEvents, i.receipts),
  };
}

/** `dossier-<id>.receipts.json` — only ever for a dossier id, so the header cannot be broken. */
export function bundleFilename(dossierId: string): string {
  if (!UUID.test(dossierId)) throw new RangeError("bundleFilename: not a dossier id");
  return `dossier-${dossierId}.receipts.json`;
}
