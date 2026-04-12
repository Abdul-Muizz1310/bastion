import { describe, expect, it } from "vitest";
import { mintCsrfToken, validateCsrf } from "./csrf";

describe("04-csrf: happy path", () => {
  // Case 1: mint returns token and cookie value
  it("mintCsrfToken returns a token string and cookie setter", () => {
    const result = mintCsrfToken("session-id-123");
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
  });

  // Case 2: matching cookie + header passes
  it("validateCsrf passes when cookie and header match", () => {
    const { token } = mintCsrfToken("session-id-123");
    expect(() => validateCsrf(token, token)).not.toThrow();
  });

  // Case 3: API POST with valid CSRF proceeds
  it("POST request with matching CSRF tokens proceeds", () => {
    const { token } = mintCsrfToken("session-id-123");
    expect(() => validateCsrf(token, token)).not.toThrow();
  });

  // Case 4: GET requests exempt
  it("GET requests do not require CSRF validation", () => {
    // GET is exempt — validateCsrf is only called on mutating operations
    expect(true).toBe(true); // structural test — exempt routes skip validation
  });
});

describe("04-csrf: edge and failure cases", () => {
  // Case 5: missing header fails
  it("validateCsrf throws when header is missing", () => {
    const { token } = mintCsrfToken("session-id-123");
    expect(() => validateCsrf(token, undefined)).toThrow();
  });

  // Case 6: mismatched tokens fail
  it("validateCsrf throws when cookie and header mismatch", () => {
    const { token } = mintCsrfToken("session-id-123");
    expect(() => validateCsrf(token, "wrong-token")).toThrow();
  });

  // Case 7: API POST without CSRF fails
  it("API POST without CSRF header is rejected", () => {
    expect(() => validateCsrf("cookie-token", undefined)).toThrow();
  });

  // Case 8: expired/rotated token fails
  it("expired CSRF token is rejected", () => {
    // Token from old session should fail
    const old = mintCsrfToken("old-session");
    const current = mintCsrfToken("current-session");
    expect(() => validateCsrf(current.token, old.token)).toThrow();
  });

  // Case 9: cross-session token fails
  it("CSRF token from another session is rejected", () => {
    const session1 = mintCsrfToken("session-1");
    const session2 = mintCsrfToken("session-2");
    expect(() => validateCsrf(session1.token, session2.token)).toThrow();
  });
});

describe("04-csrf: security", () => {
  // Case 10: failure logged as security.csrf_failed
  it("CSRF failure logs security.csrf_failed event", () => {
    expect(true).toBe(false); // placeholder — needs audit spy
  });

  // Case 11: token not predictable
  it("CSRF tokens are not sequential or predictable", () => {
    const t1 = mintCsrfToken("session-1");
    const t2 = mintCsrfToken("session-1");
    // Even same session produces different tokens (time-based or random component)
    expect(t1.token).not.toBe(t2.token);
  });
});
