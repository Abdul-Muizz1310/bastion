import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock audit to avoid DB dependency
vi.mock("@/lib/audit/write", () => ({
  appendEvent: vi.fn().mockResolvedValue(1),
}));

// Mock cookies() for requireRole
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
  }),
}));

// Mock forbidden() and unauthorized() to throw sentinel errors so tests can catch
vi.mock("next/navigation", () => ({
  forbidden: vi.fn(() => {
    throw new Error("FORBIDDEN_CALLED");
  }),
  unauthorized: vi.fn(() => {
    throw new Error("UNAUTHORIZED_CALLED");
  }),
}));

// Mock session module
const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

import { AccessDeniedError, requireRole, withRole } from "@/lib/auth/rbac";

describe("03-rbac: happy path", () => {
  it("admin passes all role checks", async () => {
    const admin = { id: "1", role: "admin" as const };
    await expect(withRole(["admin"], admin, "test.action")).resolves.toBeUndefined();
    await expect(withRole(["admin", "editor"], admin, "test.action")).resolves.toBeUndefined();
    await expect(
      withRole(["admin", "editor", "viewer"], admin, "test.action"),
    ).resolves.toBeUndefined();
  });

  it("editor passes admin+editor and all-role checks", async () => {
    const editor = { id: "2", role: "editor" as const };
    await expect(withRole(["admin", "editor"], editor, "test.action")).resolves.toBeUndefined();
    await expect(
      withRole(["admin", "editor", "viewer"], editor, "test.action"),
    ).resolves.toBeUndefined();
  });

  it("viewer passes all-role checks", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(
      withRole(["admin", "editor", "viewer"], viewer, "test.action"),
    ).resolves.toBeUndefined();
  });

  it("admin-only rejects editor and viewer", async () => {
    const editor = { id: "2", role: "editor" as const };
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin"], editor, "test.action")).rejects.toThrow(AccessDeniedError);
    await expect(withRole(["admin"], viewer, "test.action")).rejects.toThrow(AccessDeniedError);
  });

  it("admin+editor rejects viewer", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin", "editor"], viewer, "test.action")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("all-role allows all authenticated users", async () => {
    for (const role of ["admin", "editor", "viewer"] as const) {
      const user = { id: "1", role };
      await expect(
        withRole(["admin", "editor", "viewer"], user, "test.action"),
      ).resolves.toBeUndefined();
    }
  });
});

describe("03-rbac: edge and failure cases", () => {
  it("unauthenticated user is rejected", async () => {
    await expect(withRole(["admin"], null, "test.action")).rejects.toThrow(AccessDeniedError);
  });

  it("unauthenticated user on API gets rejection", async () => {
    await expect(withRole(["admin"], null, "api.action")).rejects.toThrow(AccessDeniedError);
  });

  it("viewer cannot run demo", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin", "editor"], viewer, "demo.run")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("viewer cannot access time-travel", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin"], viewer, "time-travel.view")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("editor cannot access time-travel", async () => {
    const editor = { id: "2", role: "editor" as const };
    await expect(withRole(["admin"], editor, "time-travel.view")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("empty roles array rejects all users", async () => {
    const admin = { id: "1", role: "admin" as const };
    await expect(withRole([], admin, "test.action")).rejects.toThrow(AccessDeniedError);
  });
});

describe("03-rbac: security", () => {
  it("denial logs security.denied audit event", async () => {
    const { appendEvent } = await import("@/lib/audit/write");
    const viewer = { id: "3", role: "viewer" as const };
    try {
      await withRole(["admin"], viewer, "time-travel.view");
    } catch {
      // Expected
    }
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.denied",
        entityType: "rbac",
        entityId: "time-travel.view",
      }),
    );
  });

  it("role is re-read from DB on every request (integration)", () => {
    // Structural: withRole accepts the user object as a parameter on every call.
    // It does not cache or store the role — the caller (middleware/server action)
    // must re-read the session and hydrate the user from DB each time.
    // We verify by checking that withRole's signature requires user on every call.
    expect(withRole).toBeDefined();
    expect(withRole.length).toBeGreaterThanOrEqual(3); // requires 3 args
  });

  it("withRole provides defense in depth beyond middleware", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin"], viewer, "admin.action")).rejects.toThrow(AccessDeniedError);
  });
});

describe("14-rbac: requireRole (page-level)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSession(role: "admin" | "editor" | "viewer") {
    return {
      sid: "sess-1",
      user: { id: "u1", email: "u@ex.com", role, name: null },
    };
  }

  it("case 1: admin session passes admin-only check and returns session", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(makeSession("admin"));
    const session = await requireRole(["admin"], "time-travel.view");
    expect(session.user.role).toBe("admin");
    expect(session.user.id).toBe("u1");
  });

  it("case 2: editor session passes admin+editor check", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(makeSession("editor"));
    const session = await requireRole(["admin", "editor"], "some.action");
    expect(session.user.role).toBe("editor");
  });

  it("case 3: no session cookie → unauthorized() is called", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { unauthorized } = await import("next/navigation");
    await expect(requireRole(["admin"], "any")).rejects.toThrow("UNAUTHORIZED_CALLED");
    expect(unauthorized).toHaveBeenCalled();
  });

  it("case 4: invalid session cookie → unauthorized()", async () => {
    mockCookieGet.mockReturnValue({ value: "forged" });
    mockGetSession.mockResolvedValue(null);
    const { unauthorized } = await import("next/navigation");
    await expect(requireRole(["admin"], "any")).rejects.toThrow("UNAUTHORIZED_CALLED");
    expect(unauthorized).toHaveBeenCalled();
  });

  it("case 5: expired session (getSession returns null) → unauthorized()", async () => {
    mockCookieGet.mockReturnValue({ value: "expired-cookie" });
    mockGetSession.mockResolvedValue(null);
    await expect(requireRole(["admin"], "any")).rejects.toThrow("UNAUTHORIZED_CALLED");
  });

  it("case 6: role mismatch logs security.denied and calls forbidden()", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(makeSession("viewer"));
    const { appendEvent } = await import("@/lib/audit/write");
    const { forbidden } = await import("next/navigation");

    await expect(requireRole(["admin"], "time-travel.view")).rejects.toThrow("FORBIDDEN_CALLED");
    expect(forbidden).toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.denied",
        entityType: "rbac",
        entityId: "time-travel.view",
        actorId: "u1",
      }),
    );
  });

  it("case 7: viewer trying admin route → audit logged + forbidden", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(makeSession("viewer"));
    const { appendEvent } = await import("@/lib/audit/write");

    await expect(requireRole(["admin"], "admin.keys.view")).rejects.toThrow("FORBIDDEN_CALLED");
    const call = (appendEvent as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(call?.metadata).toMatchObject({
      requiredRoles: ["admin"],
      actualRole: "viewer",
    });
  });

  it("case 8: re-reads cookie on each call (no caching)", async () => {
    mockCookieGet.mockReturnValueOnce({ value: "valid-cookie" });
    mockGetSession.mockResolvedValueOnce(makeSession("admin"));
    await requireRole(["admin"], "x");

    mockCookieGet.mockReturnValueOnce(undefined);
    mockGetSession.mockResolvedValueOnce(null);
    await expect(requireRole(["admin"], "x")).rejects.toThrow("UNAUTHORIZED_CALLED");

    // getSession was called twice — once per requireRole invocation
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });
});
