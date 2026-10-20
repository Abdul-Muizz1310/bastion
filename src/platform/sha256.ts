import { createHash } from "node:crypto";

/**
 * SHA-256 as lower-case hex — the digest every bastion receipt uses (spec 21 §6.3, §6.5). A string
 * is hashed as its UTF-8 bytes. A string holding a lone surrogate has no UTF-8 encoding (Node would
 * silently substitute U+FFFD, so two different strings could share a digest): it is refused.
 */
export function sha256Hex(input: string | Uint8Array): string {
  if (typeof input === "string" && !input.isWellFormed()) {
    throw new TypeError("sha256Hex: the string holds a lone surrogate (not valid UTF-16)");
  }
  return createHash("sha256").update(input).digest("hex");
}
