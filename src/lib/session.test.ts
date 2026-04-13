import crypto from "node:crypto";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";

// Set env before importing
process.env.IRON_SESSION_PASSWORD = crypto.randomBytes(32).toString("base64");

// Mock DB
vi.mock("./db", () => {
  const mockInsert = vi.fn();
  const mockSelect = vi.fn();
  const mockDelete = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockLimit = vi.fn();
  const mockValues = vi.fn();

  const db = {
    insert: mockInsert,
    select: mockSelect,
    delete: mockDelete,
  };

  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue([]);

  mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

  return {
    getDb: () => db,
    __mocks: {
      db,
      mockInsert,
      mockSelect,
      mockDelete,
      mockFrom,
      mockWhere,
      mockLimit,
      mockValues,
    },
  };
});

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
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("./db");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    // Re-setup chains after clearAllMocks
    mocks.mockInsert.mockReturnValue({ values: mocks.mockValues });
    mocks.mockValues.mockResolvedValue(undefined);
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ limit: mocks.mockLimit });
    mocks.mockLimit.mockResolvedValue([]);
    mocks.mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("createSession inserts a session row and returns sealed cookie (integration)", async () => {
    const { createSession } = await import("./session");
    const result = await createSession("user-123", "127.0.0.1", "Mozilla/5.0");
    expect(result.sid).toBeDefined();
    expect(result.cookie).toBeDefined();
    expect(result.cookie).toContain(".");
    expect(mocks.mockInsert).toHaveBeenCalled();
    expect(mocks.mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        ip: "127.0.0.1",
        userAgent: "Mozilla/5.0",
      }),
    );
  });

  it("getSession with valid cookie returns session data (integration)", async () => {
    const { createSession, getSession } = await import("./session");

    // Create a session first to get a valid cookie
    const created = await createSession("user-123", "127.0.0.1", "agent");

    // Mock DB to return the session row when queried
    const futureExpiry = new Date(Date.now() + 86400000);
    mocks.mockLimit.mockResolvedValueOnce([
      { id: created.sid, userId: "user-123", expiresAt: futureExpiry, ip: "127.0.0.1" },
    ]);
    // Mock user hydration
    mocks.mockLimit.mockResolvedValueOnce([
      { id: "user-123", email: "test@example.com", role: "admin", name: "Test User" },
    ]);

    const session = await getSession(created.cookie);
    expect(session).not.toBeNull();
    expect(session?.sid).toBe(created.sid);
    expect(session?.user.email).toBe("test@example.com");
  });

  it("getSession hydrates full user with id, email, role (integration)", async () => {
    const { createSession, getSession } = await import("./session");

    const created = await createSession("user-456", null, null);
    const futureExpiry = new Date(Date.now() + 86400000);
    mocks.mockLimit.mockResolvedValueOnce([
      { id: created.sid, userId: "user-456", expiresAt: futureExpiry },
    ]);
    mocks.mockLimit.mockResolvedValueOnce([
      { id: "user-456", email: "editor@example.com", role: "editor", name: "Editor" },
    ]);

    const session = await getSession(created.cookie);
    expect(session?.user).toEqual({
      id: "user-456",
      email: "editor@example.com",
      role: "editor",
      name: "Editor",
    });
  });

  it("destroySession removes the DB row (integration)", async () => {
    const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
    mocks.mockDelete.mockReturnValue({ where: mockDeleteWhere });

    const { destroySession } = await import("./session");
    await destroySession("sid-to-destroy");
    expect(mocks.mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
  });

  it("cookie has httpOnly, sameSite lax, path / (integration)", async () => {
    const { createSession } = await import("./session");
    const result = await createSession("user-123", null, null);
    expect(result.cookieOptions.httpOnly).toBe(true);
    expect(result.cookieOptions.sameSite).toBe("lax");
    expect(result.cookieOptions.path).toBe("/");
  });

  it("cookie has secure: true in production (integration)", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    // Re-import to pick up the env change — but since getCookieOptions reads
    // process.env.NODE_ENV at call time, we just need to call createSession
    const { createSession } = await import("./session");
    const result = await createSession("user-123", null, null);
    expect(result.cookieOptions.secure).toBe(true);

    process.env.NODE_ENV = origEnv;
  });

  it("getSession with expired session returns null (integration)", async () => {
    const { createSession, getSession } = await import("./session");

    const created = await createSession("user-123", null, null);
    const pastExpiry = new Date(Date.now() - 86400000);
    mocks.mockLimit.mockResolvedValueOnce([
      { id: created.sid, userId: "user-123", expiresAt: pastExpiry },
    ]);

    const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
    mocks.mockDelete.mockReturnValue({ where: mockDeleteWhere });

    const session = await getSession(created.cookie);
    expect(session).toBeNull();
  });

  it("getSession with deleted DB row returns null (integration)", async () => {
    const { createSession, getSession } = await import("./session");

    const created = await createSession("user-123", null, null);
    // Return empty array = row not found
    mocks.mockLimit.mockResolvedValueOnce([]);

    const session = await getSession(created.cookie);
    expect(session).toBeNull();
  });

  it("multiple concurrent sessions for same user are allowed (integration)", async () => {
    const { createSession } = await import("./session");
    const s1 = await createSession("user-123", null, null);
    const s2 = await createSession("user-123", null, null);
    expect(s1.sid).not.toBe(s2.sid);
    expect(s1.cookie).not.toBe(s2.cookie);
  });

  it("cookie payload contains only sid, no email/role/name (integration)", async () => {
    const { createSession } = await import("./session");
    const result = await createSession("user-123", null, null);
    expect(result.payload).toEqual({ sid: result.sid });
    expect(result.payload).not.toHaveProperty("email");
    expect(result.payload).not.toHaveProperty("role");
    expect(result.payload).not.toHaveProperty("name");
  });
});
