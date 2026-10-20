import { z } from "zod";
import { paperTrail } from "@/capabilities/paper-trail";
import type { StoredReceipt } from "@/dossier/receipts";
import type { Dossier, DossierDocument, EvidenceItem } from "@/lib/db/schema";
import { PRODUCTS } from "@/platform/registry/products";
import { evidenceAnchor, httpUrl } from "./citations";

/**
 * The public receipt as a view (spec 21 §6.5, §6.6), read from what bastion stored: the evidence
 * rows, the transcript, the documents with their excerpts, the perf receipt, the envelope and the
 * audit digest. Every stored payload is parsed, never cast — one that does not parse is shown as
 * unreadable (verification will fail it), and nothing is guessed. Pure.
 */

export type Section<T> =
  | { kind: "none" }
  | { kind: "ok"; value: T }
  | { kind: "unreadable"; detail: string };

export type EvidenceRowView = {
  n: number;
  key: string;
  anchor: string;
  kind: "web" | "passage" | "table" | null;
  product: string;
  title: string;
  /** The web page, when it is an http(s) URL. */
  link: string | null;
  document: { documentId: string; page: number; title: string | null } | null;
  excerpt: string | null;
  certificateId: string | null;
  certificateUrl: string | null;
};

export type Excerpt = {
  key: string;
  page: number;
  bbox: [number, number, number, number];
  title: string;
};

export type DocumentView = {
  documentId: string;
  kind: "sample" | "upload";
  title: string | null;
  sha256: string | null;
  graphHash: string | null;
  pageCount: number | null;
  excerpts: Excerpt[];
};

export type TranscriptRound = {
  side: "proponent" | "skeptic" | "judge";
  round: number;
  argument: string;
  citations: { type: "cert" | "url"; ref: string; title: string }[];
};

export type TranscriptReceiptView = {
  debateId: string;
  hash: string;
  signature: string | null;
  signatureAlg: string | null;
  claim: string;
  verdict: "TRUE" | "FALSE" | "INCONCLUSIVE";
  confidence: number;
  rounds: TranscriptRound[];
};

export type PerfQueryView = {
  id: string;
  fingerprint: string;
  calls: number;
  totalMs: number;
  maxMs: number | null;
  suggestions: { kind: string; sql: string | null }[];
};

export type PerfView = {
  hash: string | null;
  services: { service: string; queries: PerfQueryView[]; error: string | null }[];
};

export type EnvelopeView = {
  id: string;
  signature: string | null;
  manifestHash: string | null;
  createdAt: string | null;
  certificateIds: string[];
  transcriptHash: string;
  perfHash: string;
  metadata: [string, string][];
};

export type AuditView = {
  digest: string;
  upToEventId: number;
  eventCount: number;
  requestId: string;
};

export type DossierReceiptView = {
  evidence: EvidenceRowView[];
  /** Certificate id (lower-case) → the evidence key holding it, for the transcript's citations. */
  certificateKeys: ReadonlyMap<string, string>;
  documents: DocumentView[];
  transcript: Section<TranscriptReceiptView>;
  perf: Section<PerfView>;
  envelope: Section<EnvelopeView>;
  audit: Section<AuditView>;
};

export type ReceiptInputs = {
  dossier: Dossier;
  evidence: readonly EvidenceItem[];
  documents: readonly DossierDocument[];
  receipts: readonly StoredReceipt[];
};

const INKPRINT_PAGES =
  PRODUCTS.find((p) => p.id === "inkprint")?.frontendUrl ?? "https://inkprint-frontend.vercel.app";

/** inkprint's public page for a certificate (anyone can check it there without bastion). */
export function inkprintCertificateUrl(certificateId: string): string {
  return `${INKPRINT_PAGES}/certificates/${encodeURIComponent(certificateId)}`;
}

const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const locator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string() }),
  z.object({
    kind: z.literal("document"),
    documentId: z.string().min(1),
    page: z.number().int().min(1),
    bbox,
  }),
]);

function evidenceRow(
  e: EvidenceItem,
  i: number,
  titles: ReadonlyMap<string, string | null>,
): EvidenceRowView {
  const loc = locator.safeParse(e.locator);
  const document =
    loc.success && loc.data.kind === "document"
      ? {
          documentId: loc.data.documentId,
          page: loc.data.page,
          title: titles.get(loc.data.documentId) ?? null,
        }
      : null;
  const url = loc.success && loc.data.kind === "url" ? loc.data.url : document ? null : e.url;
  return {
    n: i + 1,
    key: e.stableId,
    anchor: evidenceAnchor(e.stableId),
    kind: e.kind,
    product: e.product ?? e.source,
    title: e.title,
    link: httpUrl(url),
    document,
    excerpt: e.excerpt,
    certificateId: e.certificateId,
    certificateUrl: e.certificateId === null ? null : inkprintCertificateUrl(e.certificateId),
  };
}

