import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
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

const mockQueryAudit = vi.fn();
vi.mock("@/features/audit/server/query", () => ({
  queryAudit: (...args: unknown[]) => mockQueryAudit(...args),
  queryTrace: vi.fn(),
}));

import AuditPage from "@/app/(app)/audit/page";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    actorId: null,
    actor: "v_kk6eooepno",
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

describe("18-audit-page: public (spec 21 §2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryAudit.mockResolvedValue([]);
  });

  it("case 2: renders for an anonymous visitor without redirecting", async () => {
    mockQueryAudit.mockResolvedValueOnce([event()]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain("Audit");
    expect(html).toContain("gateway.proxy.ok");
    expect(mockQueryAudit).toHaveBeenCalled();
  });

  it("shows no role and no 'scoped to your events' notice — everyone reads the same log", async () => {
    const html = renderToString(await AuditPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("scoped to your events");
    expect(html).not.toContain("role ·");
  });
});

describe("18-audit-page: the actor column", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a visitor id as the actor", async () => {
    mockQueryAudit.mockResolvedValueOnce([event({ actor: "v_kk6eooepno" })]);
    const html = renderToString(await AuditPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("v_kk6eooepno");
  });

  it("shows system work as bastion", async () => {
    mockQueryAudit.mockResolvedValueOnce([event({ actor: "bastion" })]);
    const html = renderToString(await AuditPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(">bastion<");
  });

  it("falls back to the first 8 chars of a v1 row's actor_id", async () => {
    mockQueryAudit.mockResolvedValueOnce([
      event({ actor: null, actorId: "550e8400-e29b-41d4-a716-446655440000" }),
    ]);
    const html = renderToString(await AuditPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("550e8400");
    expect(html).not.toContain("550e8400-e29b");
  });

  it("shows 'system' for a v1 row with no actor at all", async () => {
    mockQueryAudit.mockResolvedValueOnce([event({ actor: null, actorId: null })]);
    const html = renderToString(await AuditPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(">system<");
  });
});

describe("18-audit-page: filters + rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 5: ?service=magpie passes through to queryAudit", async () => {
    mockQueryAudit.mockResolvedValueOnce([]);
    await AuditPage({ searchParams: Promise.resolve({ service: "magpie" }) });
    expect(mockQueryAudit.mock.calls[0][0]).toEqual(expect.objectContaining({ service: "magpie" }));
  });

  it("case 6: ?action=gateway. passes through as actionPrefix", async () => {
    mockQueryAudit.mockResolvedValueOnce([]);
    await AuditPage({ searchParams: Promise.resolve({ action: "gateway." }) });
    expect(mockQueryAudit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ actionPrefix: "gateway." }),
    );
  });

  it("service=all is treated as no filter", async () => {
    mockQueryAudit.mockResolvedValueOnce([]);
    await AuditPage({ searchParams: Promise.resolve({ service: "all" }) });
    expect(mockQueryAudit.mock.calls[0][0].service).toBeUndefined();
  });

  it("case 7: empty result renders the 'no events match' message", async () => {
    mockQueryAudit.mockResolvedValueOnce([]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain("no events match");
  });

  it("case 8: rows with requestId wrap in an audit trace link", async () => {
    mockQueryAudit.mockResolvedValueOnce([event({ requestId: "req-link-1" })]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain('href="/audit/req-link-1"');
  });

  it("rows without requestId do NOT wrap in a link", async () => {
    mockQueryAudit.mockResolvedValueOnce([event({ requestId: null })]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    // The action text renders, but no /audit/ link is generated for it
    expect(html).not.toContain('href="/audit/null"');
  });

  it("status bar includes event count", async () => {
    mockQueryAudit.mockResolvedValueOnce([event(), event({ id: 2 })]);
    const el = await AuditPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(el);
    expect(html).toContain("2 events");
  });
});
