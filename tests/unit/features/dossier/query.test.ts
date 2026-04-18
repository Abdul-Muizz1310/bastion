import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/db/client", () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockOrderBy = vi.fn();
  const mockLimit = vi.fn();

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue([]);

  const db = { select: mockSelect };
  return {
    getDb: () => db,
    __mocks: { mockSelect, mockFrom, mockWhere, mockOrderBy, mockLimit },
  };
});

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_UUID = "550e8400-e29b-41d4-a716-446655440001";

describe("17-dossier-query: getDossier", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ orderBy: mocks.mockOrderBy, limit: mocks.mockLimit });
    mocks.mockOrderBy.mockReturnValue({ limit: mocks.mockLimit });
    mocks.mockLimit.mockResolvedValue([]);
  });

  it("case 1: returns the row when dossier exists", async () => {
    mocks.mockLimit.mockResolvedValueOnce([
      {
        id: VALID_UUID,
        userId: "user-1",
        claim: "Is X true?",
        sources: ["hackernews"],
        mode: "standard",
        status: "running",
        verdict: null,
        confidence: null,
        requestId: "req-1",
        envelopeId: null,
      },
    ]);
    const { getDossier } = await import("@/features/dossier/server/query");
    const result = await getDossier(VALID_UUID);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(VALID_UUID);
    expect(result?.claim).toBe("Is X true?");
  });

  it("case 2: returns null when no row found", async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);
    const { getDossier } = await import("@/features/dossier/server/query");
    const result = await getDossier(VALID_UUID);
    expect(result).toBeNull();
  });

  it("case 3: returns null for malformed id (no DB call)", async () => {
    const { getDossier } = await import("@/features/dossier/server/query");
    const result = await getDossier("not-a-uuid");
    expect(result).toBeNull();
    expect(mocks.mockSelect).not.toHaveBeenCalled();
  });

  it("case 3b: returns null for empty string id", async () => {
    const { getDossier } = await import("@/features/dossier/server/query");
    const result = await getDossier("");
    expect(result).toBeNull();
    expect(mocks.mockSelect).not.toHaveBeenCalled();
  });

  it("case 3c: returns null for SQL-injection-like id", async () => {
    const { getDossier } = await import("@/features/dossier/server/query");
    const result = await getDossier("'; DROP TABLE dossiers; --");
    expect(result).toBeNull();
    expect(mocks.mockSelect).not.toHaveBeenCalled();
  });
});

describe("17-dossier-query: listDossierEvents", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ orderBy: mocks.mockOrderBy, limit: mocks.mockLimit });
    mocks.mockOrderBy.mockReturnValue({ limit: mocks.mockLimit });
    mocks.mockLimit.mockResolvedValue([]);
  });

  it("case 4: returns rows ordered by at ASC", async () => {
    const rows = [
      { id: 1, dossierId: VALID_UUID, step: "gather", status: "ok", latencyMs: 10, at: new Date("2026-04-18T10:00:00Z"), metadata: {} },
      { id: 2, dossierId: VALID_UUID, step: "seal", status: "ok", latencyMs: 20, at: new Date("2026-04-18T10:00:01Z"), metadata: {} },
    ];
    mocks.mockLimit.mockResolvedValueOnce(rows);
    const { listDossierEvents } = await import("@/features/dossier/server/query");
    const result = await listDossierEvents(VALID_UUID);
    expect(result).toEqual(rows);
    expect(mocks.mockOrderBy).toHaveBeenCalled();
  });

  it("case 5: with sinceAt, applies the filter (where clause called)", async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);
    const sinceAt = new Date("2026-04-18T09:00:00Z");
    const { listDossierEvents } = await import("@/features/dossier/server/query");
    await listDossierEvents(VALID_UUID, sinceAt);
    expect(mocks.mockWhere).toHaveBeenCalled();
  });

  it("case 6: LIMIT is 200 (cap)", async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);
    const { listDossierEvents } = await import("@/features/dossier/server/query");
    await listDossierEvents(VALID_UUID);
    expect(mocks.mockLimit).toHaveBeenCalledWith(200);
  });

  it("returns empty list when no events exist", async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);
    const { listDossierEvents } = await import("@/features/dossier/server/query");
    const result = await listDossierEvents(OTHER_UUID);
    expect(result).toEqual([]);
  });

  it("malformed dossier id returns [] without DB call", async () => {
    const { listDossierEvents } = await import("@/features/dossier/server/query");
    const result = await listDossierEvents("not-a-uuid");
    expect(result).toEqual([]);
    expect(mocks.mockSelect).not.toHaveBeenCalled();
  });
});
