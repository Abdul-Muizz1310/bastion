import { describe, expect, it } from "vitest";
import { withRole } from "./rbac";

describe("03-rbac: happy path", () => {
  // Case 1: admin can access all actions
  it("admin passes all role checks", async () => {
    const adminUser = { id: "1", role: "admin" as const };
    await expect(withRole(["admin"], adminUser, "test.action")).resolves.not.toThrow();
    await expect(withRole(["admin", "editor"], adminUser, "test.action")).resolves.not.toThrow();
    await expect(
      withRole(["admin", "editor", "viewer"], adminUser, "test.action"),
    ).resolves.not.toThrow();
  });

  // Case 2: editor can access editor-allowed actions
  it("editor passes admin+editor and all-role checks", async () => {
    const editorUser = { id: "2", role: "editor" as const };
    await expect(withRole(["admin", "editor"], editorUser, "test.action")).resolves.not.toThrow();
    await expect(
      withRole(["admin", "editor", "viewer"], editorUser, "test.action"),
    ).resolves.not.toThrow();
  });

  // Case 3: viewer can access viewer-allowed actions
  it("viewer passes all-role checks", async () => {
    const viewerUser = { id: "3", role: "viewer" as const };
    await expect(
      withRole(["admin", "editor", "viewer"], viewerUser, "test.action"),
    ).resolves.not.toThrow();
  });

  // Case 4: withRole(["admin"]) rejects editor and viewer
  it("admin-only rejects editor and viewer", async () => {
    const editor = { id: "2", role: "editor" as const };
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin"], editor, "test.action")).rejects.toThrow();
    await expect(withRole(["admin"], viewer, "test.action")).rejects.toThrow();
  });

  // Case 5: withRole(["admin", "editor"]) rejects viewer
  it("admin+editor rejects viewer", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin", "editor"], viewer, "test.action")).rejects.toThrow();
  });

  // Case 6: withRole(["admin", "editor", "viewer"]) allows all
  it("all-role allows all authenticated users", async () => {
    for (const role of ["admin", "editor", "viewer"] as const) {
      const user = { id: "1", role };
      await expect(
        withRole(["admin", "editor", "viewer"], user, "test.action"),
      ).resolves.not.toThrow();
    }
  });
});

describe("03-rbac: edge and failure cases", () => {
  // Case 7: unauthenticated accessing protected route (middleware level)
  it("unauthenticated user is rejected", async () => {
    await expect(withRole(["admin"], null, "test.action")).rejects.toThrow();
  });

  // Case 8: unauthenticated accessing API returns 401
  it("unauthenticated user on API gets 401-style rejection", async () => {
    await expect(withRole(["admin"], null, "api.action")).rejects.toThrow();
  });

  // Case 9: viewer accessing /run rejected
  it("viewer cannot run demo", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin", "editor"], viewer, "demo.run")).rejects.toThrow();
  });

  // Case 10: viewer accessing /time-travel rejected
  it("viewer cannot access time-travel", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin"], viewer, "time-travel.view")).rejects.toThrow();
  });

  // Case 11: editor accessing /time-travel rejected
  it("editor cannot access time-travel", async () => {
    const editor = { id: "2", role: "editor" as const };
    await expect(withRole(["admin"], editor, "time-travel.view")).rejects.toThrow();
  });

  // Case 12: empty roles array rejects everyone
  it("empty roles array rejects all users", async () => {
    const admin = { id: "1", role: "admin" as const };
    await expect(withRole([], admin, "test.action")).rejects.toThrow();
  });
});

describe("03-rbac: security", () => {
  // Case 13: denial logged as security.denied event
  it("denial logs security.denied audit event", async () => {
    const viewer = { id: "3", role: "viewer" as const };
    try {
      await withRole(["admin"], viewer, "time-travel.view");
    } catch {
      // Expected denial — verify audit event was logged
      expect(true).toBe(false); // placeholder — needs audit spy
    }
  });

  // Case 14: role re-read from DB on every request
  it("role is read from DB, not cached in cookie", async () => {
    // Would need to change role in DB mid-session and verify next request sees new role
    expect(true).toBe(false); // placeholder — needs DB integration test
  });

  // Case 15: middleware + withRole double enforcement
  it("withRole provides defense in depth beyond middleware", async () => {
    // Verify withRole checks even if middleware somehow didn't
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin"], viewer, "admin.action")).rejects.toThrow();
  });
});
