import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/server
vi.mock("next/server", () => {
  class MockNextResponse {
    _cookies: Record<string, any> = {};
    cookies = {
      set: (name: string, value: string, opts: any) => {
        this._cookies[name] = { value, ...opts };
      },
    };
    _redirectUrl: string;

    constructor(url: string) {
      this._redirectUrl = url;
      // Bind cookies.set to this instance
      this.cookies = {
        set: (name: string, value: string, opts: any) => {
          this._cookies[name] = { value, ...opts };
        },
      };
    }

    static redirect(url: URL) {
      return new MockNextResponse(url.toString());
    }
  }

  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

// Mock auth
const mockConsumeMagicLink = vi.fn();
vi.mock("@/lib/auth", () => ({
  consumeMagicLink: (...args: unknown[]) => mockConsumeMagicLink(...args),
}));

vi.mock("@/lib/session", () => ({
  COOKIE_NAME: "bastion_session",
}));

import { GET } from "./route";

function makeRequest(queryString: string) {
  const url = new URL(`http://localhost:3000/auth/callback${queryString}`);
  return {
    nextUrl: url,
    url: url.toString(),
  } as any;
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when no token", async () => {
    const response = await GET(makeRequest(""));
    expect((response as any)._redirectUrl).toContain("/login");
  });

  it("redirects to /login?error=invalid_token when consumeMagicLink returns null", async () => {
    mockConsumeMagicLink.mockResolvedValueOnce(null);
    const response = await GET(makeRequest("?token=bad-token"));
    expect((response as any)._redirectUrl).toContain("/login?error=invalid_token");
  });

  it("sets cookie and redirects to /dashboard on valid token", async () => {
    mockConsumeMagicLink.mockResolvedValueOnce({
      session: { sid: "test-sid", cookie: "sealed-cookie" },
      user: { id: "user-1", email: "test@example.com", role: "admin" },
    });
    const response = await GET(makeRequest("?token=valid-token"));
    expect((response as any)._redirectUrl).toContain("/dashboard");
    expect((response as any)._cookies.bastion_session).toBeDefined();
    expect((response as any)._cookies.bastion_session.value).toBe("sealed-cookie");
  });

  it("redirects to /login?error=server_error on exception", async () => {
    mockConsumeMagicLink.mockRejectedValueOnce(new Error("DB error"));
    const response = await GET(makeRequest("?token=valid-token"));
    expect((response as any)._redirectUrl).toContain("/login?error=server_error");
  });
});
