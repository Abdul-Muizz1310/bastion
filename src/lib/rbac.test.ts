import { describe, expect, it, vi } from "vitest";

// Mock audit to avoid DB dependency
vi.mock("./audit", () => ({
  appendEvent: vi.fn().mockResolvedValue(1),
}));

import { AccessDeniedError, withRole } from "./rbac";

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
    const { appendEvent } = await import("./audit");
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

  it.todo("role is re-read from DB on every request (integration)");

  it("withRole provides defense in depth beyond middleware", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin"], viewer, "admin.action")).rejects.toThrow(AccessDeniedError);
  });
});
