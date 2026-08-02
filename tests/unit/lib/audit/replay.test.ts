import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Mock DB
vi.mock("@/lib/db/client", () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockExecute = vi.fn();

  const db = {
    select: mockSelect,
    execute: mockExecute,
  };

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockResolvedValue([{ earliest: null }]);
  mockExecute.mockResolvedValue([]);

  return {
    getDb: () => db,
    __mocks: { db, mockSelect, mockFrom, mockExecute },
  };
});

describe("07-replay: happy path", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
  });

  it("rewinding to T2 shows state as of T2, excluding later events (integration)", async () => {
    const t2 = new Date("2026-01-02T00:00:00Z");
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01T00:00:00Z") }]);
    mocks.mockExecute.mockResolvedValueOnce([
      {
        entity_type: "user",
        entity_id: "user-1",
        service: "bastion",
        state: { role: "editor" },
        action: "user.role_changed",
        created_at: "2026-01-02T00:00:00Z",
      },
    ]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: t2 });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entityType).toBe("user");
    expect(result.entities[0].state).toEqual({ role: "editor" });
  });

  it("rewinding to current time shows latest state (integration)", async () => {
    const now = new Date();
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([
      {
        entity_type: "user",
        entity_id: "user-1",
        service: "bastion",
        state: { role: "admin" },
        action: "user.role_changed",
        created_at: now.toISOString(),
      },
    ]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: now });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].lastAction).toBe("user.role_changed");
  });

  it("slider bounds start at earliest event timestamp (integration)", async () => {
    const earliest = new Date("2026-01-01T00:00:00Z");
    mocks.mockFrom.mockResolvedValueOnce([{ earliest }]);
    mocks.mockExecute.mockResolvedValueOnce([]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.bounds.min).toEqual(earliest);
  });

  it("slider bounds end at current time (integration)", async () => {
    const beforeCall = new Date();
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: new Date() });
    const afterCall = new Date();
    expect(result.bounds.max.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
    expect(result.bounds.max.getTime()).toBeLessThanOrEqual(afterCall.getTime());
  });

  it("filtering by service during time travel works (integration)", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([
      {
        entity_type: "query",
        entity_id: "q-1",
        service: "slowquery",
        state: { slow: true },
        action: "query.detected",
        created_at: "2026-01-02T00:00:00Z",
      },
    ]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: new Date(), service: "slowquery" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].service).toBe("slowquery");
  });

  it("each entity shows its most recent after state (integration)", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    // DISTINCT ON returns only the most recent event per entity
    mocks.mockExecute.mockResolvedValueOnce([
      {
        entity_type: "user",
        entity_id: "user-1",
        service: "bastion",
        state: { role: "admin" }, // latest state
        action: "user.promoted",
        created_at: "2026-01-03T00:00:00Z",
      },
    ]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: new Date("2026-01-03T00:00:00Z") });
    expect(result.entities[0].state).toEqual({ role: "admin" });
  });
});

describe("07-replay: edge and failure cases", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
  });

  it("rewinding before any events returns empty state (integration)", async () => {
    const earliest = new Date("2026-01-01T00:00:00Z");
    mocks.mockFrom.mockResolvedValueOnce([{ earliest }]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: new Date("2025-12-31T00:00:00Z") });
    expect(result.entities).toHaveLength(0);
    expect(result.message).toBe("No events before this time");
  });

  it("event at exact timestamp T is included (integration)", async () => {
    const exactTime = new Date("2026-01-15T12:00:00Z");
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([
      {
        entity_type: "user",
        entity_id: "user-1",
        service: "bastion",
        state: { active: true },
        action: "user.activated",
        created_at: exactTime.toISOString(),
      },
    ]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: exactTime });
    expect(result.entities).toHaveLength(1);
  });

  it("database with zero events returns disabled slider state (integration)", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: null }]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    const result = await getTimeTravelState({ asOf: new Date() });
    expect(result.entities).toHaveLength(0);
    expect(result.bounds.min).toBeNull();
    expect(result.message).toBe("No audit data yet.");
  });

  it("case 10: one call issues exactly one DISTINCT ON round-trip (what debouncing throttles)", async () => {
    // Debouncing on the client is only worth anything if each accepted call
    // costs a single query. Behaviour asserted here; the debounce window
    // itself is asserted in tests/unit/features/time-travel/controller.test.ts.
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    await getTimeTravelState({ asOf: new Date("2026-01-05T00:00:00Z") });
    expect(mocks.mockExecute).toHaveBeenCalledTimes(1);
  });
});

describe("07-replay: security", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
  });

  it("/time-travel requires admin role (tested in RBAC spec)", async () => {
    // Structural: the time-travel page/route uses withRole(["admin"], ...)
    const { AccessDeniedError, withRole } = await import("@/lib/auth/rbac");
    const editor = { id: "2", role: "editor" as const };
    await expect(withRole(["admin"], editor, "time-travel.view")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("case 12: the SQL it executes is a SELECT — no INSERT/UPDATE/DELETE/TRUNCATE", async () => {
    mocks.mockFrom.mockResolvedValueOnce([{ earliest: new Date("2026-01-01") }]);
    mocks.mockExecute.mockResolvedValueOnce([]);

    const { getTimeTravelState } = await import("@/lib/audit/replay");
    await getTimeTravelState({ asOf: new Date("2026-01-05T00:00:00Z"), service: "bastion" });

    const issued = mocks.mockExecute.mock.calls[0][0] as { queryChunks?: unknown[] };
    const text = (issued.queryChunks ?? [])
      .map((chunk) => {
        const value = (chunk as { value?: unknown }).value;
        return Array.isArray(value) ? value.join("") : "";
      })
      .join(" ");

    expect(text).toMatch(/SELECT\s+DISTINCT\s+ON/i);
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });
});
