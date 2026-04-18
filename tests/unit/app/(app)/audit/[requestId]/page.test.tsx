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

const mockQueryTraceFor = vi.fn();
vi.mock("@/features/audit/server/query", () => ({
  queryAuditFor: vi.fn(),
  queryTraceFor: (...args: unknown[]) => mockQueryTraceFor(...args),
}));

import TracePage from "@/app/(app)/audit/[requestId]/page";

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
    requestId: "req-abc",
    before: null,
    after: null,
    metadata: { status: 200, latencyMs: 42 },
    createdAt: new Date("2026-04-18T10:00:00Z"),
    ...overrides,
  };
}

describe("18-trace-page: auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauth → redirects to /login with returnTo", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { redirect } = await import("next/navigation");
    await expect(
      TracePage({ params: Promise.resolve({ requestId: "req-abc" }) }),
    ).rejects.toThrow("REDIRECT_CALLED");
    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining("returnTo=%2Faudit%2Freq-abc"),
    );
  });
});

describe("18-trace-page: happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
  });

  it("case 9: admin + matching trace renders waterfall", async () => {
    mockQueryTraceFor.mockResolvedValueOnce([
      event({ id: 1, action: "dossier.created", service: "bastion", createdAt: new Date("2026-04-18T10:00:00Z") }),
      event({ id: 2, action: "gateway.proxy.ok", service: "magpie", createdAt: new Date("2026-04-18T10:00:01Z") }),
      event({ id: 3, action: "gateway.proxy.ok", service: "inkprint", createdAt: new Date("2026-04-18T10:00:02Z") }),
    ]);
    const el = await TracePage({ params: Promise.resolve({ requestId: "req-abc" }) });
    const html = renderToString(el);
    expect(html).toContain("dossier.created");
    expect(html).toContain("gateway.proxy.ok");
    expect(html).toContain("magpie");
    expect(html).toContain("inkprint");
  });

  it("case 13: renders total latency from first/last timestamps", async () => {
    mockQueryTraceFor.mockResolvedValueOnce([
      event({ id: 1, createdAt: new Date("2026-04-18T10:00:00.000Z") }),
      event({ id: 2, createdAt: new Date("2026-04-18T10:00:02.500Z") }),
    ]);
    const el = await TracePage({ params: Promise.resolve({ requestId: "req-abc" }) });
    const html = renderToString(el);
    expect(html).toContain("2.50s");
  });

  it("case 10: empty trace → notFound()", async () => {
    mockQueryTraceFor.mockResolvedValueOnce([]);
    const { notFound } = await import("next/navigation");
    await expect(
      TracePage({ params: Promise.resolve({ requestId: "req-empty" }) }),
    ).rejects.toThrow("NOT_FOUND_CALLED");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders 'back to audit log' link", async () => {
    mockQueryTraceFor.mockResolvedValueOnce([event()]);
    const el = await TracePage({ params: Promise.resolve({ requestId: "req-abc" }) });
    const html = renderToString(el);
    expect(html).toContain("back to audit log");
    expect(html).toContain('href="/audit"');
  });

  it("shows first 8 chars of requestId in status bar + heading", async () => {
    mockQueryTraceFor.mockResolvedValueOnce([event({ requestId: "550e8400-e29b-41d4-a716-446655440000" })]);
    const el = await TracePage({
      params: Promise.resolve({ requestId: "550e8400-e29b-41d4-a716-446655440000" }),
    });
    const html = renderToString(el);
    expect(html).toContain("550e8400");
  });
});

describe("18-trace-page: RBAC (delegated to queryTraceFor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("viewer"));
  });

  it("case 11: viewer + foreign-actor trace → forbidden propagates from queryTraceFor", async () => {
    mockQueryTraceFor.mockRejectedValueOnce(new Error("FORBIDDEN_CALLED"));
    await expect(
      TracePage({ params: Promise.resolve({ requestId: "req-abc" }) }),
    ).rejects.toThrow("FORBIDDEN_CALLED");
  });
});
