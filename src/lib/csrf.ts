import crypto from "node:crypto";

export type CsrfResult = {
  token: string;
};

function getSecret(): string {
  return process.env.IRON_SESSION_PASSWORD ?? "";
}

export function mintCsrfToken(sessionId: string): CsrfResult {
  const random = crypto.randomBytes(32).toString("base64url");
  const timestamp = Date.now().toString(36);
  const payload = `${sessionId}.${timestamp}.${random}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const token = `${payload}.${sig}`;
  return { token };
}

export function validateCsrf(
  cookieToken: string | undefined,
  headerToken: string | undefined,
): void {
  if (!headerToken) {
    throw new CsrfError("Missing CSRF header");
  }
  if (!cookieToken) {
    throw new CsrfError("Missing CSRF cookie");
  }
  // Verify HMAC signature on the cookie token
  const lastDot = cookieToken.lastIndexOf(".");
  if (lastDot === -1) {
    throw new CsrfError("Malformed CSRF token");
  }
  const payload = cookieToken.slice(0, lastDot);
  const sig = cookieToken.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new CsrfError("CSRF token signature invalid");
  }
  // Double-submit: cookie must match header
  if (cookieToken !== headerToken) {
    throw new CsrfError("CSRF token mismatch");
  }
}

export class CsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsrfError";
  }
}
