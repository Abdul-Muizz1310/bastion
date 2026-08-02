import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The response headers set by `next.config.ts` are a documented security
 * control (docs/ARCHITECTURE.md invariant 10). They are asserted here so the
 * docs and the config cannot drift apart again.
 */

type HeaderEntry = { key: string; value: string };

async function headersFor(nodeEnv: string): Promise<Record<string, string>> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const mod = await import("../../next.config");
  const config = mod.default;
  const rules = await config.headers?.();
  if (!rules || rules.length === 0) throw new Error("next.config.ts sets no headers");
  const catchAll = rules.find((rule) => rule.source === "/(.*)");
  if (!catchAll) throw new Error("no catch-all header rule");
  const out: Record<string, string> = {};
  for (const entry of catchAll.headers as HeaderEntry[]) {
    out[entry.key] = entry.value;
  }
  return out;
}

function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!found) throw new Error(`CSP has no ${name} directive: ${csp}`);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("next.config.ts security headers", () => {
  it("production script-src does not permit 'unsafe-eval'", async () => {
    const headers = await headersFor("production");
    const scriptSrc = directive(headers["Content-Security-Policy"], "script-src");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(scriptSrc).toContain("'self'");
  });

  it("development script-src keeps 'unsafe-eval' — the dev bundler needs it", async () => {
    const headers = await headersFor("development");
    const scriptSrc = directive(headers["Content-Security-Policy"], "script-src");
    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it("script-src still allows 'unsafe-inline' in production for Next's bootstrap", async () => {
    // Documented truthfully in docs/ARCHITECTURE.md invariant 10: the CSP
    // restricts *sources*, it does not block inline scripts.
    const headers = await headersFor("production");
    const scriptSrc = directive(headers["Content-Security-Policy"], "script-src");
    expect(scriptSrc).toContain("'unsafe-inline'");
  });

  it("keeps the source-restricting directives in every environment", async () => {
    for (const env of ["production", "development"]) {
      const csp = (await headersFor(env))["Content-Security-Policy"];
      expect(directive(csp, "default-src")).toBe("default-src 'self'");
      expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
      expect(directive(csp, "img-src")).toContain("'self'");
      expect(directive(csp, "connect-src")).toContain("'self'");
    }
  });

  it("keeps the non-CSP hardening headers", async () => {
    const headers = await headersFor("production");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });
});
