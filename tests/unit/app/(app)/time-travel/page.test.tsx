import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock cookies()
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
  }),
}));

// Mock forbidden() / unauthorized() with sentinel throws
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

// Mock audit write (rbac logs denials)
vi.mock("@/lib/audit/write", () => ({
  appendEvent: vi.fn().mockResolvedValue(1),
}));

import TimeTravelPage from "@/app/(app)/time-travel/page";

function adminSession() {
  return {
    sid: "sess-1",
    user: { id: "admin-1", email: "a@x.com", role: "admin" as const, name: null },
  };
}

function editorSession() {
  return {
    sid: "sess-2",
    user: { id: "editor-1", email: "e@x.com", role: "editor" as const, name: null },
  };
}

function viewerSession() {
  return {
    sid: "sess-3",
    user: { id: "viewer-1", email: "v@x.com", role: "viewer" as const, name: null },
  };
}

describe("TimeTravelPage (admin-gated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 9: renders for admin session", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(adminSession());
    const element = await TimeTravelPage();
    const html = renderToString(element);
    expect(html).toContain("Time");
    expect(html).toContain("Travel");
    expect(html).toContain("rewind to");
    expect(html).toContain("DISTINCT ON");
  });

  it("case 10: throws forbidden() for editor session", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(editorSession());
    const { forbidden } = await import("next/navigation");
    await expect(TimeTravelPage()).rejects.toThrow("FORBIDDEN_CALLED");
    expect(forbidden).toHaveBeenCalled();
  });

  it("case 11: throws forbidden() for viewer session", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(viewerSession());
    const { forbidden } = await import("next/navigation");
    await expect(TimeTravelPage()).rejects.toThrow("FORBIDDEN_CALLED");
    expect(forbidden).toHaveBeenCalled();
  });

  it("case 12: throws unauthorized() when no session", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { unauthorized } = await import("next/navigation");
    await expect(TimeTravelPage()).rejects.toThrow("UNAUTHORIZED_CALLED");
    expect(unauthorized).toHaveBeenCalled();
  });

  it("case 11b: viewer denial is audit-logged with time-travel.view action", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(viewerSession());
    const { appendEvent } = await import("@/lib/audit/write");
    try {
      await TimeTravelPage();
    } catch {
      // expected
    }
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.denied",
        entityType: "rbac",
        entityId: "time-travel.view",
        actorId: "viewer-1",
      }),
    );
  });
});
