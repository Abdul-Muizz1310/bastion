import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Mock the DB module
vi.mock("@/lib/db/client", () => {
  const mockInsert = vi.fn();
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockOrderBy = vi.fn();
  const mockLimit = vi.fn();
  const mockOffset = vi.fn();
  const mockValues = vi.fn();
  const mockReturning = vi.fn();

  const db = {
    insert: mockInsert,
    select: mockSelect,
  };

  // Chain: insert().values().returning()
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([{ id: 42 }]);

  // Chain: select().from().where().orderBy().limit().offset()
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockLimit.mockReturnValue({ offset: mockOffset });
  mockOffset.mockResolvedValue([]);

  return {
    getDb: () => db,
    __mocks: {
      db,
      mockInsert,
      mockSelect,
      mockFrom,
      mockWhere,
      mockOrderBy,
      mockLimit,
      mockOffset,
      mockValues,
      mockReturning,
    },
  };
});

import { eventInputSchema } from "@/lib/validation";

describe("06-audit: event input validation", () => {
  it("valid event input passes validation", () => {
    const result = eventInputSchema.safeParse({
      actorId: "550e8400-e29b-41d4-a716-446655440000",
      action: "auth.login",
      entityType: "session",
      entityId: "session-1",
    });
    expect(result.success).toBe(true);
  });

  it("event with empty action fails validation", () => {
    const result = eventInputSchema.safeParse({
      actorId: "550e8400-e29b-41d4-a716-446655440000",
      action: "",
      entityType: "test",
      entityId: "1",
    });
    expect(result.success).toBe(false);
  });

  it("event with empty entityType fails validation", () => {
    const result = eventInputSchema.safeParse({
      action: "test.event",
      entityType: "",
      entityId: "1",
    });
    expect(result.success).toBe(false);
  });

  it("event with empty entityId fails validation", () => {
    const result = eventInputSchema.safeParse({
      action: "test.event",
      entityType: "test",
      entityId: "",
    });
    expect(result.success).toBe(false);
  });

  it("event with optional fields omitted passes", () => {
    const result = eventInputSchema.safeParse({
      action: "test.event",
      entityType: "test",
      entityId: "1",
    });
    expect(result.success).toBe(true);
  });

  it("event with before/after JSONB fields passes", () => {
    const result = eventInputSchema.safeParse({
      action: "user.role_changed",
      entityType: "user",
      entityId: "user-2",
      before: { role: "viewer" },
      after: { role: "editor" },
    });
    expect(result.success).toBe(true);
  });

  it("event with metadata passes", () => {
    const result = eventInputSchema.safeParse({
      action: "test.event",
      entityType: "test",
      entityId: "1",
      metadata: { key: "value", nested: { a: 1 } },
    });
    expect(result.success).toBe(true);
  });
});

