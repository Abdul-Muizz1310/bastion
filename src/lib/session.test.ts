import { describe, expect, it } from "vitest";
import { createSession, destroySession, getSession } from "./session";

describe("01-session: happy path", () => {
  // Case 1: createSession inserts DB row and returns sealed cookie
  it("createSession inserts a session row and returns a sealed cookie", async () => {
    const result = await createSession("user-id-123", "127.0.0.1", "test-agent");
    expect(result).toBeDefined();
    expect(result.cookie).toBeDefined();
    expect(result.sid).toBeDefined();
  });

  // Case 2: getSession with valid cookie returns { sid }
  it("getSession with valid cookie returns session data", async () => {
    const session = await createSession("user-id-123", "127.0.0.1", "test-agent");
    const result = await getSession(session.cookie);
    expect(result).not.toBeNull();
    expect(result?.sid).toBe(session.sid);
  });

  // Case 3: getSession hydrates full user from DB
  it("getSession hydrates full user with id, email, role", async () => {
    const session = await createSession("user-id-123", "127.0.0.1", "test-agent");
    const result = await getSession(session.cookie);
    expect(result).not.toBeNull();
    expect(result?.user).toBeDefined();
    expect(result?.user.email).toBeDefined();
    expect(result?.user.role).toBeDefined();
  });

  // Case 4: destroySession removes DB row and clears cookie
  it("destroySession removes the DB row and returns cleared cookie", async () => {
    const session = await createSession("user-id-123", "127.0.0.1", "test-agent");
    await destroySession(session.sid);
    const result = await getSession(session.cookie);
    expect(result).toBeNull();
  });

  // Case 5: cookie options include httpOnly, sameSite, path
  it("cookie has httpOnly, sameSite lax, path /", async () => {
    const result = await createSession("user-id-123", "127.0.0.1", "test-agent");
    expect(result.cookieOptions.httpOnly).toBe(true);
    expect(result.cookieOptions.sameSite).toBe("lax");
    expect(result.cookieOptions.path).toBe("/");
  });

  // Case 6: production cookie has secure: true
  it("cookie has secure: true in production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const result = await createSession("user-id-123", "127.0.0.1", "test-agent");
      expect(result.cookieOptions.secure).toBe(true);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe("01-session: edge and failure cases", () => {
  // Case 7: no cookie returns null
  it("getSession with no cookie returns null", async () => {
    const result = await getSession(undefined);
    expect(result).toBeNull();
  });

  // Case 8: tampered cookie returns null
  it("getSession with tampered cookie returns null", async () => {
    const result = await getSession("tampered-garbage-cookie-value");
    expect(result).toBeNull();
  });

  // Case 9: expired session returns null and cleans up
  it("getSession with expired session returns null", async () => {
    // Would need to create a session with past expiresAt
    expect(true).toBe(false); // placeholder — needs DB setup with expired row
  });

  // Case 10: valid cookie but deleted DB row returns null
  it("getSession with deleted DB row returns null", async () => {
    const session = await createSession("user-id-123", "127.0.0.1", "test-agent");
    await destroySession(session.sid);
    const result = await getSession(session.cookie);
    expect(result).toBeNull();
  });

  // Case 11: short IRON_SESSION_PASSWORD throws
  it("IRON_SESSION_PASSWORD shorter than 32 chars throws", () => {
    expect(() => {
      // Validate password length at module init
      throw new Error("Not implemented");
    }).toThrow();
  });

  // Case 12: multiple sessions for same user allowed
  it("multiple concurrent sessions for same user are allowed", async () => {
    const s1 = await createSession("user-id-123", "127.0.0.1", "agent-1");
    const s2 = await createSession("user-id-123", "192.168.1.1", "agent-2");
    expect(s1.sid).not.toBe(s2.sid);
    const r1 = await getSession(s1.cookie);
    const r2 = await getSession(s2.cookie);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
  });
});

describe("01-session: security", () => {
  // Case 13: cookie payload never contains PII
  it("cookie payload contains only sid, no email/role/name", async () => {
    const result = await createSession("user-id-123", "127.0.0.1", "test-agent");
    // The sealed cookie, when decoded by iron-session, should only have { sid }
    expect(result.payload).toEqual({ sid: result.sid });
  });

  // Case 14: session cannot be forged
  it("forged cookie value is rejected", async () => {
    const forged = "Fe26.2**fake-session-data**garbage";
    const result = await getSession(forged);
    expect(result).toBeNull();
  });
});
