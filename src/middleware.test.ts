import { describe, expect, it, vi } from "vitest";

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

  it("allows authenticated page route with session cookie", () => {
    const result = middleware(makeRequest("/dashboard", { bastion_session: "some-value" }));
    expect(result).toEqual({ type: "next" });
  });

  it("allows authenticated API route with session cookie", () => {
    const result = middleware(makeRequest("/api/proxy/magpie", { bastion_session: "some-value" }));
    expect(result).toEqual({ type: "next" });
  });

  it("empty session cookie value triggers redirect", () => {
    const result = middleware(makeRequest("/dashboard", { bastion_session: "" }));
    expect(result).toMatchObject({ type: "redirect" });
  });
});
