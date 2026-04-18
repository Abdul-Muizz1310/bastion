import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link (used by PageFrame → AppNav)
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT_CALLED");
  }),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

// Mock cookies
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
  }),
}));

// Mock session
const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

// Mock the dossier query (home page reads recent dossiers)
const mockListRecentDossiers = vi.fn().mockResolvedValue([]);
vi.mock("@/features/dossier/server/query", () => ({
  listRecentDossiers: (...args: unknown[]) => mockListRecentDossiers(...args),
}));

function session(role: "admin" | "editor" | "viewer") {
  return {
    sid: "sess-1",
    user: { id: "u1", email: `${role}@x.com`, role, name: null },
  };
}

describe("Home page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login?returnTo=%2F when unauthenticated", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { redirect } = await import("next/navigation");
    const { default: Home } = await import("@/app/page");
    await expect(Home()).rejects.toThrow("REDIRECT_CALLED");
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2F");
  });

  it("renders dossier console for authenticated admin", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
    const { default: Home } = await import("@/app/page");
    const element = await Home();
    const html = renderToString(element);
    expect(html).toContain("dossier console");
    expect(html).toContain("initiate a");
    expect(html).toContain("start dossier");
  });

  it("shows prompt for editor role (canRun=true)", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("editor"));
    const { default: Home } = await import("@/app/page");
    const element = await Home();
    const html = renderToString(element);
    expect(html).toContain("start dossier");
    // The read-only notice should NOT be present
    expect(html).not.toContain("read-only");
  });

  it("shows read-only notice for viewer role (canRun=false)", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("viewer"));
    const { default: Home } = await import("@/app/page");
    const element = await Home();
    const html = renderToString(element);
    expect(html).toContain("read-only");
    expect(html).toContain("viewer");
  });

  it("renders 3 step cards (gather, seal, adjudicate)", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
    const { default: Home } = await import("@/app/page");
    const element = await Home();
    const html = renderToString(element);
    expect(html).toContain("gather");
    expect(html).toContain("seal");
    expect(html).toContain("adjudicate");
  });

  it("shows user email + role in status bar", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
    const { default: Home } = await import("@/app/page");
    const element = await Home();
    const html = renderToString(element);
    expect(html).toContain("admin@x.com");
    expect(html).toContain("role ·");
  });
});
