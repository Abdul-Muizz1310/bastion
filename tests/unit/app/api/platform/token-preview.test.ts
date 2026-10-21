import { beforeEach, describe, expect, it, vi } from "vitest";

const { check, mintToken } = vi.hoisted(() => ({ check: vi.fn(), mintToken: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter: () => ({ check }) }));
vi.mock("@/platform/gateway/token", async (orig) => ({
  ...(await orig<typeof import("@/platform/gateway/token")>()),
  mintToken: (...a: unknown[]) => mintToken(...a),
}));

import * as route from "@/app/api/platform/token-preview/route";
import { DEFAULT_KEY_ID } from "@/platform/gateway/keys";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `GET /api/platform/token-preview?capability=<id>` (spec 21 §5, §5.1 invariant 8): the header and
 * claims bastion would mint for one capability as this visitor — decoded, never signed — and the
 * JWKS that would verify it.
 */

const IP = "203.0.113.9";
const req = (query: string) =>
  new Request(`https://bastion.test/api/platform/token-preview${query}`, {
    headers: { "x-forwarded-for": IP },
  });

const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  vi.stubEnv("BASTION_KEY_ID", "");
  check.mockReset().mockResolvedValue({ success: true, limit: 60, remaining: 59 });
  mintToken.mockReset();
});

describe("GET /api/platform/token-preview", () => {
  it("is rendered per request and never cached", async () => {
    expect(route.dynamic).toBe("force-dynamic");
    const res = await route.GET(req("?capability=inkprint.certify"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the claims bastion would mint for the capability, as this visitor", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await route.GET(req("?capability=inkprint.certify"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.header).toEqual({ alg: "EdDSA", kid: DEFAULT_KEY_ID });
    expect(body.claims).toMatchObject({
      iss: "bastion",
      aud: "inkprint",
      service: "inkprint",
      sub: visitorFromRequest(req("")),
      role: "editor",
      cap: "inkprint.certify",
    });
    expect(body.claims.iat).toBeGreaterThanOrEqual(before);
    expect(body.claims.exp - body.claims.iat).toBe(60);
    expect(body.claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.jwks).toBe("/.well-known/jwks.json");
    expect(body.capability).toEqual({
      id: "inkprint.certify",
      service: "inkprint",
      grant: "editor",
      cost: "quota",
      budget: "certify",
      routed: false,
    });
  });

  it("says when the audience follows the host a call is routed to", async () => {
    const body = await (await route.GET(req("?capability=slowquery.queries"))).json();
    expect(body.capability.routed).toBe(true);
  });

  it("never signs anything: no token, nothing shaped like one", async () => {
    const res = await route.GET(req("?capability=feathers.createUser"));
    const text = await res.text();
    expect(mintToken).not.toHaveBeenCalled();
    const strings: string[] = [];
    JSON.parse(text, (_k, v) => {
      if (typeof v === "string") strings.push(v);
      return v;
    });
    for (const s of strings) expect(s).not.toMatch(JWS);
    expect(text).not.toMatch(/"(token|signature|jws)"/i);
  });

  it.each([
    ["no capability", "", 422],
    ["an empty capability", "?capability=", 422],
    ["a repeated capability", "?capability=magpie.sources&capability=magpie.items", 422],
    ["an unknown capability", "?capability=magpie.nope", 404],
    ["a prototype key", "?capability=__proto__", 404],
  ])("refuses %s", async (_name, query, status) => {
    const res = await route.GET(req(query));
    expect(res.status).toBe(status);
  });

  it("limits each visitor to 60 a minute", async () => {
    check.mockResolvedValue({ success: false, limit: 60, remaining: 0, retryAfter: 5 });
    const res = await route.GET(req("?capability=magpie.sources"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^token-preview:v_/));
  });

  it("answers 503 when the key id is misconfigured, naming no value", async () => {
    vi.stubEnv("BASTION_KEY_ID", "bad kid!");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await route.GET(req("?capability=magpie.sources"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "signing_key_unconfigured" });
  });
});
