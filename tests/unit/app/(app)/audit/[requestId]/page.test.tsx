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

const mockQueryTrace = vi.fn();
vi.mock("@/features/audit/server/query", () => ({
  queryAudit: vi.fn(),
  queryTrace: (...args: unknown[]) => mockQueryTrace(...args),
}));

import TracePage from "@/app/(app)/audit/[requestId]/page";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    actorId: null,
    actor: "v_kk6eooepno",
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

describe("18-trace-page: public (spec 21 §2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders for an anonymous visitor without redirecting", async () => {
    mockQueryTrace.mockResolvedValueOnce([event()]);
    const { redirect } = await import("next/navigation");
    const html = renderToString(
      await TracePage({ params: Promise.resolve({ requestId: "req-abc" }) }),
    );
    expect(html).toContain("gateway.proxy.ok");
    expect(redirect).not.toHaveBeenCalled();
    expect(mockQueryTrace).toHaveBeenCalledWith("req-abc");
  });
});

describe("18-trace-page: happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 9: a matching trace renders the waterfall", async () => {
    mockQueryTrace.mockResolvedValueOnce([
      event({
        id: 1,
        action: "dossier.created",
        service: "bastion",
        createdAt: new Date("2026-04-18T10:00:00Z"),
      }),
      event({
        id: 2,
        action: "gateway.proxy.ok",
        service: "magpie",
        createdAt: new Date("2026-04-18T10:00:01Z"),
      }),
      event({
        id: 3,
        action: "gateway.proxy.ok",
        service: "inkprint",
        createdAt: new Date("2026-04-18T10:00:02Z"),
      }),
    ]);
    const el = await TracePage({ params: Promise.resolve({ requestId: "req-abc" }) });
    const html = renderToString(el);
    expect(html).toContain("dossier.created");
    expect(html).toContain("gateway.proxy.ok");
    expect(html).toContain("magpie");
    expect(html).toContain("inkprint");
  });

  it("case 13: renders total latency from first/last timestamps", async () => {
    mockQueryTrace.mockResolvedValueOnce([
      event({ id: 1, createdAt: new Date("2026-04-18T10:00:00.000Z") }),
      event({ id: 2, createdAt: new Date("2026-04-18T10:00:02.500Z") }),
    ]);
    const el = await TracePage({ params: Promise.resolve({ requestId: "req-abc" }) });
    const html = renderToString(el);
    expect(html).toContain("2.50s");
  });

  it("case 10: empty trace → notFound()", async () => {
    mockQueryTrace.mockResolvedValueOnce([]);
    const { notFound } = await import("next/navigation");
    await expect(
      TracePage({ params: Promise.resolve({ requestId: "req-empty" }) }),
    ).rejects.toThrow("NOT_FOUND_CALLED");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders 'back to audit log' link", async () => {
    mockQueryTrace.mockResolvedValueOnce([event()]);
    const el = await TracePage({ params: Promise.resolve({ requestId: "req-abc" }) });
    const html = renderToString(el);
    expect(html).toContain("back to audit log");
    expect(html).toContain('href="/audit"');
  });

  it("shows first 8 chars of requestId in status bar + heading", async () => {
    mockQueryTrace.mockResolvedValueOnce([
      event({ requestId: "550e8400-e29b-41d4-a716-446655440000" }),
    ]);
    const el = await TracePage({
      params: Promise.resolve({ requestId: "550e8400-e29b-41d4-a716-446655440000" }),
    });
    const html = renderToString(el);
    expect(html).toContain("550e8400");
  });
});