/** A document's excerpts, by page (and by key within a page); a locator that does not parse is dropped. */
function excerptsOf(documentId: string, evidence: readonly EvidenceItem[]): Excerpt[] {
  return evidence
    .flatMap((e) => {
      const loc = locator.safeParse(e.locator);
      if (!loc.success || loc.data.kind !== "document" || loc.data.documentId !== documentId) {
        return [];
      }
      return [{ key: e.stableId, page: loc.data.page, bbox: loc.data.bbox, title: e.title }];
    })
    .sort((a, b) => a.page - b.page || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/* ---- the stored receipts ------------------------------------------------------------------- */

const transcriptPayload = paperTrail.transcript.output;

const envelopePayload = z.object({
  envelope_id: z.string(),
  envelope_signature: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  request: z.object({
    evidence_cert_ids: z.array(z.string()),
    debate_transcript_hash: z.string(),
    perf_receipt_hash: z.string(),
    metadata: z.record(z.string(), z.string()),
  }),
});

const perfPayload = z.object({
  services: z.array(
    z.object({
      service: z.string(),
      queries: z.array(
        z.object({
          id: z.string(),
          fingerprint: z.string(),
          calls: z.number(),
          total_ms: z.number(),
          max_ms: z.number().nullable(),
          suggestions: z.array(z.object({ kind: z.string(), sql: z.string().nullable() })),
        }),
      ),
      error: z.string().optional(),
    }),
  ),
});

const auditPayload = z.object({
  request_id: z.string(),
  up_to_event_id: z.number().int().nonnegative(),
  event_count: z.number().int().nonnegative(),
});

const NONE = { kind: "none" } as const;

function unreadable(what: string): { kind: "unreadable"; detail: string } {
  return {
    kind: "unreadable",
    detail: `the stored ${what} does not parse; verifying the dossier will say what it fails`,
  };
}

function latest(
  receipts: readonly StoredReceipt[],
  kind: StoredReceipt["kind"],
): StoredReceipt | null {
  return receipts.filter((r) => r.kind === kind).at(-1) ?? null;
}

function envelopeSection(r: StoredReceipt | null): Section<EnvelopeView> {
  if (r === null) return NONE;
  const p = envelopePayload.safeParse(r.payload);
  if (!p.success) return unreadable("envelope");
  return {
    kind: "ok",
    value: {
      id: r.ref ?? p.data.envelope_id,
      signature: r.signature ?? p.data.envelope_signature ?? null,
      manifestHash: r.hash,
      createdAt: p.data.created_at ?? null,
      certificateIds: p.data.request.evidence_cert_ids,
      transcriptHash: p.data.request.debate_transcript_hash,
      perfHash: p.data.request.perf_receipt_hash,
      metadata: Object.entries(p.data.request.metadata),
    },
  };
}

/** The transcript the envelope names (spec 21 §6.5), else the latest one stored. */
function transcriptSection(
  receipts: readonly StoredReceipt[],
  envelope: Section<EnvelopeView>,
): Section<TranscriptReceiptView> {
  const named =
    envelope.kind === "ok"
      ? envelope.value.metadata.find(([k]) => k === "debate_id")?.[1]
      : undefined;
  const transcripts = receipts.filter((r) => r.kind === "transcript");
  const r = transcripts.find((t) => named !== undefined && t.ref === named) ?? transcripts.at(-1);
  if (r === undefined) return NONE;
  const p = transcriptPayload.safeParse(r.payload);
  if (!p.success) return unreadable("transcript");
  const t = p.data;
  return {
    kind: "ok",
    value: {
      debateId: t.debate_id,
      hash: r.hash ?? t.transcript_hash,
      signature: r.signature ?? t.signature,
      signatureAlg: t.signature_alg,
      claim: t.claim,
      verdict: t.verdict,
      confidence: t.confidence,
      rounds: t.rounds.map((round) => ({
        side: round.side,
        round: round.round,
        argument: round.argument_md,
        citations: round.citations,
      })),
    },
  };
}

function perfSection(r: StoredReceipt | null): Section<PerfView> {
  if (r === null) return NONE;
  const p = perfPayload.safeParse(r.payload);
  if (!p.success) return unreadable("perf receipt");
  return {
    kind: "ok",
    value: {
      hash: r.hash,
      services: p.data.services.map((s) => ({
        service: s.service,
        error: s.error ?? null,
        queries: s.queries.map((q) => ({
          id: q.id,
          fingerprint: q.fingerprint,
          calls: q.calls,
          totalMs: q.total_ms,
          maxMs: q.max_ms,
          suggestions: q.suggestions,
        })),
      })),
    },
  };
}

function auditSection(r: StoredReceipt | null): Section<AuditView> {
  if (r === null) return NONE;
  const p = auditPayload.safeParse(r.payload);
  if (!p.success || r.hash === null) return unreadable("audit receipt");
  return {
    kind: "ok",
    value: {
      digest: r.hash,
      upToEventId: p.data.up_to_event_id,
      eventCount: p.data.event_count,
      requestId: p.data.request_id,
    },
  };
}

export function receiptView(i: ReceiptInputs): DossierReceiptView {
  const titles = new Map(i.documents.map((d) => [d.documentId, d.title]));
  const evidence = i.evidence.map((e, n) => evidenceRow(e, n, titles));
  const certificateKeys = new Map(
    evidence.flatMap((e) =>
      e.certificateId === null ? [] : [[e.certificateId.toLowerCase(), e.key]],
    ),
  ) as ReadonlyMap<string, string>;
  const envelope = envelopeSection(latest(i.receipts, "envelope"));
  return {
    evidence,
    certificateKeys,
    documents: i.documents.map((d) => ({
      documentId: d.documentId,
      kind: d.kind,
      title: d.title,
      sha256: d.sha256,
      graphHash: d.graphHash,
      pageCount: d.pageCount,
      excerpts: excerptsOf(d.documentId, i.evidence),
    })),
    transcript: transcriptSection(i.receipts, envelope),
    perf: perfSection(latest(i.receipts, "perf")),
    envelope,
    audit: auditSection(latest(i.receipts, "audit")),
  };
}
