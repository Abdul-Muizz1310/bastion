import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Mock DB — same chain-mock pattern used elsewhere
vi.mock("@/lib/db/client", () => {
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockValues = vi.fn();
  const mockSet = vi.fn();
  const mockWhere = vi.fn();

  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);

  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue(undefined);

  const db = { insert: mockInsert, update: mockUpdate };

  return {
    getDb: () => db,
    __mocks: { db, mockInsert, mockValues, mockUpdate, mockSet, mockWhere },
  };
});

// Mock audit write (used by withRole + createDossier)
const mockAppendEvent = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/audit/write", () => ({
  appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
}));

// Mock the pipeline so createDossier tests don't actually spin up downstream calls
const mockStartDossierRun = vi.fn();
vi.mock("@/features/dossier/server/pipeline", () => ({
  startDossierRun: (...args: unknown[]) => mockStartDossierRun(...args),
}));

import { createDossier, runPipeline } from "@/features/dossier/server/create";
import { AccessDeniedError } from "@/lib/auth/rbac";

const validInput = {
  claim: "Is X true?",
  sources: ["hackernews"],
  mode: "standard" as const,
};

const adminActor = { id: "admin-1", role: "admin" as const };
const editorActor = { id: "editor-1", role: "editor" as const };
const viewerActor = { id: "viewer-1", role: "viewer" as const };

describe("16-dossier-create: createDossier RBAC", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockInsert.mockReturnValue({ values: mocks.mockValues });
    mocks.mockValues.mockResolvedValue(undefined);
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockResolvedValue(undefined);
    mockStartDossierRun.mockResolvedValue({
      runId: "run-1",
      requestId: "req-1",
      steps: [],
      artifacts: [],
      timeline: [],
    });
  });

  it("case 10: viewer role is rejected with AccessDeniedError", async () => {
    await expect(createDossier(validInput, viewerActor)).rejects.toThrow(AccessDeniedError);
  });

  it("case 10b: viewer rejection does NOT insert a dossier row", async () => {
    try {
      await createDossier(validInput, viewerActor);
    } catch {
      // expected
    }
    // The only insert should be the audit denial event (withRole logs the denial)
    // No dossier insert should have happened.
    const dossierInsertCalls = mocks.mockInsert.mock.calls.filter((_call, idx) => {
      // Whether mockValues was called with a dossier-shaped object
      return (mocks.mockValues.mock.calls[idx]?.[0] as { claim?: string })?.claim !== undefined;
    });
    expect(dossierInsertCalls).toHaveLength(0);
  });

  it("case 11: admin role succeeds and inserts a dossier row", async () => {
    const result = await createDossier(validInput, adminActor);
    expect(result.dossier_id).toMatch(/^[0-9a-f]{8}-/);
    expect(result.request_id).toMatch(/^[0-9a-f]{8}-/);
    expect(mocks.mockInsert).toHaveBeenCalled();
    const insertedRow = mocks.mockValues.mock.calls[0][0];
    expect(insertedRow.claim).toBe(validInput.claim);
    expect(insertedRow.status).toBe("pending");
    expect(insertedRow.userId).toBe("admin-1");
    expect(insertedRow.sources).toEqual(["hackernews"]);
  });

  it("case 11b: editor role also succeeds", async () => {
    const result = await createDossier(validInput, editorActor);
    expect(result.dossier_id).toBeTruthy();
  });
});

describe("16-dossier-create: createDossier response shape", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockInsert.mockReturnValue({ values: mocks.mockValues });
    mocks.mockValues.mockResolvedValue(undefined);
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockResolvedValue(undefined);
    mockStartDossierRun.mockResolvedValue({
      runId: "r",
      requestId: "r",
      steps: [],
      artifacts: [],
      timeline: [],
    });
  });

  it("case 12: dossier_id and request_id are UUIDs", async () => {
    const result = await createDossier(validInput, adminActor);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(result.dossier_id).toMatch(uuidPattern);
    expect(result.request_id).toMatch(uuidPattern);
    expect(result.dossier_id).not.toBe(result.request_id);
  });

  it("case 13: stream_url is correctly formatted", async () => {
    const result = await createDossier(validInput, adminActor);
    expect(result.stream_url).toBe(`/api/dossiers/${result.dossier_id}/stream`);
  });

  it("case 11c: audit event is written with action dossier.created", async () => {
    await createDossier(validInput, adminActor);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dossier.created",
        entityType: "dossier",
        actorId: "admin-1",
        service: "bastion",
      }),
    );
  });

  it("case 11d: audit event includes requestId matching response", async () => {
    const result = await createDossier(validInput, adminActor);
    const call = mockAppendEvent.mock.calls.find(
      (c) => (c[0] as { action?: string })?.action === "dossier.created",
    );
    expect((call?.[0] as { requestId?: string })?.requestId).toBe(result.request_id);
  });
});

