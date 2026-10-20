import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

/**
 * Spec 07 (replay) as spec 21 §3.2 amends it: the DISTINCT ON query reconstructs every entity the log
 * holds at T — dossiers, capabilities, v1's types — reads the columns the page shows plus the
 * metadata its known fields come from, and never `before` or `after`.
 */

vi.mock("@/lib/db/client", () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockExecute = vi.fn();
  const db = { select: mockSelect, execute: mockExecute };
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockResolvedValue([{ earliest: null }]);
  mockExecute.mockResolvedValue([]);
  return { getDb: () => db, __mocks: { db, mockSelect, mockFrom, mockExecute } };
});

import { getTimeTravelState, REPLAY_LIMIT } from "@/lib/audit/replay";

const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";

function row(overrides: Record<string, unknown> = {}) {
  return {
    entity_type: "dossier",
    entity_id: DOSSIER,
    service: "bastion",
    action: "dossier.stage.ok",
    created_at: "2026-01-02T00:00:00.000Z",
    request_id: "req-1",
    actor: "bastion",
    actor_id: null,
    metadata: { stage: "seal", attempt: 1 },
    ...overrides,
  };
}

/** The SQL text of a drizzle `sql` template, nested templates included (parameters left out). */
function sqlText(call: unknown): string {
  const issued = call as { queryChunks?: unknown[] };
  return (issued.queryChunks ?? [])
    .map((chunk) => {
      if ((chunk as { queryChunks?: unknown }).queryChunks) return sqlText(chunk);
      const value = (chunk as { value?: unknown }).value;
      return Array.isArray(value) ? value.join("") : "";
    })
    .join(" ");
}

let mocks: Record<string, Mock>;

beforeEach(async () => {
  vi.clearAllMocks();
  const dbMod = await import("@/lib/db/client");
  mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
  mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
});

describe("07-replay: happy path", () => {
  it("case 1: rewinding to T reconstructs each entity from its latest event up to T", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01T00:00:00Z") }]);
    mocks.mockExecute.mockResolvedValueOnce([row()]);
    const result = await getTimeTravelState({ asOf: new Date("2026-01-02T00:00:00Z") });
    expect(result.entities).toEqual([
      {
        entityType: "dossier",
        entityId: DOSSIER,
        service: "bastion",
        lastAction: "dossier.stage.ok",
        lastEventAt: new Date("2026-01-02T00:00:00.000Z"),
        requestId: "req-1",
        actor: "bastion",
        actorId: null,
        metadata: { stage: "seal", attempt: 1 },
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("holds every entity type the log has: dossiers, capabilities and v1's", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([
      row(),
      row({ entity_type: "capability", entity_id: "magpie.scrape", service: "magpie" }),
      row({ entity_type: "user", entity_id: "user-1", actor: null, actor_id: DOSSIER }),
    ]);
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.entities.map((e) => e.entityType)).toEqual(["dossier", "capability", "user"]);
    expect(result.entities[2]).toMatchObject({ actor: null, actorId: DOSSIER });
  });

  it("case 3: the slider's lower bound is the earliest event", async () => {
    const earliest = new Date("2026-01-01T00:00:00Z");
    mocks.mockFrom.mockResolvedValueOnce([{ earliest }]);
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.bounds.min).toEqual(earliest);
  });

  it("case 4: the slider's upper bound is now", async () => {
    const before = Date.now();
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.bounds.max.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.bounds.max.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("case 5: a service filter narrows the query", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    await getTimeTravelState({ asOf: new Date(), service: "slowquery" });
    const issued = mocks.mockExecute.mock.calls[0]?.[0] as { queryChunks: unknown[] };
    expect(sqlText(issued)).toMatch(/AND service =/);
    expect(JSON.stringify(issued.queryChunks)).toContain("slowquery");
  });

  it("accepts a created_at the driver hands back as a Date", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([row({ created_at: new Date("2026-01-03T00:00:00Z") })]);
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.entities[0]?.lastEventAt).toEqual(new Date("2026-01-03T00:00:00Z"));
  });
});

describe("07-replay: edge and failure cases", () => {
  it("case 7: rewinding before any events returns an empty state and says so", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01T00:00:00Z") }]);
    const result = await getTimeTravelState({ asOf: new Date("2025-12-31T00:00:00Z") });
    expect(result.entities).toHaveLength(0);
    expect(result.message).toBe("No events before this time");
    expect(mocks.mockExecute).not.toHaveBeenCalled();
  });

  it("hands the bound to the driver as ISO text: a Date in a raw sql template fails at runtime", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    const asOf = new Date("2026-01-15T12:00:00.000Z");
    await getTimeTravelState({ asOf });
    const chunks = (mocks.mockExecute.mock.calls[0]?.[0] as { queryChunks: unknown[] }).queryChunks;
    expect(chunks).toContain("2026-01-15T12:00:00.000Z");
    expect(chunks.some((c) => c instanceof Date)).toBe(false);
  });

  it("case 8: the bound is inclusive (<=)", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    await getTimeTravelState({ asOf: new Date("2026-01-15T12:00:00Z") });
    expect(sqlText(mocks.mockExecute.mock.calls[0]?.[0])).toMatch(/created_at <=/);
  });

  it("case 9: an empty log disables the slider", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: null }]);
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.entities).toHaveLength(0);
    expect(result.bounds.min).toBeNull();
    expect(result.message).toBe("No audit data yet.");
  });

  it("case 10: one call issues exactly one DISTINCT ON round-trip", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    await getTimeTravelState({ asOf: new Date("2026-01-05T00:00:00Z") });
    expect(mocks.mockExecute).toHaveBeenCalledTimes(1);
  });

  it(`keeps the first ${1000} entities and says the rest were cut`, async () => {
    expect(REPLAY_LIMIT).toBe(1000);
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce(
      Array.from({ length: REPLAY_LIMIT + 1 }, (_, i) => row({ entity_id: `e-${i}` })),
    );
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.entities).toHaveLength(REPLAY_LIMIT);
    expect(result.truncated).toBe(true);
    expect(sqlText(mocks.mockExecute.mock.calls[0]?.[0])).toMatch(/LIMIT/);
  });

  it("refuses a row in a shape it does not expect, rather than casting it", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([row({ entity_id: 42 })]);
    await expect(getTimeTravelState({ asOf: new Date() })).rejects.toThrow();
  });
});

describe("07-replay: security", () => {
  it("case 12: the SQL it executes is a SELECT — no INSERT/UPDATE/DELETE/TRUNCATE", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    await getTimeTravelState({ asOf: new Date("2026-01-05T00:00:00Z"), service: "bastion" });
    const text = sqlText(mocks.mockExecute.mock.calls[0]?.[0]);
    expect(text).toMatch(/SELECT\s+DISTINCT\s+ON/i);
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it("never reads before or after (spec 21 §3.2 invariant 6)", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    await getTimeTravelState({ asOf: new Date() });
    const text = sqlText(mocks.mockExecute.mock.calls[0]?.[0]);
    expect(text).not.toMatch(/"?\bafter\b"?|"?\bbefore\b"?/);
  });
});
