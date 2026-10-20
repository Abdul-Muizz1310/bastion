import type { ReceiptKey, Transcript } from "@/capabilities/paper-trail";
import { transcriptRenderJson, transcriptSignedJson } from "@/dossier/issuer-forms";
import { verifyEd25519 } from "@/platform/ed25519";
import { sha256Hex } from "@/platform/sha256";
import type { TranscriptCheck } from "./check-result";

/**
 * paper-trail's receipt, checked live (spec 21 §5, §5.1 invariant 8). The server half: the forms
 * paper-trail hashes and signs are rebuilt from the rounds it served (`@/dossier/issuer-forms`),
 * `transcript_hash` is recomputed, and the signature is verified with the key paper-trail publishes
 * now. Nothing that could not be checked reads as a pass. Pure apart from the crypto.
 */

type Forms = { signed: string; render: string } | null;

function formsOf(t: Transcript): Forms {
  try {
    return { signed: transcriptSignedJson(t), render: transcriptRenderJson(t) };
  } catch {
    return null;
  }
}

function hashCheck(t: Transcript, forms: Forms): TranscriptCheck["hash"] {
  if (forms === null) return { state: "fail", form: null };
  if (sha256Hex(forms.render) === t.transcript_hash) return { state: "pass", form: "render" };
  if (sha256Hex(forms.signed) === t.transcript_hash) return { state: "pass", form: "signed" };
  return { state: "fail", form: null };
}

function signatureCheck(
  t: Transcript,
  forms: Forms,
  key: ReceiptKey | null,
): TranscriptCheck["signature"] {
  const alg = t.signature_alg;
  if (t.signature === null) {
    return { state: "unsigned", alg, detail: "paper-trail served this transcript unsigned" };
  }
  if (key === null) {
    return { state: "unavailable", alg, detail: "paper-trail's key could not be fetched now" };
  }
  if (key.alg !== "Ed25519") {
    return { state: "fail", alg, detail: `paper-trail's receipt key is ${key.alg}, not Ed25519` };
  }
  if (forms === null) {
    return { state: "fail", alg, detail: "the transcript has no form paper-trail could sign" };
  }
  const verified = verifyEd25519({
    publicKeyPem: key.public_key,
    message: forms.signed,
    signature: t.signature,
  });
  return verified
    ? { state: "pass", alg, detail: "verified with paper-trail's published Ed25519 key" }
    : { state: "fail", alg, detail: "the signature does not verify with paper-trail's key" };
}

export function checkTranscript(t: Transcript, key: ReceiptKey | null): TranscriptCheck {
  const forms = formsOf(t);
  return {
    debateId: t.debate_id,
    claim: t.claim,
    verdict: t.verdict,
    confidence: t.confidence,
    transcriptHash: t.transcript_hash,
    hash: hashCheck(t, forms),
    signature: signatureCheck(t, forms, key),
  };
}
