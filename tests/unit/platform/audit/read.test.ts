import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit pages' reader (spec 21 §3.2): its contract refuses a limit or cursor it cannot honour
 * before touching the database. Its SQL is checked against a real Postgres in
 * tests/integration/db/audit-read.test.ts; here only the boundary and the read's shape.
 */

const chain = vi.hoisted(() => {
  const limit = vi.fn().mockResolvedValue([]);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn((_columns: Record<string, unknown>) => ({ from }));
  return { select, from, where, orderBy, limit };
});

vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select: chain.select }) }));

import { readEvents } from "@/platform/audit/read";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readEvents: the boundary", () => {
  it.each([0, -1, 1.5, 1002, Number.NaN])("refuses a limit of %s before reading", async (limit) => {
    await expect(readEvents({ limit, order: "newest" })).rejects.toThrow(RangeError);
    expect(chain.select).not.toHaveBeenCalled();
  });

  it.each([0, -3, 2.5])("refuses a cursor of %s before reading", async (beforeId) => {
    await expect(readEvents({ beforeId, limit: 10, order: "newest" })).rejects.toThrow(RangeError);
    expect(chain.select).not.toHaveBeenCalled();
  });
});

describe("readEvents: the read", () => {
  it("selects the columns the views show — never before or after — and applies the limit", async () => {
    await readEvents({ service: "magpie", actionPrefix: "gateway.", beforeId: 9, limit: 51, order: "newest" });
    const columns = Object.keys(chain.select.mock.calls[0]?.[0] ?? {});
    expect(columns.sort()).toEqual(
      ["action", "actor", "actorId", "createdAt", "entityId", "entityType", "id", "metadata", "requestId", "service"].sort(),
    );
    expect(columns).not.toContain("before");
    expect(columns).not.toContain("after");
    expect(chain.limit).toHaveBeenCalledWith(51);
  });

  it("orders newest by id alone, oldest by time then id", async () => {
    await readEvents({ limit: 5, order: "newest" });
    await readEvents({ requestId: "req-1", limit: 5, order: "oldest" });
    const orderBy = chain.orderBy.mock.calls as unknown[][];
    expect(orderBy[0]).toHaveLength(1);
    expect(orderBy[1]).toHaveLength(2);
  });
});
