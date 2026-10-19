import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link (used by PageFrame → AppNav)
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT_CALLED");
  }),
}));

// Spy on connection(): the page must wait for a request before it reads the database.
const mockConnection = vi.fn().mockResolvedValue(undefined);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => mockConnection(),
}));

// Mock the dossier query (home page reads recent dossiers)
const mockListRecentDossiers = vi.fn().mockResolvedValue([]);
vi.mock("@/features/dossier/server/query", () => ({
  listRecentDossiers: (...args: unknown[]) => mockListRecentDossiers(...args),
}));

function dossier(overrides: Record<string, unknown> = {}) {
  return {
    id: "0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b",
    userId: null,
    visitor: "v_kk6eooepno",
    claim: "the sky is blue",
    sources: ["hn"],
    mode: "rapid",
    status: "succeeded",
    verdict: "TRUE",
    confidence: "0.91",
    requestId: "req-1",
    envelopeId: null,
    error: null,
    createdAt: new Date("2026-10-20T10:00:00Z"),
    updatedAt: new Date("2026-10-20T10:00:00Z"),
    ...overrides,
  };
}

describe("Home page (public, spec 21 §2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRecentDossiers.mockResolvedValue([]);
  });

  it("renders for an anonymous visitor without redirecting", async () => {
    const { redirect } = await import("next/navigation");
    const { default: Home } = await import("@/app/page");
    const html = renderToString(await Home());
    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain("dossier console");
    expect(html).toContain("initiate a");
  });

  it("lists recent dossiers for everyone — no per-user scoping", async () => {
    mockListRecentDossiers.mockResolvedValueOnce([dossier()]);
    const { default: Home } = await import("@/app/page");
    const html = renderToString(await Home());
    expect(mockListRecentDossiers).toHaveBeenCalledWith(null, 8);
    expect(html).toContain("the sky is blue");
    expect(html).toContain("1 recent dossiers");
  });

  it("is rendered per request, never prerendered at build: connection() precedes the query", async () => {
    const { default: Home } = await import("@/app/page");
    await Home();
    expect(mockConnection).toHaveBeenCalledTimes(1);
    expect(mockConnection.mock.invocationCallOrder[0]).toBeLessThan(
      mockListRecentDossiers.mock.invocationCallOrder[0],
    );
  });

  it("renders 3 step cards (gather, seal, adjudicate)", async () => {
    const { default: Home } = await import("@/app/page");
    const html = renderToString(await Home());
    expect(html).toContain("gather");
    expect(html).toContain("seal");
    expect(html).toContain("adjudicate");
  });

  it("shows no sign-in surface: no role, no email, no login link, no v1 run prompt", async () => {
    const { default: Home } = await import("@/app/page");
    const html = renderToString(await Home());
    expect(html).not.toContain("role ·");
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain("read-only");
    expect(html).not.toContain("start dossier");
  });
});
