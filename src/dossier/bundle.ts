import { z } from "zod";
import type { Dossier, DossierDocument, EvidenceItem } from "@/lib/db/schema";
import type { Json } from "@/platform/canonical-json";
import { publicDossierError } from "./public-error";
import type { StoredReceipt } from "./receipts";

/**
 * The receipts bundle (spec 21 §6.3, §6.5), pure: everything a stranger needs to re-check a dossier
 * without bastion — its public fields (claim, verdict, request id), its evidence, its documents
 * (with the graph hashes the documents check re-fetches) and every receipt with its full payload.
 * Who made the dossier (`visitor`, `user_id`) is not in it. Served as canonical JSON, so the same
 * dossier always downloads as the same bytes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = z.json().nullable();

export type BundleInputs = {
  dossier: Dossier;
  evidence: readonly EvidenceItem[];
  documents: readonly DossierDocument[];
  receipts: readonly StoredReceipt[];
};

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
  };
}

/** `dossier-<id>.receipts.json` — only ever for a dossier id, so the header cannot be broken. */
export function bundleFilename(dossierId: string): string {
  if (!UUID.test(dossierId)) throw new RangeError("bundleFilename: not a dossier id");
  return `dossier-${dossierId}.receipts.json`;
}
