import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for Spec 15 — gateway proxy route.
 * File under test: src/app/api/proxy/[service]/[...path]/route.ts
 *
 * Case numbers match the enumerated list in docs/specs/15-gateway-proxy-route.md.
 */

// -- Mocks -------------------------------------------------------------------

// next/server — minimal NextResponse with json() + constructor-with-body for stream passthrough
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

// next/headers — mocked cookies()
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
  }),
}));

// session — mocked getSession
const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

// gateway jwt + resolveService + parseRequestId
const mockMintJwt = vi.fn();
const mockResolveService = vi.fn();
const mockParseRequestId = vi.fn();
vi.mock("@/lib/gateway/jwt", () => ({
  mintPlatformJwt: (...args: unknown[]) => mockMintJwt(...args),
  resolveService: (...args: unknown[]) => mockResolveService(...args),
  parseRequestId: (...args: unknown[]) => mockParseRequestId(...args),
}));

// audit write
const mockAppendEvent = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/audit/write", () => ({
  appendEvent: (...args: unknown[]) => mockAppendEvent(...args),
}));

// rate limiter
const mockRateLimitCheck = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  gatewayLimiter: { check: (...args: unknown[]) => mockRateLimitCheck(...args) },
  authLimiter: { check: vi.fn() },
  csrfLimiter: { check: vi.fn() },
  createRateLimiter: vi.fn(),
}));

// global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// -- Helpers -----------------------------------------------------------------

function makeRequest(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: string | Uint8Array | null } = {},
): any {
  const u = new URL(url);
  const headers = new Headers(opts.headers);
  return {
    method,
    nextUrl: u,
    headers: {
      get: (name: string) => headers.get(name),
      entries: () => headers.entries(),
    },
    arrayBuffer: async () =>
      opts.body ? new TextEncoder().encode(String(opts.body)).buffer : new ArrayBuffer(0),
  };
}

function makeParams(service: string, path: string[]) {
  return { params: Promise.resolve({ service, path }) };
}

function defaultSession() {
  return {
    sid: "sess-123",
    user: { id: "user-1", email: "u@example.com", role: "admin", name: "User" },
  };
}

function defaultService() {
  return {
    id: "magpie",
    name: "Magpie",
    backendUrl: "https://magpie-backend.onrender.com",
    healthPath: "/health",
  };
}

