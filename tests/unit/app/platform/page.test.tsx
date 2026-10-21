import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUDGETS } from "@/platform/budget-keys";
import { PRODUCTS, SERVICES } from "@/platform/registry/products";
import { links, sliceByAttr, textOf } from "../../helpers/html";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const connection = vi.fn().mockResolvedValue(undefined);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => connection(),
}));

const budgetsLeft = vi.fn();
vi.mock("@/platform/budget", () => ({
  budgetsLeft: (...args: unknown[]) => budgetsLeft(...args),
}));

// The status poll's first answer, as the island would hold it after a poll (SSR runs no effects).
const pollAnswer = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/features/health/components/HealthProvider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/health/components/HealthProvider")>();
  return {
    ...actual,
    HealthProvider: ({ children }: { children: ReactNode }) =>
      createElement(
        actual.HealthProvider,
        pollAnswer.current ? { initial: pollAnswer.current as never, children } : { children },
      ),
  };
});

import PlatformPage, { metadata } from "@/app/platform/page";

/** `/platform` (spec 21 §3.2): the registry, live health, budgets and the token contract. */

const SHA = "3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f";
const SECRETS = {
  BASTION_SIGNING_KEY_PRIVATE: "SECRET-PRIVATE-KEY-MATERIAL",
  IRON_SESSION_PASSWORD: "SECRET-SESSION-PASSWORD-0123456789abcdef",
  DATABASE_URL: "postgresql://user:SECRET-DB-PASSWORD@db.example/bastion",
  UPSTASH_REDIS_REST_TOKEN: "SECRET-UPSTASH-TOKEN",
  RESEND_API_KEY: "SECRET-RESEND",
};

const BUDGETS = Object.fromEntries(
  Object.entries(DEFAULT_BUDGETS).map(([k, limit]) => [k, { limit, left: Math.floor(limit / 2) }]),
);

const render = async () => renderToStaticMarkup(await PlatformPage());

