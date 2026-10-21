import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit-log reader the receipts use (spec 21 §6.1, §6.5): a request's events by id. Its SQL
 * (filter, bound, order) is proven against Postgres in tests/integration/db/receipts.test.ts; here
 * `getDb()` is a fake, to pin the guards that keep a malformed bound from ever reaching SQL.
 */

const fake = vi.hoisted(() => ({ rows: [] as unknown[], selects: 0, ordered: false }));

vi.mock("@/lib/db/client", () => {
  const db = {
    select: () => {
      fake.selects += 1;
      const query = {
        from: () => query,
        where: () => query,
        orderBy: () => {
          fake.ordered = true;
          return Promise.resolve(fake.rows);
        },
      };
      return query;
    },
  };
  return { getDb: () => db };
});

import { requestEvents } from "@/platform/audit/request-events";

beforeEach(() => {
  fake.rows = [];
  fake.selects = 0;
  fake.ordered = false;
});

describe("requestEvents", () => {
  it("returns the rows the ordered query answers", async () => {
    const at = new Date("2026-10-20T10:00:00Z");
    fake.rows = [
      { id: 1, action: "gateway.call", service: "magpie", createdAt: at },
      { id: 2, action: "dossier.stage.ok", service: null, createdAt: at },
    ];
    expect(await requestEvents("req-1")).toEqual(fake.rows);
    expect(await requestEvents("req-1", 2)).toEqual(fake.rows);
    expect(fake.ordered).toBe(true);
  });

  it.each(["", "   "])("refuses the blank request id %j before any query", async (id) => {
    await expect(requestEvents(id)).rejects.toThrow(RangeError);
    expect(fake.selects).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN, 2 ** 53])("refuses the bound %s before any query", async (upTo) => {
    await expect(requestEvents("req-1", upTo)).rejects.toThrow(RangeError);
    expect(fake.selects).toBe(0);
  });

  it("accepts the bound 0 (no event has id 0)", async () => {
    expect(await requestEvents("req-1", 0)).toEqual([]);
  });
});
