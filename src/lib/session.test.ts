import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

// Set env before importing
process.env.IRON_SESSION_PASSWORD = crypto.randomBytes(32).toString("base64");

// Import only the pure functions we can test without DB
// Session CRUD functions need a real DB connection, so those are integration tests

describe("01-session: cookie sealing", () => {
  it("createSession requires IRON_SESSION_PASSWORD >= 32 chars", async () => {
    const origPw = process.env.IRON_SESSION_PASSWORD;
    process.env.IRON_SESSION_PASSWORD = "short";
    const { createSession } = await import("./session");
    await expect(createSession("user-id", "127.0.0.1", "agent")).rejects.toThrow(
      "IRON_SESSION_PASSWORD must be at least 32 characters",
    );
    process.env.IRON_SESSION_PASSWORD = origPw;
  });

  it("getSession with no cookie returns null", async () => {
    const { getSession } = await import("./session");
    const result = await getSession(undefined);
    expect(result).toBeNull();
  });

  it("getSession with tampered cookie returns null", async () => {
    const { getSession } = await import("./session");
    const result = await getSession("tampered-garbage-cookie-value");
    expect(result).toBeNull();
  });

  it("forged cookie value is rejected", async () => {
    const { getSession } = await import("./session");
    const forged = "Fe26.2**fake-session-data**garbage";
    const result = await getSession(forged);
    expect(result).toBeNull();
  });

  it("cookie with no dot separator is rejected", async () => {
    const { getSession } = await import("./session");
    const result = await getSession("nodot");
    expect(result).toBeNull();
  });
});

describe("01-session: cookie options", () => {
  it("session exports COOKIE_NAME", async () => {
    const { COOKIE_NAME } = await import("./session");
    expect(COOKIE_NAME).toBe("bastion_session");
  });
});

describe("01-session: DB-dependent tests", () => {
  it.todo("createSession inserts a session row and returns sealed cookie (integration)");
  it.todo("getSession with valid cookie returns session data (integration)");
  it.todo("getSession hydrates full user with id, email, role (integration)");
  it.todo("destroySession removes the DB row (integration)");
  it.todo("cookie has httpOnly, sameSite lax, path / (integration)");
  it.todo("cookie has secure: true in production (integration)");
  it.todo("getSession with expired session returns null (integration)");
  it.todo("getSession with deleted DB row returns null (integration)");
  it.todo("multiple concurrent sessions for same user are allowed (integration)");
  it.todo("cookie payload contains only sid, no email/role/name (integration)");
});
