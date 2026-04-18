import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation's forbidden() so we can detect viewer denial
vi.mock("next/navigation", () => ({
  forbidden: vi.fn(() => {
    throw new Error("FORBIDDEN_CALLED");
  }),
}));

// Mock the underlying queryEvents
const mockQueryEvents = vi.fn();
vi.mock("@/lib/audit/write", () => ({
  queryEvents: (...args: unknown[]) => mockQueryEvents(...args),
  appendEvent: vi.fn().mockResolvedValue(1),
}));

import { queryAuditFor, queryTraceFor } from "@/features/audit/server/query";

function session(role: "admin" | "editor" | "viewer", id = "u1") {
  return {
    sid: "sess-1",
    user: { id, email: `${role}@x.com`, role, name: null },
  };
}

describe("18-audit-query: queryAuditFor role scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryEvents.mockResolvedValue([]);
  });

  it("case 2: admin — no actorId filter applied", async () => {
    await queryAuditFor(session("admin"));
    const opts = mockQueryEvents.mock.calls[0][0];
    expect(opts.actorId).toBeUndefined();
  });

  it("case 3: editor — no actorId filter applied", async () => {
    await queryAuditFor(session("editor"));
    const opts = mockQueryEvents.mock.calls[0][0];
    expect(opts.actorId).toBeUndefined();
  });

  it("case 4: viewer — actorId forced to session user id", async () => {
    await queryAuditFor(session("viewer", "viewer-7"));
    const opts = mockQueryEvents.mock.calls[0][0];
    expect(opts.actorId).toBe("viewer-7");
  });

  it("case 5: service filter passes through", async () => {
    await queryAuditFor(session("admin"), { service: "magpie" });
    const opts = mockQueryEvents.mock.calls[0][0];
    expect(opts.service).toBe("magpie");
  });

  it("case 6: actionPrefix filter passes through", async () => {
    await queryAuditFor(session("admin"), { actionPrefix: "gateway." });
    const opts = mockQueryEvents.mock.calls[0][0];
    expect(opts.actionPrefix).toBe("gateway.");
  });

  it("since filter maps to 'from' option on queryEvents", async () => {
    const since = new Date("2026-04-18T00:00:00Z");
    await queryAuditFor(session("admin"), { since });
    const opts = mockQueryEvents.mock.calls[0][0];
    expect(opts.from).toBe(since);
  });

  it("default limit is 100", async () => {
    await queryAuditFor(session("admin"));
    expect(mockQueryEvents.mock.calls[0][0].limit).toBe(100);
  });

  it("explicit limit is capped at 500", async () => {
    await queryAuditFor(session("admin"), { limit: 10_000 });
    expect(mockQueryEvents.mock.calls[0][0].limit).toBe(500);
  });

  it("returns the events the query produced", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockQueryEvents.mockResolvedValueOnce(rows);
    const result = await queryAuditFor(session("admin"));
    expect(result).toEqual(rows);
  });
});

describe("18-audit-query: queryTraceFor role scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 9: admin sees the trace in ASC order", async () => {
    // queryEvents returns DESC; queryTraceFor reverses
    mockQueryEvents.mockResolvedValueOnce([
      { id: 3, actorId: "u1", createdAt: new Date("2026-04-18T10:00:02Z") },
      { id: 2, actorId: "u1", createdAt: new Date("2026-04-18T10:00:01Z") },
      { id: 1, actorId: "u1", createdAt: new Date("2026-04-18T10:00:00Z") },
    ]);
    const result = await queryTraceFor(session("admin"), "req-1");
    expect(result.map((r: any) => r.id)).toEqual([1, 2, 3]);
  });

  it("case 11: viewer + trace with foreign actor → forbidden() called", async () => {
    mockQueryEvents.mockResolvedValueOnce([
      { id: 1, actorId: "viewer-1", createdAt: new Date() },
      { id: 2, actorId: "someone-else", createdAt: new Date() },
    ]);
    const { forbidden } = await import("next/navigation");
    await expect(queryTraceFor(session("viewer", "viewer-1"), "req-1")).rejects.toThrow(
      "FORBIDDEN_CALLED",
    );
    expect(forbidden).toHaveBeenCalled();
  });

  it("case 12: viewer + trace entirely own events → passes, returns rows", async () => {
    mockQueryEvents.mockResolvedValueOnce([
      { id: 1, actorId: "viewer-1", createdAt: new Date("2026-04-18T10:00:00Z") },
      { id: 2, actorId: "viewer-1", createdAt: new Date("2026-04-18T10:00:01Z") },
    ]);
    const result = await queryTraceFor(session("viewer", "viewer-1"), "req-1");
    expect(result).toHaveLength(2);
  });

  it("case 10: empty trace — returns empty array (404 decision happens in page)", async () => {
    mockQueryEvents.mockResolvedValueOnce([]);
    const result = await queryTraceFor(session("admin"), "req-nonexistent");
    expect(result).toEqual([]);
  });

  it("passes requestId filter to underlying queryEvents", async () => {
    mockQueryEvents.mockResolvedValueOnce([]);
    await queryTraceFor(session("admin"), "my-req-id");
    expect(mockQueryEvents.mock.calls[0][0].requestId).toBe("my-req-id");
  });

  it("viewer + trace with null actorId events (system events) passes", async () => {
    // System events (null actor) don't belong to any other user — viewer should see them.
    mockQueryEvents.mockResolvedValueOnce([
      { id: 1, actorId: "viewer-1", createdAt: new Date() },
      { id: 2, actorId: null, createdAt: new Date() },
    ]);
    const result = await queryTraceFor(session("viewer", "viewer-1"), "req-1");
    expect(result).toHaveLength(2);
  });
});