describe("16-dossier-create: createDossier fire-and-forget pipeline", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockInsert.mockReturnValue({ values: mocks.mockValues });
    mocks.mockValues.mockResolvedValue(undefined);
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockResolvedValue(undefined);
  });

  it("case 14: createDossier returns before the pipeline completes", async () => {
    // Pipeline never resolves — createDossier must still return quickly
    let pipelineDone = false;
    mockStartDossierRun.mockImplementation(
      () =>
        new Promise(() => {
          // intentionally never resolves
          setTimeout(() => {
            pipelineDone = true;
          }, 10_000);
        }),
    );

    const start = Date.now();
    const result = await createDossier(validInput, adminActor);
    const elapsed = Date.now() - start;

    expect(result.dossier_id).toBeTruthy();
    expect(elapsed).toBeLessThan(500);
    expect(pipelineDone).toBe(false);
  });
});

describe("16-dossier-create: runPipeline status transitions", () => {
  let mocks: Record<string, Mock>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dbMod = await import("@/lib/db/client");
    mocks = (dbMod as unknown as { __mocks: Record<string, Mock> }).__mocks;
    mocks.mockInsert.mockReturnValue({ values: mocks.mockValues });
    mocks.mockValues.mockResolvedValue(undefined);
    mocks.mockUpdate.mockReturnValue({ set: mocks.mockSet });
    mocks.mockSet.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockResolvedValue(undefined);
  });

  it("happy path: status running→succeeded with verdict", async () => {
    mockStartDossierRun.mockResolvedValueOnce({
      runId: "r",
      requestId: "req-1",
      steps: [
        { step: "magpie", status: "ok", data: {} },
        { step: "inkprint", status: "ok", data: {} },
        { step: "paper-trail", status: "ok", data: { verdict: "TRUE", confidence: 0.87 } },
        { step: "slowquery", status: "ok", data: {} },
        { step: "audit", status: "ok", data: {} },
      ],
      artifacts: [
        { title: "pt", type: "paper-trail", data: { verdict: "TRUE", confidence: 0.87 } },
      ],
      timeline: [
        { step: "magpie", timestamp: new Date(), latencyMs: 10 },
        { step: "inkprint", timestamp: new Date(), latencyMs: 20 },
        { step: "paper-trail", timestamp: new Date(), latencyMs: 30 },
        { step: "slowquery", timestamp: new Date(), latencyMs: 5 },
        { step: "audit", timestamp: new Date(), latencyMs: 1 },
      ],
    });

    await runPipeline("dossier-1", "req-1", validInput, adminActor);

    // Status updates: running (first update) then succeeded (last update)
    const statusUpdates = mocks.mockSet.mock.calls
      .map((call) => (call[0] as { status?: string })?.status)
      .filter(Boolean);
    expect(statusUpdates[0]).toBe("running");
    expect(statusUpdates.at(-1)).toBe("succeeded");
  });

  it("failure path: status running→failed when a step errors", async () => {
    mockStartDossierRun.mockResolvedValueOnce({
      runId: "r",
      requestId: "req-1",
      steps: [
        { step: "magpie", status: "ok", data: {} },
        { step: "inkprint", status: "error", error: "inkprint down" },
      ],
      artifacts: [],
      timeline: [
        { step: "magpie", timestamp: new Date(), latencyMs: 10 },
        { step: "inkprint", timestamp: new Date(), latencyMs: 3 },
      ],
    });

    await runPipeline("dossier-2", "req-2", validInput, adminActor);

    const statusUpdates = mocks.mockSet.mock.calls
      .map((call) => (call[0] as { status?: string })?.status)
      .filter(Boolean);
    expect(statusUpdates).toContain("failed");
  });

  it("thrown error from pipeline is captured into status=failed (no unhandled rejection)", async () => {
    mockStartDossierRun.mockRejectedValueOnce(new Error("catastrophic"));

    // Should not throw — runPipeline swallows everything into status
    await expect(runPipeline("dossier-3", "req-3", validInput, adminActor)).resolves.toBeUndefined();

    const statusUpdates = mocks.mockSet.mock.calls
      .map((call) => (call[0] as { status?: string })?.status)
      .filter(Boolean);
    expect(statusUpdates).toContain("failed");
  });

  it("step names are mapped from pipeline vocabulary (magpie→gather, etc.)", async () => {
    mockStartDossierRun.mockResolvedValueOnce({
      runId: "r",
      requestId: "req-1",
      steps: [
        { step: "magpie", status: "ok", data: {} },
        { step: "inkprint", status: "ok", data: {} },
        { step: "paper-trail", status: "ok", data: {} },
        { step: "slowquery", status: "ok", data: {} },
        { step: "audit", status: "ok", data: {} },
      ],
      artifacts: [],
      timeline: [
        { step: "magpie", timestamp: new Date(), latencyMs: 1 },
        { step: "inkprint", timestamp: new Date(), latencyMs: 1 },
        { step: "paper-trail", timestamp: new Date(), latencyMs: 1 },
        { step: "slowquery", timestamp: new Date(), latencyMs: 1 },
        { step: "audit", timestamp: new Date(), latencyMs: 1 },
      ],
    });

    await runPipeline("dossier-4", "req-4", validInput, adminActor);

    // dossier_events.step values should be the mapped names
    const insertedSteps = mocks.mockValues.mock.calls
      .map((call) => (call[0] as { step?: string })?.step)
      .filter(Boolean);
    expect(insertedSteps).toEqual(
      expect.arrayContaining(["gather", "seal", "adjudicate", "measure", "record"]),
    );
    expect(insertedSteps).not.toContain("magpie");
  });
});
