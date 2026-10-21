import { inkprint } from "@/capabilities/inkprint";
import { requestEvents } from "@/platform/audit/request-events";
import { canonicalJson } from "@/platform/canonical-json";
import { callCapability } from "@/platform/gateway/call";
import { sha256Hex } from "@/platform/sha256";
import { listDocuments } from "../documents";
import { listEvidence } from "../evidence";
import { auditDigest } from "../receipt-math";
import { findReceipt, type StoredReceipt, saveEnvelopeReceipt } from "../receipts";
import type { Json, StageContext, StageHandler, StageOutcome } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `envelope` (spec 21 §6.1, §6.5): inkprint signs one envelope over the dossier — the stored
 * certificate ids, the transcript receipt's hash, the perf receipt's hash — with metadata (all
 * strings, inkprint's `dict[str, str]`): the request id, the audit digest and its event-id bound
 * (`audit_up_to`, Ruling V — signed, so a stranger knows which events to recompute it over), the
 * documents' graph hashes (sorted, comma-joined), the transcript signature and the debate id.
 *
 * Everything comes from what earlier stages stored, never from a fresh call, so the bundle is the
 * same on every attempt: the audit digest covers the request's events up to measure's `auditUpTo`.
 * inkprint returns the stored envelope for an identical bundle and refuses (409) a different one,
 * so a retry after a lost write recovers instead of conflicting. The receipt is stored once and
 * sets `dossiers.envelope_id`. Skipped when the debate output has no id (no debate ran), or
 * nothing was certified (inkprint requires at least one certificate); a debate id without its
 * transcript receipt is a non-retryable `transcript_receipt_missing` error.
 */

type EnvelopeInput = {
  dossier_id: string;
  evidence_cert_ids: string[];
  debate_transcript_hash: string;
  perf_receipt_hash: string;
  metadata: Record<string, string>;
};

export type EnvelopeDeps = {
  envelope: typeof callEnvelope;
  evidence: typeof listEvidence;
  documents: typeof listDocuments;
  receipt: typeof findReceipt;
  events: typeof requestEvents;
  save: typeof saveEnvelopeReceipt;
};

function callEnvelope(ctx: StageContext, input: EnvelopeInput) {
  return callCapability(inkprint.envelope, input, callContext(ctx));
}

function field(out: Json | undefined, key: string): Json | undefined {
  return typeof out === "object" && out !== null && !Array.isArray(out) ? out[key] : undefined;
}

const error = (message: string): StageOutcome => ({
  kind: "error",
  error: `envelope: ${message}`,
  retryable: false,
});

/** The stage's result from the envelope receipt that is stored (this one, or one stored before). */
function done(kept: StoredReceipt): StageOutcome {
  return kept.ref === null
    ? error("the stored envelope has no id")
    : { kind: "ok", output: { envelopeId: kept.ref } };
}

export function envelopeStage(deps: EnvelopeDeps): StageHandler {
  return async (ctx): Promise<StageOutcome> => {
    const { id: dossierId, requestId } = ctx.dossier;
    const kept = await deps.receipt(dossierId, "envelope");
    if (kept !== null) return done(kept);

    const debateId = field(ctx.outputs.debate, "debateId");
    if (typeof debateId !== "string" || debateId === "") {
      return { kind: "skipped", reason: "no_transcript" };
    }
    // The debate ran (it has an id), so its transcript receipt must exist: a missing one is a
    // broken dossier, and a retry would find it missing again.
    const transcript = await deps.receipt(dossierId, "transcript", debateId);
    if (transcript === null) return error(`transcript_receipt_missing (debate ${debateId})`);
    if (transcript.hash === null) return error("the transcript receipt has no hash");

    const certificateIds = (await deps.evidence(dossierId)).flatMap((r) =>
      r.certificateId === null ? [] : [r.certificateId],
    );
    if (certificateIds.length === 0) return { kind: "skipped", reason: "no_certificates" };

    const perf = await deps.receipt(dossierId, "perf");
    if (perf === null || perf.hash === null) return error("no perf receipt is stored");

    const auditUpTo = field(ctx.outputs.measure, "auditUpTo");
    if (typeof auditUpTo !== "number" || !Number.isSafeInteger(auditUpTo) || auditUpTo < 0) {
      return error("measure recorded no audit bound");
    }
    const graphHashes = (await deps.documents(dossierId))
      .flatMap((d) => (d.graphHash === null ? [] : [d.graphHash]))
      .sort();

    const input: EnvelopeInput = {
      dossier_id: dossierId,
      evidence_cert_ids: certificateIds,
      debate_transcript_hash: transcript.hash,
      perf_receipt_hash: perf.hash,
      metadata: {
        request_id: requestId,
        audit_digest_at_envelope: auditDigest(await deps.events(requestId, auditUpTo)),
        audit_up_to: String(auditUpTo),
        graph_hashes: graphHashes.join(","),
        transcript_signature: transcript.signature ?? "",
        debate_id: debateId,
      },
    };
    const result = await deps.envelope(ctx, input);
    if (!result.ok) return failure("inkprint.envelope", result);
    const e = result.data;
    return done(
      await deps.save(dossierId, {
        ref: e.envelope_id,
        hash: sha256Hex(canonicalJson(e.envelope_manifest)),
        signature: e.envelope_signature,
        payload: {
          envelope_id: e.envelope_id,
          envelope_manifest: e.envelope_manifest,
          envelope_signature: e.envelope_signature,
          created_at: e.created_at,
          audit_up_to: auditUpTo,
          request: input,
        },
      }),
    );
  };
}

export const envelope: StageHandler = envelopeStage({
  envelope: callEnvelope,
  evidence: listEvidence,
  documents: listDocuments,
  receipt: findReceipt,
  events: requestEvents,
  save: saveEnvelopeReceipt,
});
