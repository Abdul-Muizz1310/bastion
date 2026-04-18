import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    headers: Headers;
    constructor(body?: BodyInit | null, init?: { status?: number; headers?: HeadersInit }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }
    static json(data: unknown, init?: { status?: number }) {
      const r = new MockNextResponse(JSON.stringify(data), { status: init?.status });
      (r as unknown as { _jsonBody: unknown })._jsonBody = data;
      return r;
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: (name: string) => mockCookieGet(name) }),
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

const mockGetDossier = vi.fn();
const mockListEvidence = vi.fn();
vi.mock("@/features/dossier/server/query", () => ({
  getDossier: (...args: unknown[]) => mockGetDossier(...args),
  listEvidenceItems: (...args: unknown[]) => mockListEvidence(...args),
}));

const mockAppendEvent = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/audit/write", () => ({
  appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
}));

const mockCallService = vi.fn();
vi.mock("@/lib/gateway/client", () => ({
  callService: (...args: unknown[]) => mockCallService(...args),
}));

const DOSSIER_ID = "550e8400-e29b-41d4-a716-446655440000";

function session(role: "admin" | "editor" | "viewer", id = "u1") {
  return { sid: "s", user: { id, email: `${role}@x.com`, role, name: null } };
}

function dossier(overrides: Record<string, unknown> = {}) {
  return {
    id: DOSSIER_ID,
    userId: "u1",
    claim: "x",
    sources: ["hackernews"],
    mode: "standard",
    status: "succeeded",
    verdict: "TRUE",
    confidence: "0.90",
    requestId: "req-1",
    envelopeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("19-verify-route: auth + RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 8: no session → 401", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    expect(res.status).toBe(401);
    expect(mockGetDossier).not.toHaveBeenCalled();
  });

  it("case 9: unknown dossier → 404", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
    mockGetDossier.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    expect(res.status).toBe(404);
  });

  it("case 11: viewer + other user's dossier → 403", async () => {
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("viewer", "viewer-1"));
    mockGetDossier.mockResolvedValue(dossier({ userId: "someone-else" }));
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    expect(res.status).toBe(403);
    expect(mockCallService).not.toHaveBeenCalled();
  });
});

describe("19-verify-route: no-evidence fast path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
    mockGetDossier.mockResolvedValue(dossier());
  });

  it("case 10: no evidence items → overall_valid:null with message 'no_evidence_yet'", async () => {
    mockListEvidence.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    expect(res.status).toBe(200);
    const body = (res as any)._jsonBody;
    expect(body.overall_valid).toBeNull();
    expect(body.message).toBe("no_evidence_yet");
    expect(body.results).toEqual([]);
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it("no evidence: still audits dossier.verified.ok with total=0", async () => {
    mockListEvidence.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dossier.verified.ok",
        metadata: { total: 0, passed: 0, failed: 0 },
      }),
    );
  });

  it("evidence items with null certificate_id are skipped", async () => {
    mockListEvidence.mockResolvedValueOnce([
      { id: "e1", certificateId: null, dossierId: DOSSIER_ID } as any,
    ]);
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    const body = (res as any)._jsonBody;
    expect(body.results).toEqual([]);
    expect(mockCallService).not.toHaveBeenCalled();
  });
});

describe("19-verify-route: inkprint integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieGet.mockReturnValue({ value: "c" });
    mockGetSession.mockResolvedValue(session("admin"));
    mockGetDossier.mockResolvedValue(dossier());
  });

  it("case 13: 3 valid items → overall_valid:true, audit ok", async () => {
    mockListEvidence.mockResolvedValueOnce([
      { id: "e1", certificateId: "cert-1" } as any,
      { id: "e2", certificateId: "cert-2" } as any,
      { id: "e3", certificateId: "cert-3" } as any,
    ]);
    mockCallService.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        results: [
          { certificate_id: "cert-1", valid: true, checks: { signature: true, hash: true } },
          { certificate_id: "cert-2", valid: true, checks: { signature: true, hash: true } },
          { certificate_id: "cert-3", valid: true, checks: { signature: true, hash: true } },
        ],
      },
    });
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    const body = (res as any)._jsonBody;
    expect(body.overall_valid).toBe(true);
    expect(body.results).toHaveLength(3);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dossier.verified.ok",
        metadata: { total: 3, passed: 3, failed: 0 },
      }),
    );
  });

  it("case 14: 1 tampered among 2 → overall_valid:false, audit error", async () => {
    mockListEvidence.mockResolvedValueOnce([
      { id: "e1", certificateId: "cert-1" } as any,
      { id: "e2", certificateId: "cert-2" } as any,
    ]);
    mockCallService.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        results: [
          { certificate_id: "cert-1", valid: true, checks: { signature: true, hash: true } },
          {
            certificate_id: "cert-2",
            valid: false,
            checks: { signature: true, hash: false },
            reason: "hash_mismatch",
          },
        ],
      },
    });
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    const body = (res as any)._jsonBody;
    expect(body.overall_valid).toBe(false);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dossier.verified.error",
        metadata: { total: 2, passed: 1, failed: 1 },
      }),
    );
  });

  it("case 16: inkprint downstream error → 502, audit dossier.verified.error", async () => {
    mockListEvidence.mockResolvedValueOnce([
      { id: "e1", certificateId: "cert-1" } as any,
    ]);
    mockCallService.mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: "bad_gateway",
    });
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    const res = await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    expect(res.status).toBe(502);
    expect(mockAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dossier.verified.error",
        service: "inkprint",
      }),
    );
  });

  it("cert IDs are passed to callService in correct shape", async () => {
    mockListEvidence.mockResolvedValueOnce([
      { id: "e1", certificateId: "cert-A" } as any,
      { id: "e2", certificateId: "cert-B" } as any,
    ]);
    mockCallService.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { results: [] },
    });
    const { GET } = await import("@/app/api/dossiers/[id]/verify/route");
    await GET({} as any, { params: Promise.resolve({ id: DOSSIER_ID }) });
    const [, , opts] = mockCallService.mock.calls[0];
    expect(opts.body).toEqual({
      items: [{ certificate_id: "cert-A" }, { certificate_id: "cert-B" }],
    });
  });
});
