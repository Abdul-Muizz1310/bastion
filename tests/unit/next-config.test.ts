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

describe("next.config.ts — no sign-in", () => {
  it("drops experimental.authInterrupts: there are no forbidden/unauthorized pages any more", async () => {
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    expect(config.experimental?.authInterrupts).toBeUndefined();
  });
});

describe("next.config.ts — v1 links keep working (spec 21 §3.2)", () => {
  async function redirects() {
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    const rules = await config.redirects?.();
    if (!rules) throw new Error("next.config.ts sets no redirects");
    return rules;
  }

  it("sends /dashboard to /platform and /services/<product> to its workbench, permanently", async () => {
    const { PRODUCTS } = await import("@/platform/registry/products");
    expect(await redirects()).toEqual([
      { source: "/dashboard", destination: "/platform", permanent: true },
      {
        source: `/services/:id(${PRODUCTS.map((p) => p.id).join("|")})`,
        destination: "/tools/:id",
        permanent: true,
      },
    ]);
  });

  it("matches every product id and nothing else, so an unknown /services/<x> stays a 404", async () => {
    // Next's own matcher for `source` patterns; the compiled module ships without types.
    // @ts-expect-error -- untyped JS module bundled inside next
    const compiled: unknown = await import("next/dist/compiled/path-to-regexp");
    const { pathToRegexp } = compiled as {
      pathToRegexp: (source: string, keys: unknown[], options: object) => RegExp;
    };
    const { PRODUCTS } = await import("@/platform/registry/products");
    const rule = (await redirects()).find((r) => r.source.startsWith("/services/"));
    if (!rule) throw new Error("no /services rule");
    const re = pathToRegexp(rule.source, [], {});
    for (const p of PRODUCTS) expect(re.test(`/services/${p.id}`)).toBe(true);
    for (const path of ["/services/unknown", "/services", "/services/magpie/x", "/services/magpie-x"]) {
      expect(re.test(path)).toBe(false);
    }
  });
});
