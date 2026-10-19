import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 18 / spec 21 §2 — the audit log is public: every visitor reads the same log, so there is
 * no role scoping and no actor filter forced on anyone.
 */

const mockQueryEvents = vi.fn();
vi.mock("@/platform/audit/write", () => ({
  queryEvents: (...args: unknown[]) => mockQueryEvents(...args),
  appendEvent: vi.fn().mockResolvedValue(1),
}));

import { queryAudit, queryTrace } from "@/features/audit/server/query";

describe("18-audit-query: queryAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryEvents.mockResolvedValue([]);
  });

  it("no actor filter is applied — the log is the same for every visitor", async () => {
    await queryAudit();
    const opts = mockQueryEvents.mock.calls[0][0];
    expect(opts.actor).toBeUndefined();
    expect(opts).not.toHaveProperty("actorId");
  });

  it("case 5: service filter passes through", async () => {
    await queryAudit({ service: "magpie" });
    expect(mockQueryEvents.mock.calls[0][0].service).toBe("magpie");
  });

  it("case 6: actionPrefix filter passes through", async () => {
    await queryAudit({ actionPrefix: "gateway." });
    expect(mockQueryEvents.mock.calls[0][0].actionPrefix).toBe("gateway.");
  });

  it("since filter maps to 'from' option on queryEvents", async () => {
    const since = new Date("2026-04-18T00:00:00Z");
    await queryAudit({ since });
    expect(mockQueryEvents.mock.calls[0][0].from).toBe(since);
  });

  it("default limit is 100", async () => {
    await queryAudit();
    expect(mockQueryEvents.mock.calls[0][0].limit).toBe(100);
  });

  it("explicit limit is capped at 500", async () => {
    await queryAudit({ limit: 10_000 });
    expect(mockQueryEvents.mock.calls[0][0].limit).toBe(500);
  });

  it("returns the events the query produced", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockQueryEvents.mockResolvedValueOnce(rows);
    expect(await queryAudit()).toEqual(rows);
  });
});

describe("18-audit-query: queryTrace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 9: returns the trace in ASC order", async () => {
    // queryEvents returns DESC; queryTrace reverses
    mockQueryEvents.mockResolvedValueOnce([
      { id: 3, createdAt: new Date("2026-04-18T10:00:02Z") },
      { id: 2, createdAt: new Date("2026-04-18T10:00:01Z") },
      { id: 1, createdAt: new Date("2026-04-18T10:00:00Z") },
    ]);
    const result = await queryTrace("req-1");
    expect(result.map((r: { id: number }) => r.id)).toEqual([1, 2, 3]);
  });

  it("a trace mixing visitors and system work is returned whole", async () => {
    mockQueryEvents.mockResolvedValueOnce([
      { id: 2, actor: "bastion", createdAt: new Date() },
      { id: 1, actor: "v_kk6eooepno", createdAt: new Date() },
    ]);
    expect(await queryTrace("req-1")).toHaveLength(2);
  });

  it("case 10: empty trace — returns empty array (404 decision happens in page)", async () => {
    mockQueryEvents.mockResolvedValueOnce([]);
    expect(await queryTrace("req-nonexistent")).toEqual([]);
  });

  it("passes requestId filter to underlying queryEvents", async () => {
    mockQueryEvents.mockResolvedValueOnce([]);
    await queryTrace("my-req-id");
    expect(mockQueryEvents.mock.calls[0][0].requestId).toBe("my-req-id");
    expect(mockQueryEvents.mock.calls[0][0].limit).toBe(500);
  });
});