// Default: authorized admin, magpie resolved, limiter passes, JWT mints, downstream 200
function primeHappyPath() {
  mockCookieGet.mockReturnValue({ value: "valid-cookie" });
  mockGetSession.mockResolvedValue(defaultSession());
  mockResolveService.mockImplementation((id: string) => {
    if (id === "magpie") return defaultService();
    if (id === "feathers") {
      const err = new Error("No backend URL for service: feathers");
      throw err;
    }
    throw new Error(`Unknown service: ${id}`);
  });
  mockParseRequestId.mockImplementation((existing: string | null) => existing ?? "req-uuid-abc");
  mockRateLimitCheck.mockResolvedValue({ success: true, limit: 60, remaining: 59 });
  mockMintJwt.mockResolvedValue("mock.jwt.token");
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, data: "downstream-result" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

// ---------------------------------------------------------------------------

describe("15-gateway-proxy: pass cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("case 1: forwards GET to known service", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/api/scrape/hackernews/top");
    const res = await GET(req, makeParams("magpie", ["api", "scrape", "hackernews", "top"]));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [target, init] = mockFetch.mock.calls[0];
    expect(target).toBe("https://magpie-backend.onrender.com/api/scrape/hackernews/top");
    expect(init.method).toBe("GET");
  });

  it("case 2: forwards POST with JSON body", async () => {
    const { POST } = await import("@/app/api/proxy/[service]/[...path]/route");
    const body = JSON.stringify({ text: "demo article text" });
    const req = makeRequest("POST", "http://localhost:3000/api/proxy/magpie/certificates", {
      headers: { "content-type": "application/json" },
      body,
    });
    const res = await POST(req, makeParams("magpie", ["certificates"]));
    expect(res.status).toBe(200);
    const [target, init] = mockFetch.mock.calls[0];
    expect(target).toBe("https://magpie-backend.onrender.com/certificates");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    const forwardedBody = new TextDecoder().decode(new Uint8Array(init.body as ArrayBuffer));
    expect(forwardedBody).toBe(body);
  });

  it("case 3: query string is preserved", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest(
      "GET",
      "http://localhost:3000/api/proxy/magpie/api/queries?since=2026-04-18T00:00:00Z&limit=10",
    );
    await GET(req, makeParams("magpie", ["api", "queries"]));
    const [target] = mockFetch.mock.calls[0];
    expect(target).toBe(
      "https://magpie-backend.onrender.com/api/queries?since=2026-04-18T00:00:00Z&limit=10",
    );
  });

  it("case 4: catch-all path segments are joined with slashes", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/a/b/c/d");
    await GET(req, makeParams("magpie", ["a", "b", "c", "d"]));
    const [target] = mockFetch.mock.calls[0];
    expect(target).toBe("https://magpie-backend.onrender.com/a/b/c/d");
  });

  it("case 5a: X-Request-Id from client is propagated", async () => {
    mockParseRequestId.mockImplementation((existing: string | null) => existing ?? "generated");
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x", {
      headers: { "x-request-id": "client-provided-id" },
    });
    const res = await GET(req, makeParams("magpie", ["x"]));
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("x-request-id")).toBe("client-provided-id");
    expect(res.headers.get("x-request-id")).toBe("client-provided-id");
  });

  it("case 5b: X-Request-Id is generated when absent", async () => {
    mockParseRequestId.mockReturnValue("minted-uuid-xyz");
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    await GET(req, makeParams("magpie", ["x"]));
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("x-request-id")).toBe("minted-uuid-xyz");
  });

  it("case 6: X-Platform-Key-Id header is set on outgoing request", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    await GET(req, makeParams("magpie", ["x"]));
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("x-platform-key-id")).toBeTruthy();
  });

  it("case 7: JWT claims match session (sub, role, service)", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    await GET(req, makeParams("magpie", ["x"]));
    expect(mockMintJwt).toHaveBeenCalledWith({
      sub: "user-1",
      role: "admin",
      service: "magpie",
    });
  });

  it("case 7b: outgoing Authorization header is Bearer <jwt>", async () => {
    mockMintJwt.mockResolvedValueOnce("signed.jwt.abc");
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    await GET(req, makeParams("magpie", ["x"]));
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer signed.jwt.abc");
  });

  it("case 8: audit event written once with gateway.proxy.ok on success", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/api/scrape");
    await GET(req, makeParams("magpie", ["api", "scrape"]));
    expect(mockAppendEvent).toHaveBeenCalledTimes(1);
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.action).toBe("gateway.proxy.ok");
    expect(call.entityType).toBe("proxy");
    expect(call.entityId).toBe("magpie:api/scrape");
    expect(call.service).toBe("magpie");
    expect(call.actorId).toBe("user-1");
    expect(call.requestId).toBeTruthy();
    expect(call.metadata).toMatchObject({ status: 200 });
    expect(typeof call.metadata.latencyMs).toBe("number");
  });
});

