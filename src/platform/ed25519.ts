import { createPublicKey, verify } from "node:crypto";

/**
 * Ed25519 verification of a downstream issuer's signature (spec 21 §6.5): paper-trail's transcript
 * receipts and inkprint's dossier envelopes are both a base64 Ed25519 signature over UTF-8 bytes,
 * checked against the issuer's published PEM (SubjectPublicKeyInfo) key. Pure apart from the
 * crypto; never throws — a malformed key or signature is not a valid signature.
 *
 * The signature must be canonical base64 of exactly 64 bytes (what Python's `b64encode` writes):
 * Node's base64 decoder skips characters it does not know, and a verifier must not.
 */

const SIGNATURE_B64 = /^[A-Za-z0-9+/]{86}==$/;

export type Signed = {
  publicKeyPem: string;
  /** A string is verified as its UTF-8 bytes. */
  message: string | Uint8Array;
  signature: string;
};

export function verifyEd25519({ publicKeyPem, message, signature }: Signed): boolean {
  if (!SIGNATURE_B64.test(signature)) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const data = typeof message === "string" ? Buffer.from(message, "utf8") : message;
    return verify(null, data, key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
