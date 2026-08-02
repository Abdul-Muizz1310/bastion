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
    static json(data: unknown, init?: { status?: number; headers?: HeadersInit }) {
      const r = new MockNextResponse(JSON.stringify(data), {
        status: init?.status,
        headers: init?.headers,
      });
      (r as unknown as { _jsonBody: unknown })._jsonBody = data;
      return r;
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

const mockCookieGet = vi.fn();
const mockCookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
    set: (...args: unknown[]) => mockCookieSet(...args),
  }),
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

const mockCsrfLimiterCheck = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  csrfLimiter: { check: (...args: unknown[]) => mockCsrfLimiterCheck(...args) },
  createRateLimiter: vi.fn(),
}));

function primeSession() {
  mockCookieGet.mockReturnValue({ value: "sealed" });
  mockGetSession.mockResolvedValue({
    sid: "sess-1",
    user: { id: "u1", email: "u@x.com", role: "admin", name: null },
  });
  mockCsrfLimiterCheck.mockResolvedValue({ success: true, limit: 30, remaining: 29 });
}

describe("04-csrf: GET /api/csrf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeSession();
  });

  it("returns 401 when there is no session", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/csrf/route");
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("mints a token, sets the cookie, and returns it", async () => {
    const { GET } = await import("@/app/api/csrf/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const token = (res as unknown as { _jsonBody: { token: string } })._jsonBody.token;
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    // Cookie value must match the token returned in the body (double-submit).
    expect(mockCookieSet).toHaveBeenCalledWith(
      "bastion_csrf",
      token,
      expect.objectContaining({ httpOnly: false, sameSite: "lax", path: "/" }),
    );
  });

  it("throttles minting per session so the endpoint cannot be spun for tokens", async () => {
    const { GET } = await import("@/app/api/csrf/route");
    await GET();
    expect(mockCsrfLimiterCheck).toHaveBeenCalledWith("sess-1");
  });

  it("returns 429 with Retry-After and mints nothing when the limit is exceeded", async () => {
    mockCsrfLimiterCheck.mockResolvedValueOnce({
      success: false,
      limit: 30,
      remaining: 0,
      retryAfter: 12,
    });
    const { GET } = await import("@/app/api/csrf/route");
    const res = await GET();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("does not spend a rate-limit token on an unauthenticated request", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/csrf/route");
    await GET();
    expect(mockCsrfLimiterCheck).not.toHaveBeenCalled();
  });
});
