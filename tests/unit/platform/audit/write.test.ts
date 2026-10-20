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

import { eventInputSchema } from "@/platform/audit/event";
import { visitorId } from "@/platform/visitor";

/** A real, branded visitor id (it is "v_kk6eooepno"), derived rather than cast. */
const VISITOR = visitorId("203.0.113.7", "2026-10-20", new Uint8Array(32).fill(7));

describe("06-audit: event input validation", () => {
  it("valid event input passes validation", () => {
    const result = eventInputSchema.safeParse({
      actor: VISITOR,
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.sources",
    });
    expect(result.success).toBe(true);
  });

  it("the system actor `bastion` passes validation", () => {
    const result = eventInputSchema.safeParse({
      actor: "bastion",
      action: "dossier.stage",
      entityType: "dossier",
      entityId: "d1",
    });
    expect(result.success).toBe(true);
  });

  it("an event without an actor fails validation — every event names who caused it", () => {
    const result = eventInputSchema.safeParse({
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.sources",
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["a v1 user uuid", "550e8400-e29b-41d4-a716-446655440000"],
    ["an uppercase visitor id", "v_KK6EOOEPNO"],
    ["a short visitor id", "v_kk6e"],
    ["a raw IP address", "203.0.113.7"],
    ["an empty string", ""],
    ["a near-miss system actor", "Bastion"],
  ])("rejects %s as the actor", (_label, actor) => {
    const result = eventInputSchema.safeParse({
      actor,
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.sources",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the legacy actorId field instead of silently dropping it", () => {
    const result = eventInputSchema.safeParse({
      actor: VISITOR,
      actorId: "550e8400-e29b-41d4-a716-446655440000",
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.sources",
    });
    expect(result.success).toBe(false);
  });

  it("appendEvent throws on an invalid actor rather than writing an unattributed row", async () => {
    const { appendEvent } = await import("@/platform/audit/write");
    await expect(
      appendEvent({
        actor: "u1" as never,
        action: "gateway.call",
        entityType: "capability",
        entityId: "magpie.sources",
      }),
    ).rejects.toThrow();
  });

  it("event with empty action fails validation", () => {
    const result = eventInputSchema.safeParse({
      actor: VISITOR,
      action: "",
      entityType: "test",
      entityId: "1",
    });
    expect(result.success).toBe(false);
  });

  it("event with empty entityType fails validation", () => {
    const result = eventInputSchema.safeParse({
      actor: "bastion",
      action: "test.event",
      entityType: "",
      entityId: "1",
    });
    expect(result.success).toBe(false);
  });

  it("event with empty entityId fails validation", () => {
    const result = eventInputSchema.safeParse({
      actor: "bastion",
      action: "test.event",
      entityType: "test",
      entityId: "",
    });
    expect(result.success).toBe(false);
  });

  it("event with optional fields omitted passes", () => {
    const result = eventInputSchema.safeParse({
      actor: "bastion",
      action: "test.event",
      entityType: "test",
      entityId: "1",
    });
    expect(result.success).toBe(true);
  });

  it("event with before/after JSONB fields passes", () => {
    const result = eventInputSchema.safeParse({
      actor: "bastion",
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
      actor: "bastion",
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
    const { appendEvent } = await import("@/platform/audit/write");
    const result = await appendEvent({
      actor: VISITOR,
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.sources",
    });
    expect(result).toBe(42);
    expect(mocks.mockInsert).toHaveBeenCalled();
    expect(mocks.mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: VISITOR,
        action: "gateway.call",
        entityType: "capability",
        entityId: "magpie.sources",
      }),
    );
  });

  it("event createdAt is set by the database (integration)", async () => {
    // createdAt is not passed in the insert values — it's a DB default
    mocks.mockReturning.mockResolvedValueOnce([{ id: 1 }]);
    const { appendEvent } = await import("@/platform/audit/write");
    await appendEvent({
      actor: "bastion",
      action: "test.event",
      entityType: "test",
      entityId: "1",
    });
    const insertedValues = mocks.mockValues.mock.calls[0][0];
    expect(insertedValues).not.toHaveProperty("createdAt");
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
    const { appendEvent } = await import("@/platform/audit/write");
    const result = await appendEvent({
      actor: "bastion",
      action: "test.event",
      entityType: "test",
      entityId: "1",
    });
    expect(result).toBeNull();
  });

  it("large metadata object is accepted (integration)", async () => {
    mocks.mockReturning.mockResolvedValueOnce([{ id: 99 }]);
    const { appendEvent } = await import("@/platform/audit/write");
    const largeMetadata: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      largeMetadata[`key_${i}`] = `value_${i}`;
    }
    const result = await appendEvent({
      actor: "bastion",
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

  it("events cannot be modified via any endpoint (tested in schema spec)", async () => {
    // Structural: the writer only appends and the reader (read.ts) only selects; neither module
    // exports anything that updates or deletes.
    const writer = Object.keys(await import("@/platform/audit/write"));
    const reader = Object.keys(await import("@/platform/audit/read"));
    expect(writer).toEqual(["appendEvent"]);
    expect(reader).toEqual(["readEvents"]);
  });

  it("the actor is written to `actor`, never to the legacy `actor_id` (integration)", async () => {
    mocks.mockReturning.mockResolvedValueOnce([{ id: 1 }]);
    const { appendEvent } = await import("@/platform/audit/write");
    await appendEvent({
      actor: VISITOR,
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.sources",
    });
    const insertedValues = mocks.mockValues.mock.calls[0][0];
    expect(insertedValues.actor).toBe(VISITOR);
    expect(insertedValues).not.toHaveProperty("actorId");
  });

  it("system work is recorded as the actor `bastion` (integration)", async () => {
    mocks.mockReturning.mockResolvedValueOnce([{ id: 2 }]);
    const { appendEvent } = await import("@/platform/audit/write");
    await appendEvent({
      actor: "bastion",
      action: "dossier.stage",
      entityType: "dossier",
      entityId: "d1",
    });
    expect(mocks.mockValues.mock.calls[0][0].actor).toBe("bastion");
  });
});
