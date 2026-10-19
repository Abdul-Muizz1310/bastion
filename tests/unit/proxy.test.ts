import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";
import nextConfig from "../../next.config";

/**
 * Spec 21 §2 — no sign-in: the proxy gates nothing. It passes every request through and
 * stamps the security headers on it (the same set next.config.ts declares).
 */

const ORIGIN = "https://bastion.test";

function get(path: string, init: { headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { headers: init.headers });
}

async function configHeaders(): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const catchAll = rules.find((rule) => rule.source === "/(.*)");
  if (!catchAll) throw new Error("next.config.ts has no catch-all header rule");
  return Object.fromEntries(catchAll.headers.map((h) => [h.key, h.value]));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — no gating", () => {
  const PAGES = [
    "/",
    "/audit",
    "/audit/req-1",
    "/time-travel",
    "/dashboard",
    "/d/abc",
    "/tools/magpie",
  ];

  it.each(PAGES)("passes %s through (200, no redirect)", (path) => {
    const response = proxy(get(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(getRedirectUrl(response)).toBeNull();
  });

  it("passes an API route through instead of answering 401", () => {
    const response = proxy(get("/api/proxy/magpie/sources"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("ignores a leftover v1 session cookie — it neither admits nor rejects", () => {
    const response = proxy(get("/audit", { headers: { cookie: "bastion_session=forged.value" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sets no cookie", () => {
    const response = proxy(get("/"));
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("proxy — security headers", () => {
  it("still sets the CSP and the hardening headers", () => {
    const response = proxy(get("/audit"));
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it.each(["production", "development"])(
    "in %s, sets exactly the headers next.config.ts declares",
    async (env) => {
      vi.stubEnv("NODE_ENV", env);
      const declared = await configHeaders();
      const response = proxy(get("/"));
      for (const [key, value] of Object.entries(declared)) {
        expect(response.headers.get(key), key).toBe(value);
      }
    },
  );

  it("production CSP does not permit 'unsafe-eval'", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(proxy(get("/")).headers.get("content-security-policy")).not.toContain("unsafe-eval");
  });
});

describe("proxy — matcher", () => {
  it.each(["/", "/audit", "/api/health", "/opengraph-image"])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(true);
  });

  it.each([
    "/_next/static/chunks/app.js",
    "/_next/image?url=x",
    "/favicon.ico",
    "/assets/logo.svg",
  ])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(false);
  });
});