describe("15-gateway-proxy: fail cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("case 9: unknown service ID returns 404", async () => {
    mockResolveService.mockImplementation(() => {
      throw new Error("Unknown service: fake");
    });
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/fake/anything");
    const res = await GET(req, makeParams("fake", ["anything"]));
    expect(res.status).toBe(404);
    expect((res as any)._jsonBody).toEqual({ error: "Unknown service" });
    expect(mockFetch).not.toHaveBeenCalled();
    // Error audit event
    expect(mockAppendEvent).toHaveBeenCalledTimes(1);
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.action).toBe("gateway.proxy.error");
    expect(call.metadata).toMatchObject({ reason: "unknown_service" });
  });

  it("case 10: CLI-only service (no backendUrl) returns 404", async () => {
    mockResolveService.mockImplementation(() => {
      throw new Error("No backend URL for service: feathers");
    });
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/feathers/x");
    const res = await GET(req, makeParams("feathers", ["x"]));
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("case 11: unauthenticated (no session cookie) returns 401", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(401);
    expect((res as any)._jsonBody).toEqual({ error: "Unauthorized" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockResolveService).not.toHaveBeenCalled();
  });

  it("case 12: invalid/forged session cookie returns 401", async () => {
    mockCookieGet.mockReturnValue({ value: "forged-garbage" });
    mockGetSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(401);
  });

  it("case 13: rate limit exceeded returns 429 with Retry-After", async () => {
    mockRateLimitCheck.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      retryAfter: 7,
    });
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect((res as any)._jsonBody).toMatchObject({
      error: "Rate limit exceeded",
      retryAfter: 7,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    // Error audit event
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.action).toBe("gateway.proxy.error");
    expect(call.metadata).toMatchObject({ reason: "rate_limited" });
  });

  it("case 14: downstream 5xx becomes 502 Bad Gateway", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 503 }),
    );
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(502);
    expect((res as any)._jsonBody).toEqual({ error: "Bad Gateway" });
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.action).toBe("gateway.proxy.error");
    expect(call.metadata).toMatchObject({ status: 502, downstreamStatus: 503 });
  });

  it("case 15: downstream 4xx passes through verbatim (no wrapping)", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(404);
    // Should log as .ok because the gateway itself succeeded — downstream's 4xx is client's concern
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.action).toBe("gateway.proxy.ok");
    expect(call.metadata.status).toBe(404);
  });

  it("case 16a: fetch timeout (AbortError) becomes 504", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    mockFetch.mockRejectedValueOnce(err);
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(504);
    expect((res as any)._jsonBody).toEqual({ error: "Gateway Timeout" });
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.metadata).toMatchObject({ reason: "timeout" });
  });

  it("case 16b: network error becomes 504 with reason=network_error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(504);
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.metadata).toMatchObject({ reason: "network_error" });
  });

  it("case 17: JWT minting failure returns generic 500 without stack leak", async () => {
    mockMintJwt.mockRejectedValueOnce(new Error("BASTION_SIGNING_KEY_PRIVATE is not set"));
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    const res = await GET(req, makeParams("magpie", ["x"]));
    expect(res.status).toBe(500);
    expect((res as any)._jsonBody).toEqual({ error: "Internal Server Error" });
    // No stack or key info in body
    const body = (res as any)._jsonBody as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("BASTION_SIGNING_KEY_PRIVATE");
    expect(JSON.stringify(body)).not.toContain("stack");
    const call = mockAppendEvent.mock.calls[0][0];
    expect(call.metadata).toMatchObject({ reason: "jwt_mint_failed" });
  });
});

describe("15-gateway-proxy: security cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("case 18: client Authorization header is NOT forwarded", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x", {
      headers: { authorization: "Bearer client-token-leaked" },
    });
    await GET(req, makeParams("magpie", ["x"]));
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer mock.jwt.token");
    expect(headers.get("authorization")).not.toContain("client-token-leaked");
  });

  it("case 19: client Cookie header is NOT forwarded", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x", {
      headers: { cookie: "bastion_session=sensitive-session-value" },
    });
    await GET(req, makeParams("magpie", ["x"]));
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get("cookie")).toBeNull();
  });

  it("case 20: request/response body is NOT logged in audit metadata", async () => {
    const { POST } = await import("@/app/api/proxy/[service]/[...path]/route");
    const secret = JSON.stringify({ password: "super-secret-value" });
    const req = makeRequest("POST", "http://localhost:3000/api/proxy/magpie/sensitive", {
      headers: { "content-type": "application/json" },
      body: secret,
    });
    await POST(req, makeParams("magpie", ["sensitive"]));
    const call = mockAppendEvent.mock.calls[0][0];
    const metadataStr = JSON.stringify(call.metadata);
    expect(metadataStr).not.toContain("super-secret-value");
    expect(metadataStr).not.toContain("password");
    // Metadata should only have status + latencyMs keys
    expect(Object.keys(call.metadata).sort()).toEqual(["latencyMs", "status"]);
  });

  it("case 21: rate-limit key is the session sid (not IP, not userId)", async () => {
    const { GET } = await import("@/app/api/proxy/[service]/[...path]/route");
    const req = makeRequest("GET", "http://localhost:3000/api/proxy/magpie/x");
    await GET(req, makeParams("magpie", ["x"]));
    expect(mockRateLimitCheck).toHaveBeenCalledWith("sess-123");
    expect(mockRateLimitCheck).not.toHaveBeenCalledWith("user-1");
  });
});

describe("15-gateway-proxy: method exports", () => {
  it("exports GET, POST, PUT, PATCH, DELETE pointing at the same handler", async () => {
    const mod = await import("@/app/api/proxy/[service]/[...path]/route");
    expect(mod.GET).toBeDefined();
    expect(mod.POST).toBeDefined();
    expect(mod.PUT).toBeDefined();
    expect(mod.PATCH).toBeDefined();
    expect(mod.DELETE).toBeDefined();
    // All should reference the same function
    expect(mod.GET).toBe(mod.POST);
    expect(mod.GET).toBe(mod.PUT);
    expect(mod.GET).toBe(mod.PATCH);
    expect(mod.GET).toBe(mod.DELETE);
  });
});
