import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock audit
vi.mock("@/lib/audit/write", () => ({
  appendEvent: vi.fn().mockResolvedValue(1),
}));

// Mock the server-to-server gateway caller. The pipeline reaches every backend
// through callService (which mints its own platform JWT) — NOT a loopback fetch
// to /api/proxy. These tests drive that composed path with the boundary mocked.
const mockCallService = vi.fn();
vi.mock("@/lib/gateway/client", () => ({
  callService: (...args: unknown[]) => mockCallService(...args),
}));

const baseInput = {
  userId: "user-1",
  role: "admin" as const,
  claim: "Is the sky blue?",
  sources: ["hackernews"],
  mode: "standard" as const,
};

/** Default: every service returns a plausible, schema-valid success envelope. */
function primeHappyPath() {
  mockCallService.mockImplementation((serviceId: string) => {
    switch (serviceId) {
      case "magpie":
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            runs: [
              {
                source: "hackernews",
                items: [
                  {
                    stable_id: "hn-1",
                    url: "https://news.ycombinator.com/item?id=1",
                    title: "A headline",
                    content_text: "some article body",
                    content_hash: "abc123",
                  },
                ],
              },
            ],
            failed: [],
          },
        });
      case "inkprint":
        return Promise.resolve({ ok: true, status: 201, data: { id: "cert-hn-1" } });
      case "paper-trail":
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { verdict: "TRUE", confidence: 0.91 },
        });
      case "slowquery":
        return Promise.resolve({ ok: true, status: 200, data: { queries: [] } });
      default:
        return Promise.resolve({ ok: true, status: 200, data: {} });
    }
  });
}

describe("10-dossier: role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("viewer role cannot start dossier run", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const { AccessDeniedError } = await import("@/lib/auth/rbac");
    await expect(startDossierRun({ ...baseInput, role: "viewer" })).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it("the denial goes through withRole so it lands in the audit log", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const { appendEvent } = await import("@/lib/audit/write");
    await expect(startDossierRun({ ...baseInput, role: "viewer" })).rejects.toThrow();
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.denied",
        entityType: "rbac",
        entityId: "dossier.run",
        actorId: "user-1",
      }),
    );
  });
});

describe("10-dossier: workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("executes 5 steps in order", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const result = await startDossierRun(baseInput);
    expect(result.steps.map((s) => s.step)).toEqual([
      "magpie",
      "inkprint",
      "paper-trail",
      "slowquery",
      "audit",
    ]);
    for (const step of result.steps) {
      expect(step.status).toBe("ok");
    }
  });

  it("reaches each backend via callService (server-to-server), never /api/proxy", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    await startDossierRun(baseInput);
    const services = mockCallService.mock.calls.map((c) => c[0]);
    expect(services).toEqual(["magpie", "inkprint", "paper-trail", "slowquery"]);
    // Every call carries a server-side actor (mints its own JWT) — no session cookie.
    for (const call of mockCallService.mock.calls) {
      expect(call[2].actor).toEqual({ id: "user-1", role: "admin" });
    }
  });

  it("threads the user's claim + mode into the paper-trail debate", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    await startDossierRun({ ...baseInput, mode: "adversarial" });
    const ptCall = mockCallService.mock.calls.find((c) => c[0] === "paper-trail");
    expect(ptCall?.[1]).toBe("/platform/debate");
    expect(ptCall?.[2].body).toEqual({ claim: "Is the sky blue?", max_rounds: 8 });
  });

  it("threads the user's selected sources into the magpie scrape", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    await startDossierRun({ ...baseInput, sources: ["hackernews", "arxiv-cs"] });
    const magpieCall = mockCallService.mock.calls.find((c) => c[0] === "magpie");
    expect(magpieCall?.[1]).toBe("/api/scrape/batch");
    expect(magpieCall?.[2].body.sources).toEqual(["hackernews", "arxiv-cs"]);
  });

  it("seals gathered items into evidence rows carrying the inkprint cert id", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const result = await startDossierRun(baseInput);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      source: "hackernews",
      stableId: "hn-1",
      certificateId: "cert-hn-1",
      contentHash: "abc123",
    });
  });

  it("produces 4 artifact cards (magpie, inkprint, paper-trail, slowquery)", async () => {
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const result = await startDossierRun(baseInput);
    expect(result.artifacts.map((a) => a.type)).toEqual(
      expect.arrayContaining(["magpie", "inkprint", "paper-trail", "slowquery"]),
    );
  });

  it("all audit events share the same requestId", async () => {
    const { appendEvent } = await import("@/lib/audit/write");
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const result = await startDossierRun(baseInput);
    const calls = (appendEvent as ReturnType<typeof vi.fn>).mock.calls;
    const uniqueIds = new Set(calls.map((call) => call[0].requestId));
    expect(uniqueIds.size).toBe(1);
    expect([...uniqueIds][0]).toBe(result.requestId);
  });
});

describe("10-dossier: edge and failure cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("magpie failure stops the run with a partial result", async () => {
    mockCallService.mockResolvedValueOnce({ ok: false, status: 502, error: "bad_gateway" });

    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const result = await startDossierRun(baseInput);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ step: "magpie", status: "error" });
    expect(result.artifacts).toHaveLength(0);
    expect(result.evidence).toHaveLength(0);
  });

  it("inkprint failure preserves the magpie artifact and yields no evidence", async () => {
    mockCallService
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          runs: [
            {
              source: "hackernews",
              items: [
                { stable_id: "hn-1", url: "", title: "", content_text: "x", content_hash: "h1" },
              ],
            },
          ],
          failed: [],
        },
      })
      .mockResolvedValueOnce({ ok: false, status: 503, error: "unavailable" });

    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const result = await startDossierRun(baseInput);

    expect(result.steps.map((s) => s.step)).toEqual(["magpie", "inkprint"]);
    expect(result.steps[1].status).toBe("error");
    expect(result.artifacts.map((a) => a.type)).toEqual(["magpie"]);
    expect(result.evidence).toHaveLength(0);
  });

  it("concurrent runs get independent run ids", async () => {
    primeHappyPath();
    const { startDossierRun } = await import("@/features/dossier/server/pipeline");
    const [r1, r2] = await Promise.all([
      startDossierRun({ ...baseInput, userId: "user-1" }),
      startDossierRun({ ...baseInput, userId: "user-2" }),
    ]);
    expect(r1.runId).not.toBe(r2.runId);
    expect(r1.requestId).not.toBe(r2.requestId);
  });
});
