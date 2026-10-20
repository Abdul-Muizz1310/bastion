import { inkprint } from "@/capabilities/inkprint";
import { callCapability } from "@/platform/gateway/call";
import { listEvidence, type SealedRecord, saveSealed } from "../evidence";
import { type Candidate, selectEvidence } from "../select-evidence";
import type { StageContext, StageHandler } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `seal` (spec 21 §6.1): certify the evidence the debate will see. `selectEvidence` picks at
 * most 12 candidates and one inkprint batch certifies them. Certificates spend budget, so identity
 * is the candidate key (`evidence_items.stable_id`, unique per dossier): a retry reads what is
 * stored, certifies only candidates with no certificate yet, and never lets the dossier's total
 * pass 12, however the selection shifts between attempts.
 */

export const MAX_SEALED = 12;
export const AUTHOR = "bastion";

type BatchItem = {
  text: string;
  author: string;
  metadata: Record<string, string>;
};

export type SealDeps = {
  certifyBatch: typeof callCertifyBatch;
  list: typeof listEvidence;
  save: typeof saveSealed;
};

function callCertifyBatch(ctx: StageContext, items: BatchItem[]) {
  return callCapability(inkprint.certifyBatch, { items }, callContext(ctx));
}

function candidatesOf(ctx: StageContext): Candidate[] {
  // gather and read write `Candidate[]` (Tasks 6); absent when the stage was skipped.
  const part = (stage: "gather" | "read") => {
    const out = ctx.outputs[stage];
    return Array.isArray(out) ? (out as unknown as Candidate[]) : [];
  };
  return [...part("gather"), ...part("read")];
}

function batchItem(dossierId: string, c: Candidate): BatchItem {
  return {
    text: c.text,
    author: AUTHOR,
    metadata: { dossier_id: dossierId, source: c.product, kind: c.kind, key: c.key, url: c.url },
  };
}

/** The manifest's Ed25519 signature value, when the batch response carries one. */
function signatureOf(manifest: Record<string, unknown>): string | null {
  const sig = manifest.signature;
  if (typeof sig === "object" && sig !== null && "value" in sig) {
    const value = (sig as { value: unknown }).value;
    return typeof value === "string" && value !== "" ? value : null;
  }
  return null;
}

export function sealStage(deps: SealDeps): StageHandler {
  return async (ctx) => {
    const candidates = candidatesOf(ctx);
    if (candidates.length === 0) return { kind: "skipped", reason: "no_evidence" };

    const certified = new Set(
      (await deps.list(ctx.dossier.id)).flatMap((r) =>
        r.certificateId === null ? [] : [r.stableId],
      ),
    );
    const room = Math.max(0, MAX_SEALED - certified.size);
    const selected = selectEvidence(ctx.dossier.claim, candidates, MAX_SEALED);
    const pending = selected.filter((c) => !certified.has(c.key)).slice(0, room);
    const total = certified.size + pending.length;
    if (pending.length === 0) return { kind: "ok", output: { certified: 0, total } };

    const result = await deps.certifyBatch(
      ctx,
      pending.map((c) => batchItem(ctx.dossier.id, c)),
    );
    if (!result.ok) return failure("inkprint.certifyBatch", result);
    const certificates = result.data.certificates;
    // Records pair with items by position; a short or long answer cannot be paired safely.
    if (certificates.length !== pending.length) {
      return {
        kind: "error",
        error: `seal: expected ${pending.length} certificates, got ${certificates.length}`,
        retryable: false,
      };
    }
    const records: SealedRecord[] = pending.map((candidate, i) => {
      const cert = certificates[i];
      /* v8 ignore next */
      if (!cert) throw new Error("unreachable: length checked");
      return {
        candidate,
        certificateId: cert.certificate_id,
        contentHash: cert.fingerprints.sha256,
        signature: signatureOf(cert.manifest),
        text: candidate.text,
      };
    });
    const saved = await deps.save(ctx.dossier.id, records);
    return { kind: "ok", output: { certified: saved, total } };
  };
}

export const seal: StageHandler = sealStage({
  certifyBatch: callCertifyBatch,
  list: listEvidence,
  save: saveSealed,
});