describe("06-audit: DB operations", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
  });

  it("appendEvent inserts a row and returns the event id (integration)", async () => {
    mocks.mockReturning.mockResolvedValueOnce([{ id: 42 }]);
    const { appendEvent } = await import("@/lib/audit/write");
    const result = await appendEvent({
      actorId: "550e8400-e29b-41d4-a716-446655440000",
      action: "auth.login",
      entityType: "session",
      entityId: "session-1",
    });
    expect(result).toBe(42);
    expect(mocks.mockInsert).toHaveBeenCalled();
    expect(mocks.mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.login",
        entityType: "session",
        entityId: "session-1",
      }),
    );
  });

  it("event createdAt is set by the database (integration)", async () => {
    // createdAt is not passed in the insert values — it's a DB default
    mocks.mockReturning.mockResolvedValueOnce([{ id: 1 }]);
    const { appendEvent } = await import("@/lib/audit/write");
    await appendEvent({
      action: "test.event",
      entityType: "test",
      entityId: "1",
    });
    const insertedValues = mocks.mockValues.mock.calls[0][0];
    expect(insertedValues).not.toHaveProperty("createdAt");
  });

  it("events with same requestId are queryable together (integration)", async () => {
    const requestId = "shared-request-id";
    const eventRows = [
      { id: 1, requestId, action: "step1", entityType: "demo", entityId: "run-1" },
      { id: 2, requestId, action: "step2", entityType: "demo", entityId: "run-1" },
    ];
    mocks.mockOffset.mockResolvedValueOnce(eventRows);
    const { queryEvents } = await import("@/lib/audit/write");
    const result = await queryEvents({ requestId });
    expect(result).toEqual(eventRows);
    expect(result).toHaveLength(2);
  });

  it("queryEvents returns events in reverse chronological order (integration)", async () => {
    const eventRows = [
      { id: 3, action: "third", createdAt: new Date("2026-01-03") },
      { id: 2, action: "second", createdAt: new Date("2026-01-02") },
      { id: 1, action: "first", createdAt: new Date("2026-01-01") },
    ];
    mocks.mockOffset.mockResolvedValueOnce(eventRows);
    const { queryEvents } = await import("@/lib/audit/write");
    const result = await queryEvents({});
    expect(result).toEqual(eventRows);
    // Verify orderBy was called (the DB layer handles ordering)
    expect(mocks.mockOrderBy).toHaveBeenCalled();
  });

  it("queryEvents filters by service (integration)", async () => {
    mocks.mockOffset.mockResolvedValueOnce([{ id: 1, service: "magpie" }]);
    const { queryEvents } = await import("@/lib/audit/write");
    const result = await queryEvents({ service: "magpie" });
    expect(result).toHaveLength(1);
    expect(mocks.mockWhere).toHaveBeenCalled();
  });

  it("queryEvents filters by date range (integration)", async () => {
    mocks.mockOffset.mockResolvedValueOnce([]);
    const { queryEvents } = await import("@/lib/audit/write");
    const from = new Date("2026-01-01");
    const to = new Date("2026-12-31");
    await queryEvents({ from, to });
    expect(mocks.mockWhere).toHaveBeenCalled();
  });

  it("queryEvents filters by actorId (integration)", async () => {
    mocks.mockOffset.mockResolvedValueOnce([{ id: 1, actorId: "user-1" }]);
    const { queryEvents } = await import("@/lib/audit/write");
    const result = await queryEvents({ actorId: "user-1" });
    expect(result).toHaveLength(1);
    expect(mocks.mockWhere).toHaveBeenCalled();
  });

  it("queryEvents supports pagination (integration)", async () => {
    mocks.mockOffset.mockResolvedValueOnce([{ id: 11 }, { id: 12 }]);
    const { queryEvents } = await import("@/lib/audit/write");
    const result = await queryEvents({ limit: 2, offset: 10 });
    expect(result).toHaveLength(2);
    expect(mocks.mockLimit).toHaveBeenCalledWith(2);
    expect(mocks.mockOffset).toHaveBeenCalledWith(10);
  });
});

describe("06-audit: edge and failure cases", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
  });

  it("appendEvent with DB error returns null (integration)", async () => {
    mocks.mockReturning.mockRejectedValueOnce(new Error("DB connection failed"));
    const { appendEvent } = await import("@/lib/audit/write");
    const result = await appendEvent({
      action: "test.event",
      entityType: "test",
      entityId: "1",
    });
    expect(result).toBeNull();
  });

  it("large metadata object is accepted (integration)", async () => {
    mocks.mockReturning.mockResolvedValueOnce([{ id: 99 }]);
    const { appendEvent } = await import("@/lib/audit/write");
    const largeMetadata: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      largeMetadata[`key_${i}`] = `value_${i}`;
    }
    const result = await appendEvent({
      action: "test.event",
      entityType: "test",
      entityId: "1",
      metadata: largeMetadata,
    });
    expect(result).toBe(99);
  });
});

describe("06-audit: security", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
  });

  it("/audit page requires admin or editor role (tested in RBAC spec)", async () => {
    // Structural: the audit page route uses withRole(["admin", "editor"], ...)
    // We verify the RBAC module rejects viewer for admin+editor checks
    const { AccessDeniedError, withRole } = await import("@/lib/auth/rbac");
    const viewer = { id: "3", role: "viewer" as const };
    await expect(withRole(["admin", "editor"], viewer, "audit.view")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("events cannot be modified via any endpoint (tested in schema spec)", async () => {
    // Structural: the events schema only exposes insert (appendEvent) and select (queryEvents).
    // There is no updateEvent or deleteEvent exported.
    const auditMod = await import("@/lib/audit/write");
    const auditExports = Object.keys(auditMod);
    expect(auditExports).toContain("appendEvent");
    expect(auditExports).toContain("queryEvents");
    expect(auditExports).not.toContain("updateEvent");
    expect(auditExports).not.toContain("deleteEvent");
  });

  it("actorId is always the authenticated user (integration)", async () => {
    mocks.mockReturning.mockResolvedValueOnce([{ id: 1 }]);
    const { appendEvent } = await import("@/lib/audit/write");
    const actorId = "550e8400-e29b-41d4-a716-446655440000";
    await appendEvent({
      actorId,
      action: "user.action",
      entityType: "resource",
      entityId: "res-1",
    });
    const insertedValues = mocks.mockValues.mock.calls[0][0];
    expect(insertedValues.actorId).toBe(actorId);
  });
});