beforeEach(() => {
  connection.mockClear();
  pollAnswer.current = null;
  budgetsLeft.mockReset();
  budgetsLeft.mockResolvedValue(BUDGETS);
  for (const [k, v] of Object.entries(SECRETS)) vi.stubEnv(k, v);
  vi.stubEnv("BASTION_KEY_ID", "bastion-ed25519-2026-04");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/platform: the page", () => {
  it("is titled, is the platform page of the nav, and has one h1", async () => {
    expect(metadata).toMatchObject({ title: "platform" });
    const html = await render();
    const current = links(html).filter((l) => l.tag.includes('aria-current="page"'));
    expect(current.map((l) => l.href)).toEqual(["/platform"]);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("is rendered per request", async () => {
    await render();
    expect(connection).toHaveBeenCalledTimes(1);
  });
});

describe("/platform: products and repos", () => {
  it("links all 15 repos on GitHub, every PyPI package and every live frontend", async () => {
    const hrefs = links(await render()).map((l) => l.href ?? "");
    for (const p of PRODUCTS) {
      for (const r of p.repos) expect(hrefs).toContain(r.url);
      for (const pkg of p.packages) expect(hrefs).toContain(pkg.url);
      if (p.frontendUrl) expect(hrefs).toContain(p.frontendUrl);
      expect(hrefs).toContain(`/tools/${p.id}`);
    }
    expect(textOf(await render())).toMatch(/8 products.*15 repos.*6 services/);
  });
});

describe("/platform: services", () => {
  it("lists every service with its audience and host, checking before the first answer", async () => {
    const html = await render();
    for (const id of Object.keys(SERVICES)) {
      const row = sliceByAttr(html, "data-service", id);
      expect(textOf(row)).toContain(`aud ${id}`);
      expect(row).toContain('data-state="checking"');
      expect(textOf(row)).toContain(new URL(SERVICES[id as keyof typeof SERVICES].baseUrl).host);
    }
  });

  it("shows a live service's version and links its commit", async () => {
    pollAnswer.current = {
      phase: "ok",
      checkedAt: "2026-10-21T10:00:00.000Z",
      services: {
        magpie: {
          service: "magpie",
          state: "live",
          latencyMs: 181,
          version: "1.4.0",
          commitSha: SHA,
          checkedAt: "2026-10-21T10:00:00.000Z",
        },
      },
    };
    const row = sliceByAttr(await render(), "data-service", "magpie");
    expect(textOf(row)).toContain("1.4.0");
    expect(links(row).map((l) => l.href)).toContain(
      `https://github.com/Abdul-Muizz1310/magpie-backend/commit/${SHA}`,
    );
  });

  it("the status poll failing: every service reads unknown, the page still renders (invariant 7)", async () => {
    pollAnswer.current = { phase: "error", checkedAt: "2026-10-21T10:00:00.000Z" };
    const html = await render();
    for (const id of Object.keys(SERVICES)) {
      const row = sliceByAttr(html, "data-service", id);
      expect(row).toContain('data-state="unknown"');
      expect(textOf(row)).toMatch(/not reported/);
    }
  });

  it("bastion serves this page, at its deployed commit", async () => {
    const row = sliceByAttr(await render(), "data-service", "bastion");
    expect(textOf(row)).toMatch(/serving this page/);
    expect(links(row).map((l) => l.href)).toContain(
      `https://github.com/Abdul-Muizz1310/bastion/commit/${SHA}`,
    );
  });

  it("bastion with no deployed commit says it is not reported", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const row = sliceByAttr(await render(), "data-service", "bastion");
    expect(textOf(row)).toMatch(/not reported/);
  });
});

describe("/platform: today's budgets", () => {
  it("shows a meter for every budget", async () => {
    const html = await render();
    expect(html.match(/role="meter"/g)).toHaveLength(Object.keys(DEFAULT_BUDGETS).length);
    expect(textOf(html)).toMatch(/debates/);
    expect(textOf(html)).toMatch(/resets 00:00 UTC/);
  });

  it("the budget store failing: says so, guesses nothing, and the page renders (invariant 7)", async () => {
    budgetsLeft.mockRejectedValueOnce(new Error("upstash down"));
    const html = await render();
    expect(html).not.toContain('role="meter"');
    expect(textOf(html)).toMatch(/budgets are unavailable/);
    expect(textOf(html)).toMatch(/the gateway still enforces/);
  });
});

describe("/platform: the token contract", () => {
  it("states alg, kid, issuer, audience, TTL and leeway", async () => {
    const text = textOf(sliceByAttr(await render(), "data-section", "contract"));
    expect(text).toContain("EdDSA");
    expect(text).toContain("bastion-ed25519-2026-04");
    expect(text).toMatch(/iss.*"bastion"/);
    expect(text).toMatch(/aud.*service id/);
    expect(text).toMatch(/60 s/);
    expect(text).toMatch(/10 s/);
    expect(text).toMatch(/fail(s)? closed/);
  });

  it("links the JWKS, the contract spec and the token inspector", async () => {
    const hrefs = links(sliceByAttr(await render(), "data-section", "contract")).map((l) => l.href);
    expect(hrefs).toContain("/.well-known/jwks.json");
    expect(hrefs).toContain(
      "https://github.com/Abdul-Muizz1310/bastion/blob/main/docs/specs/22-platform-contract-v2.md",
    );
    expect(hrefs).toContain("/tools/bastion");
  });

  it("a malformed key id reads unreadable, never its value", async () => {
    vi.stubEnv("BASTION_KEY_ID", "bad key <id>");
    const html = await render();
    expect(textOf(sliceByAttr(html, "data-section", "contract"))).toMatch(/unreadable/);
    expect(html).not.toContain("bad key");
  });
});

describe("/platform: no secrets (invariant 7)", () => {
  it("contains no secret's value, whatever the environment holds", async () => {
    const html = await render();
    for (const value of Object.values(SECRETS)) expect(html).not.toContain(value);
    expect(html).not.toMatch(/SECRET-/);
  });
});
