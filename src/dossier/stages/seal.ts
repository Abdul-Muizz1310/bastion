import { inkprint } from "@/capabilities/inkprint";
import { callCapability } from "@/platform/gateway/call";
import { sha256Hex } from "@/platform/sha256";
import { listEvidence, type SealedRecord, saveSealed } from "../evidence";
import { type Candidate, selectEvidence } from "../select-evidence";
import type { StageContext, StageHandler } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `seal` (spec 21 §6.1): certify the evidence the debate will see. `selectEvidence` picks at
 * most 12 candidates and one inkprint batch certifies them. Certificates spend budget, so identity
 * is the candidate key (`evidence_items.stable_id`, unique per dossier): a retry reads what is
 * stored, certifies only candidates whose key has no row yet (a row without a certificate counts as
 * taken too), and never lets the dossier's total pass 12, however the selection shifts between
 * attempts. Keys are unique before anything is certified (the first candidate seen wins, gather
 * before read), and a candidate inkprint would refuse for its length is skipped, not fatal.
 */

export const MAX_SEALED = 12;
export const AUTHOR = "bastion";
/** inkprint's batch item limit (`max_length`, in characters). */
export const MAX_TEXT_CHARS = 1_000_000;

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

/** Why a candidate cannot be certified at all, or null when it can. */
function uncertifiable(c: Candidate): string | null {
  if (c.text.length > MAX_TEXT_CHARS) return `${c.text.length} characters > ${MAX_TEXT_CHARS}`;
  // A lone surrogate has no UTF-8 encoding: neither inkprint nor sha256Hex can hash it.
  if (!c.text.isWellFormed()) return "text is not well-formed UTF-16";
  return null;
}

/**
 * The candidates seal may certify: gather's then read's (`Candidate[]`, absent when the stage was
 * skipped), one per key (the first seen wins), none inkprint would refuse (each logged).
 */
function candidatesOf(ctx: StageContext): Candidate[] {
  const part = (stage: "gather" | "read") => {
    const out = ctx.outputs[stage];
    return Array.isArray(out) ? (out as unknown as Candidate[]) : [];
  };
  const byKey = new Map<string, Candidate>();
  for (const c of [...part("gather"), ...part("read")]) {
    if (byKey.has(c.key)) continue;
    const reason = uncertifiable(c);
    if (reason !== null) {
      console.warn(`seal: skipped ${c.key} for dossier ${ctx.dossier.id}: ${reason}`);
      continue;
    }
    byKey.set(c.key, c);
  }
  return [...byKey.values()];
}

/** Ruling S: the source's own hash — magpie's for web items, the text's sha256 for documents. */
function sourceHash(c: Candidate): string {
  return c.kind === "web" && c.magpieHash !== undefined ? c.magpieHash : sha256Hex(c.text);
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

    // Every stored key is taken: a row without a certificate is never certified a second time.
    const taken = new Set((await deps.list(ctx.dossier.id)).map((r) => r.stableId));
    const room = Math.max(0, MAX_SEALED - taken.size);
    const selected = selectEvidence(ctx.dossier.claim, candidates, MAX_SEALED);
    const pending = selected.filter((c) => !taken.has(c.key)).slice(0, room);
    const total = taken.size + pending.length;
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
        contentHash: sourceHash(candidate),
        inkprintHash: cert.fingerprints.sha256,
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
