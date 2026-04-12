import crypto from "node:crypto";

export type CsrfResult = {
  token: string;
};

export function mintCsrfToken(sessionId: string): CsrfResult {
  // Generate a random token bound to this session + timestamp
  const random = crypto.randomBytes(32).toString("base64url");
  const timestamp = Date.now().toString(36);
  const token = `${sessionId}.${timestamp}.${random}`;
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
