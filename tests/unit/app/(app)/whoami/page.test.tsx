import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock redirect — throw a sentinel so tests can assert the redirect path
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT_CALLED");
  }),
}));

// Mock cookies()
const mockCookieGet = vi.fn().mockReturnValue({ value: "sealed-cookie" });
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: (name: string) => mockCookieGet(name) }),
}));

// Mock the real session accessors
const mockGetSession = vi.fn();
const mockGetSessionExpiry = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getSessionExpiry: (...args: unknown[]) => mockGetSessionExpiry(...args),
  COOKIE_NAME: "bastion_session",
}));

import WhoamiPage from "@/app/(app)/whoami/page";

const SID = "abcdef12-3456-7890-abcd-ef0123456789";

describe("WhoamiPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      sid: SID,
      user: { id: "u1", email: "editor@bastion.local", role: "editor", name: null },
    });
    mockGetSessionExpiry.mockResolvedValue(new Date(Date.now() + 2 * 60 * 60 * 1000));
  });

  it("renders the real session email, role, and sid prefix (not hardcoded fake data)", async () => {
    const element = await WhoamiPage();
    const html = renderToString(element);
    expect(html).toContain("editor@bastion.local");
    expect(html).toContain("editor");
    expect(html).toContain("abcdef12");
    // the previous static fake data must be gone
    expect(html).not.toContain("demo-admin@bastion.local");
    expect(html).not.toContain("a1b2c3d4");
    // the static security-posture list is preserved
    expect(html).toContain("httpOnly cookie");
    expect(html).toContain("HMAC-sealed SID");
  });

  it("labels the control list as a static inventory, not a verified live audit", async () => {
    const html = renderToString(await WhoamiPage());
    expect(html).toContain("security_posture");
    expect(html).not.toContain("security_checklist");
    expect(html).toContain("Static inventory");
    expect(html).toContain("not a live probe");
  });

  it("does not stamp every control with a green check it never verified", async () => {
    const html = renderToString(await WhoamiPage());
    // The old panel rendered exactly this per item, regardless of any state.
    expect(html).not.toContain('<span class="text-success">✓</span>');
  });

  it("names where each control actually lives instead of an unqualified claim", async () => {
    const html = renderToString(await WhoamiPage());
    // RBAC is not in the middleware (src/proxy.ts only authenticates).
    expect(html).toContain("RBAC on page guards + Server Actions");
    // CSRF covers the mutating route handlers, not Server Actions.
    expect(html).toContain("CSRF double-submit on mutating API routes");
    // Append-only is a real DB-level guarantee (drizzle/0001_append_only_events.sql).
    expect(html).toContain("append-only events (DB triggers)");
    // CSP is set in next.config.ts headers(), not in middleware.
    expect(html).toContain("CSP + security headers (next.config.ts)");
  });

  it("reflects whatever role the session has — not a hardcoded admin", async () => {
    mockGetSession.mockResolvedValue({
      sid: SID,
      user: { id: "u2", email: "viewer@bastion.local", role: "viewer", name: null },
    });
    const element = await WhoamiPage();
    const html = renderToString(element);
    expect(html).toContain("viewer@bastion.local");
    expect(html).toContain("viewer");
  });

  it("derives the expiry from the session row", async () => {
    const element = await WhoamiPage();
    const html = renderToString(element);
    expect(html).toMatch(/in \d+h \d+m/);
  });

  it("redirects to login when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const { redirect } = await import("next/navigation");
    await expect(WhoamiPage()).rejects.toThrow("REDIRECT_CALLED");
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Fwhoami");
  });
});
