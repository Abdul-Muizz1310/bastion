import { inkprint, type VerifyBatchResult } from "@/capabilities/inkprint";
import { type Graph, inkthread } from "@/capabilities/inkthread";
import { paperTrail, type ReceiptKey, type Transcript } from "@/capabilities/paper-trail";
import type { DossierDocument, EvidenceItem } from "@/lib/db/schema";
import { type RequestEvent, requestEvents } from "@/platform/audit/request-events";
import { type CallContext, callCapability } from "@/platform/gateway/call";
import type { GatewayResult, RawBody } from "@/platform/gateway/result";
import { listDocuments } from "./documents";
import { listEvidence } from "./evidence";
import { listReceipts, type StoredReceipt } from "./receipts";
import {
  auditBound,
  auditCheck,
  type Check,
  certificateIds,
  certificatesCheck,
  type DossierFacts,
  documentsCheck,
  envelopeAuditBound,
  envelopeCheck,
  perfCheck,
  transcriptCheck,
} from "./verify";

/**
 * "Verify everything" (spec 21 §6.5), the imperative shell: read the dossier's receipts, evidence
 * and documents, ask each issuer what it says now, and hand both to the pure checks in `./verify`
 * with the dossier row, so what the page shows is bound to what is verified.
 *
 * Every downstream call is a free capability and goes through the one gateway under the caller's
 * context (Ruling W: the system actor and the verify run's own request id), in parallel: one
 * `inkprint.verifyBatch` by certificate id only (no text: nothing is re-embedded; the text is bound
 * exactly by hash and signature in `./verify`), one `paper-trail.transcript` per transcript receipt,
 * the two issuers' public keys (fetched live, never taken from the dossier), and one
 * `inkthread.graph` per document that was read. The audit digests are recomputed from bastion's append-only log over the bounds the
 * receipts carry. Nothing is written: a stranger's verification is not stored.
 */

export type VerifyDeps = {
  receipts: (dossierId: string) => Promise<StoredReceipt[]>;
  evidence: (dossierId: string) => Promise<EvidenceItem[]>;
  documents: (dossierId: string) => Promise<DossierDocument[]>;
  events: (requestId: string, upTo: number) => Promise<RequestEvent[]>;
  verifyBatch: (
    ctx: CallContext,
    input: { items: { certificate_id: string }[] },
  ) => Promise<GatewayResult<VerifyBatchResult>>;
  transcript: (ctx: CallContext, debateId: string) => Promise<GatewayResult<Transcript>>;
  receiptKey: (ctx: CallContext) => Promise<GatewayResult<ReceiptKey>>;
  publicKey: (ctx: CallContext) => Promise<GatewayResult<RawBody>>;
  graph: (ctx: CallContext, documentId: string) => Promise<GatewayResult<Graph>>;
};

export function dossierVerifier(deps: VerifyDeps) {
  return async (dossier: DossierFacts, ctx: CallContext): Promise<Check[]> => {
    const [stored, evidence, docs] = await Promise.all([
      deps.receipts(dossier.id),
      deps.evidence(dossier.id),
      deps.documents(dossier.id),
    ]);
    const of = (kind: StoredReceipt["kind"]) => stored.filter((r) => r.kind === kind);
    const certificates = of("certificate");
    const transcripts = of("transcript");
    const perf = of("perf")[0] ?? null;
    const envelope = of("envelope")[0] ?? null;
    const audit = of("audit")[0] ?? null;
    const ids = certificateIds(evidence, certificates);
    const read = docs.filter((d) => d.graphHash !== null);
    // inkprint's key verifies both the certificates and the envelope.
    const needsInkprintKey = ids.length > 0 || envelope !== null;

    /** A receipt with the events up to the bound it carries (none when it carries none). */
    const covered = async (r: StoredReceipt | null, bound: (r: StoredReceipt) => number | null) => {
      if (r === null) return null;
      const upTo = bound(r);
      return {
        receipt: r,
        events: upTo === null ? [] : await deps.events(dossier.requestId, upTo),
      };
    };

    const [batch, lives, paperTrailKey, inkprintKey, graphs, auditCovered, envelopeCovered] =
      await Promise.all([
        ids.length === 0
          ? null
          : deps.verifyBatch(ctx, { items: ids.map((certificate_id) => ({ certificate_id })) }),
        Promise.all(transcripts.map((t) => (t.ref === null ? null : deps.transcript(ctx, t.ref)))),
        transcripts.length === 0 ? null : deps.receiptKey(ctx),
        needsInkprintKey ? deps.publicKey(ctx) : null,
        Promise.all(
          read.map(async (d) => [d.documentId, await deps.graph(ctx, d.documentId)] as const),
        ),
        covered(audit, auditBound),
        covered(envelope, envelopeAuditBound),
      ]);

    const envelopeChecked = envelopeCheck({
      dossier,
      envelope,
      certificates,
      transcripts,
      perf,
      documents: docs,
      key: inkprintKey,
    });
    const checks = [
      certificatesCheck({ evidence, receipts: certificates, answer: batch, key: inkprintKey }),
      transcriptCheck({
        dossier,
        envelope,
        items: transcripts.map((receipt, i) => ({ receipt, live: lives[i] ?? null })),
        key: paperTrailKey,
      }),
      envelopeChecked,
      perfCheck(dossier, perf),
      auditCheck({
        dossier,
        audit: auditCovered,
        envelope:
          envelopeCovered === null
            ? null
            : { ...envelopeCovered, signature: envelopeChecked?.state ?? "unavailable" },
      }),
      documentsCheck(docs, new Map(graphs)),
    ];
    return checks.filter((c): c is Check => c !== null);
  };
}

export const verifyDossier = dossierVerifier({
  receipts: listReceipts,
  evidence: listEvidence,
  documents: listDocuments,
  events: requestEvents,
  verifyBatch: (ctx, input) => callCapability(inkprint.verifyBatch, input, ctx),
  transcript: (ctx, id) => callCapability(paperTrail.transcript, { id }, ctx),
  receiptKey: (ctx) => callCapability(paperTrail.receiptKey, {}, ctx),
  publicKey: (ctx) => callCapability(inkprint.publicKey, {}, ctx),
  graph: (ctx, documentId) => callCapability(inkthread.graph, { documentId }, ctx),
});
