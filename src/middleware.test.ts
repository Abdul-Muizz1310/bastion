import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Set test session password (must be >= 32 chars for verifySessionCookie)
const TEST_PASSWORD = "test-password-that-is-at-least-32-chars-long!!";
process.env.IRON_SESSION_PASSWORD = TEST_PASSWORD;

function makeValidCookie(sid: string): string {
  const hmac = crypto.createHmac("sha256", TEST_PASSWORD);
  hmac.update(sid);
  const sig = hmac.digest("base64url");
  return `${sid}.${sig}`;
}

// Mock next/server
vi.mock("next/server", () => {
  const MockNextResponse = {
    next: () => ({ type: "next" }),
    json: (body: unknown, init?: { status?: number }) => ({
      type: "json",
      body,
      status: init?.status ?? 200,
    }),
    redirect: (url: URL) => ({ type: "redirect", url: url.toString() }),
  };

  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

import { middleware } from "./middleware";

function makeRequest(pathname: string, cookies: Record<string, string> = {}) {
  return {
    nextUrl: {
      pathname,
      searchParams: new URLSearchParams(),
    },
    url: `http://localhost:3000${pathname}`,
    cookies: {
      get(name: string) {
        return cookies[name] ? { value: cookies[name] } : undefined;
      },
    },
  } as any;
}

describe("middleware", () => {
  it("allows public path / without session", () => {
    const result = middleware(makeRequest("/"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /login without session", () => {
    const result = middleware(makeRequest("/login"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /auth/callback without session", () => {
    const result = middleware(makeRequest("/auth/callback"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /api/health without session", () => {
    const result = middleware(makeRequest("/api/health"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /api/health/deep without session (startsWith)", () => {
    const result = middleware(makeRequest("/api/health/deep"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /api/status without session", () => {
    const result = middleware(makeRequest("/api/status"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /api/status/sub without session (startsWith)", () => {
    const result = middleware(makeRequest("/api/status/sub"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /api/public-key without session", () => {
    const result = middleware(makeRequest("/api/public-key"));
    expect(result).toEqual({ type: "next" });
  });

  it("allows /api/public-key/sub without session (startsWith)", () => {
    const result = middleware(makeRequest("/api/public-key/sub"));
    expect(result).toEqual({ type: "next" });
  });

  it("returns 401 JSON for unauthenticated API route", () => {
    const result = middleware(makeRequest("/api/proxy/something"));
    expect(result).toEqual({ type: "json", body: { error: "Unauthorized" }, status: 401 });
  });

  it("redirects to /login for unauthenticated page route", () => {
    const result = middleware(makeRequest("/dashboard"));
    expect(result).toMatchObject({ type: "redirect" });
    expect((result as any).url).toContain("/login");
  });

  it("allows authenticated page route with valid session cookie", () => {
    const cookie = makeValidCookie("test-session-id");
    const result = middleware(makeRequest("/dashboard", { bastion_session: cookie }));
    expect(result).toEqual({ type: "next" });
  });

  it("allows authenticated API route with valid session cookie", () => {
    const cookie = makeValidCookie("test-session-id");
    const result = middleware(makeRequest("/api/proxy/magpie", { bastion_session: cookie }));
    expect(result).toEqual({ type: "next" });
  });

  it("rejects forged session cookie for page route", () => {
    const result = middleware(makeRequest("/dashboard", { bastion_session: "forged-value" }));
    expect(result).toMatchObject({ type: "redirect" });
  });

  it("rejects forged session cookie for API route", () => {
    const result = middleware(
      makeRequest("/api/proxy/magpie", { bastion_session: "forged-value" }),
    );
    expect(result).toEqual({ type: "json", body: { error: "Unauthorized" }, status: 401 });
  });

  it("empty session cookie value triggers redirect", () => {
    const result = middleware(makeRequest("/dashboard", { bastion_session: "" }));
    expect(result).toMatchObject({ type: "redirect" });
  });
});
