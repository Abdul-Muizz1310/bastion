import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: (name: string) => mockCookieGet(name) }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT_CALLED");
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND_CALLED");
  }),
  forbidden: vi.fn(() => {
    throw new Error("FORBIDDEN_CALLED");
  }),
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

const mockQueryAuditFor = vi.fn();
vi.mock("@/features/audit/server/query", () => ({
  queryAuditFor: (...args: unknown[]) => mockQueryAuditFor(...args),
  queryTraceFor: vi.fn(),
}));

import AuditPage from "@/app/(app)/audit/page";

function session(role: "admin" | "editor" | "viewer", id = "u1") {
  return { sid: "s1", user: { id, email: `${role}@x.com`, role, name: null } };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    actorId: "u1",
    action: "gateway.proxy.ok",
    entityType: "proxy",
    entityId: "magpie:scrape",
    service: "magpie",
    requestId: "req-abc-123",
    before: null,
    after: null,
    metadata: { status: 200, latencyMs: 42 },
    createdAt: new Date(Date.now() - 5000),
    ...overrides,
  };
}

describe("18-audit-page: auth + RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryAuditFor.mockResolvedValue([]);
  });

  it("case 2: admin session renders without forcing actorId", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
    mockQueryAuditFor.mockResolvedValueOnce([event()]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain("Audit");
    expect(html).toContain("gateway.proxy.ok");
    expect(mockQueryAuditFor).toHaveBeenCalled();
  });

  it("case 4: viewer session shows 'scoped to your events' notice", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("viewer"));
    mockQueryAuditFor.mockResolvedValueOnce([]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain("scoped to your events");
  });

  it("unauth → redirects to /login?returnTo=%2Faudit", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { redirect } = await import("next/navigation");
    await expect(AuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT_CALLED",
    );
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Faudit");
  });
});

describe("18-audit-page: filters + rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
  });

  it("case 5: ?service=magpie passes through to queryAuditFor", async () => {
    mockQueryAuditFor.mockResolvedValueOnce([]);
    await AuditPage({ searchParams: Promise.resolve({ service: "magpie" }) });
    expect(mockQueryAuditFor.mock.calls[0][1]).toEqual(
      expect.objectContaining({ service: "magpie" }),
    );
  });

  it("case 6: ?action=gateway. passes through as actionPrefix", async () => {
    mockQueryAuditFor.mockResolvedValueOnce([]);
    await AuditPage({ searchParams: Promise.resolve({ action: "gateway." }) });
    expect(mockQueryAuditFor.mock.calls[0][1]).toEqual(
      expect.objectContaining({ actionPrefix: "gateway." }),
    );
  });

  it("service=all is treated as no filter", async () => {
    mockQueryAuditFor.mockResolvedValueOnce([]);
    await AuditPage({ searchParams: Promise.resolve({ service: "all" }) });
    expect(mockQueryAuditFor.mock.calls[0][1].service).toBeUndefined();
  });

  it("case 7: empty result renders the 'no events match' message", async () => {
    mockQueryAuditFor.mockResolvedValueOnce([]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain("no events match");
  });

  it("case 8: rows with requestId wrap in an audit trace link", async () => {
    mockQueryAuditFor.mockResolvedValueOnce([event({ requestId: "req-link-1" })]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain('href="/audit/req-link-1"');
  });

  it("rows without requestId do NOT wrap in a link", async () => {
    mockQueryAuditFor.mockResolvedValueOnce([event({ requestId: null })]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    // The action text renders, but no /audit/ link is generated for it
    expect(html).not.toContain('href="/audit/null"');
  });

  it("status bar includes event count", async () => {
    mockQueryAuditFor.mockResolvedValueOnce([event(), event({ id: 2 })]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain("2 events");
  });
});
