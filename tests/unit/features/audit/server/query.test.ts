import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredEvent } from "@/platform/audit/read";

/**
 * Spec 21 §3.2: the audit log is public — every visitor reads the same rows, so nothing here is
 * scoped by actor (invariant 1) — read newest first by id, one row past the page.
 */

const readEvents = vi.fn();
vi.mock("@/platform/audit/read", () => ({
  readEvents: (...args: unknown[]) => readEvents(...args),
}));

import { listAudit, requestTrace, TRACE_LIMIT } from "@/features/audit/server/query";

function stored(id: number, more: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id,
    actor: "bastion",
    actorId: null,
    action: "gateway.call",
    entityType: "capability",
    entityId: "magpie.scrape",
    service: "magpie",
    requestId: "req-1",
    metadata: {},
    createdAt: new Date(Date.UTC(2026, 9, 20, 9, 0, id)),
    ...more,
  };
}

beforeEach(() => {
  readEvents.mockReset();
  readEvents.mockResolvedValue([]);
});

describe("listAudit", () => {
  it("reads one row past the page, newest first, with no actor filter (invariant 1)", async () => {
    await listAudit({ filters: {}, before: null });
    expect(readEvents).toHaveBeenCalledWith({ limit: 51, order: "newest" });
    expect(readEvents.mock.calls[0]?.[0]).not.toHaveProperty("actor");
  });

  it("passes the filters and the cursor through", async () => {
    await listAudit({
      filters: { service: "inkprint", action: "dossier.", request: "req-9" },
      before: 120,
    });
    expect(readEvents).toHaveBeenCalledWith({
      service: "inkprint",
      actionPrefix: "dossier.",
      requestId: "req-9",
      beforeId: 120,
      limit: 51,
      order: "newest",
    });
  });

  it("returns the page as views and the cursor for older", async () => {
    readEvents.mockResolvedValueOnce(Array.from({ length: 51 }, (_, i) => stored(200 - i)));
    const page = await listAudit({ filters: {}, before: null });
    expect(page.events).toHaveLength(50);
    expect(page.events[0]?.id).toBe(200);
    expect(page.older).toBe(151);
    expect(page.events[0]).not.toHaveProperty("metadata");
  });

  it("lets a read failure reach the caller (the page says the log is unavailable)", async () => {
    readEvents.mockRejectedValueOnce(new Error("connection refused"));
    await expect(listAudit({ filters: {}, before: null })).rejects.toThrow("connection refused");
  });
});

describe("requestTrace", () => {
  it("reads the request oldest first, one past the limit", async () => {
    await requestTrace("req-1");
    expect(readEvents).toHaveBeenCalledWith({
      requestId: "req-1",
      limit: TRACE_LIMIT + 1,
      order: "oldest",
    });
    expect(TRACE_LIMIT).toBe(500);
  });

  it("returns every event of a short request, untruncated", async () => {
    readEvents.mockResolvedValueOnce([stored(1), stored(2, { actor: "v_kk6eooepno" })]);
    const trace = await requestTrace("req-1");
    expect(trace.events.map((e) => e.id)).toEqual([1, 2]);
    expect(trace.truncated).toBe(false);
  });

  it("keeps the first 500 of a longer one and says it was cut", async () => {
    readEvents.mockResolvedValueOnce(Array.from({ length: 501 }, (_, i) => stored(i + 1)));
    const trace = await requestTrace("req-1");
    expect(trace.events).toHaveLength(500);
    expect(trace.events.at(-1)?.id).toBe(500);
    expect(trace.truncated).toBe(true);
  });
});
