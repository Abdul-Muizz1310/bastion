import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/lib/auth/rbac";

// Mock next/server
vi.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    headers: Headers;
    body: unknown;

    constructor(body?: BodyInit | null, init?: { status?: number; headers?: HeadersInit }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }

    static json(data: unknown, init?: { status?: number; headers?: HeadersInit }) {
      const resp = new MockNextResponse(JSON.stringify(data), {
        status: init?.status,
        headers: init?.headers,
      });
      resp.headers.set("content-type", "application/json");
      (resp as unknown as { _jsonBody: unknown })._jsonBody = data;
      return resp;
    }
  }

  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

// Mock cookies
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
  }),
}));

// Mock session
const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

// Mock createDossier
const mockCreateDossier = vi.fn();
vi.mock("@/features/dossier/server/create", () => ({
  createDossier: (...args: unknown[]) => mockCreateDossier(...args),
}));

// Mock rate limiter
const mockRateLimitCheck = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  gatewayLimiter: { check: (...args: unknown[]) => mockRateLimitCheck(...args) },
  authLimiter: { check: vi.fn() },
  csrfLimiter: { check: vi.fn() },
  createRateLimiter: vi.fn(),
}));

function makeRequest(body: unknown, headers: Record<string, string> = {}): any {
  return {
    method: "POST",
    headers: {
      get: (name: string) => headers[name.toLowerCase()],
    },
    json: async () => {
      if (typeof body === "string") {
        // simulate invalid JSON
        throw new Error("Invalid JSON");
      }
      return body;
    },
  };
}

function primeAuth() {
  mockCookieGet.mockReturnValue({ value: "valid-cookie" });
  mockGetSession.mockResolvedValue({
    sid: "sess-1",
    user: { id: "admin-1", email: "a@x.com", role: "admin", name: null },
  });
  mockRateLimitCheck.mockResolvedValue({ success: true, limit: 60, remaining: 59 });
  mockCreateDossier.mockResolvedValue({
    dossier_id: "550e8400-e29b-41d4-a716-446655440000",
    request_id: "req-1",
    stream_url: "/api/dossiers/550e8400-e29b-41d4-a716-446655440000/stream",
  });
}

describe("16-dossier-route: POST /api/dossiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeAuth();
  });

  it("case 15: admin session with valid body returns 202 with correct shape", async () => {
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(
      makeRequest({ claim: "Is X true?", sources: ["hackernews"], mode: "standard" }),
    );
    expect(res.status).toBe(202);
    expect((res as any)._jsonBody).toMatchObject({
      dossier_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      request_id: expect.any(String),
      stream_url: expect.stringMatching(/^\/api\/dossiers\/[^/]+\/stream$/),
    });
  });

  it("case 16: viewer session (createDossier throws AccessDeniedError) returns 403", async () => {
    mockCreateDossier.mockRejectedValueOnce(
      new AccessDeniedError(["admin", "editor"], "viewer", "dossier.create"),
    );
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(
      makeRequest({ claim: "test", sources: ["hackernews"] }),
    );
    expect(res.status).toBe(403);
    expect((res as any)._jsonBody).toEqual({ error: "Access denied" });
  });

  it("case 17: no session returns 401", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(makeRequest({ claim: "t", sources: ["hackernews"] }));
    expect(res.status).toBe(401);
    expect(mockCreateDossier).not.toHaveBeenCalled();
  });

  it("case 18: empty claim returns 422 with issues", async () => {
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(makeRequest({ claim: "", sources: ["hackernews"] }));
    expect(res.status).toBe(422);
    expect((res as any)._jsonBody).toHaveProperty("issues");
    expect(mockCreateDossier).not.toHaveBeenCalled();
  });

  it("case 18b: invalid JSON body returns 422", async () => {
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(makeRequest("not-json-at-all"));
    expect(res.status).toBe(422);
    expect((res as any)._jsonBody).toEqual({ error: "Invalid JSON body" });
  });

  it("case 19: unknown source returns 422 with specific error message", async () => {
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(
      makeRequest({ claim: "t", sources: ["fake-source"] }),
    );
    expect(res.status).toBe(422);
    expect((res as any)._jsonBody).toEqual({ error: "Unknown source: fake-source" });
    expect(mockCreateDossier).not.toHaveBeenCalled();
  });

  it("case 19b: partial-valid sources fail (one unknown among knowns)", async () => {
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(
      makeRequest({ claim: "t", sources: ["hackernews", "nope"] }),
    );
    expect(res.status).toBe(422);
    expect((res as any)._jsonBody).toEqual({ error: "Unknown source: nope" });
  });

  it("case 20: rate limit exceeded returns 429 with Retry-After", async () => {
    mockRateLimitCheck.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      retryAfter: 15,
    });
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(makeRequest({ claim: "t", sources: ["hackernews"] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(mockCreateDossier).not.toHaveBeenCalled();
  });

  it("valid request forwards parsed input to createDossier with session actor", async () => {
    const { POST } = await import("@/app/api/dossiers/route");
    await POST(
      makeRequest({
        claim: "Trade-off between latency and consistency in distributed systems",
        sources: ["hackernews", "arxiv-cs"],
        mode: "adversarial",
      }),
    );
    expect(mockCreateDossier).toHaveBeenCalledWith(
      expect.objectContaining({
        claim: "Trade-off between latency and consistency in distributed systems",
        sources: ["hackernews", "arxiv-cs"],
        mode: "adversarial",
      }),
      { id: "admin-1", role: "admin" },
    );
  });

  it("unknown error from createDossier returns generic 500 (no message leak)", async () => {
    mockCreateDossier.mockRejectedValueOnce(new Error("BASTION_SIGNING_KEY_PRIVATE missing"));
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(makeRequest({ claim: "t", sources: ["hackernews"] }));
    expect(res.status).toBe(500);
    expect((res as any)._jsonBody).toEqual({ error: "Internal Server Error" });
    // Sensitive message must NOT leak in the body
    expect(JSON.stringify((res as any)._jsonBody)).not.toContain("BASTION_SIGNING_KEY_PRIVATE");
  });

  it("case 21: response includes dossier_id that matches stream_url", async () => {
    const { POST } = await import("@/app/api/dossiers/route");
    const res = await POST(makeRequest({ claim: "t", sources: ["hackernews"] }));
    const body = (res as any)._jsonBody;
    expect(body.stream_url).toContain(body.dossier_id);
  });
});
