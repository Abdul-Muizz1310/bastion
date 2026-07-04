import crypto from "node:crypto";

/**
 * HMAC-based cookie sealing for the session id. This is the single owner of the
 * seal/unseal primitive — both the session layer (`session.ts`, Node runtime,
 * DB-backed) and the route-gating proxy (`proxy.ts`, no DB) import from here so
 * the security-critical crypto can never silently drift between two copies.
 *
 * It is a *signing* scheme (integrity), not encryption — the payload is only an
 * opaque random `sid`, which carries no PII, so confidentiality is not required.
 */

const MIN_PASSWORD_LEN = 32;

function getPassword(): string {
  return process.env.IRON_SESSION_PASSWORD ?? "";
}

/** Seal a session id into a `${sid}.${hmac}` cookie value. */
export function sealSid(sid: string): string {
  const sig = crypto.createHmac("sha256", getPassword()).update(sid).digest("base64url");
  return `${sid}.${sig}`;
}

/**
 * Unseal a cookie value, returning the sid iff the HMAC verifies in constant
 * time. Returns null on any malformed/forged input or misconfigured secret.
 */
export function unsealSid(cookie: string): string | null {
  const password = getPassword();
  if (password.length < MIN_PASSWORD_LEN) return null;

  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const sid = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);
  if (!sid || !sig) return null;

  const expected = crypto.createHmac("sha256", password).update(sid).digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  return sid;
}

/** Convenience predicate for route gating where only validity matters. */
export function verifySealedCookie(cookie: string): boolean {
  return unsealSid(cookie) !== null;
}
