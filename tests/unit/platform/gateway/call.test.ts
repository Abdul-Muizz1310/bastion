import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { z } from "zod";
import type { Capability } from "@/platform/gateway/call";
import { type RawBody, rawBodySchema } from "@/platform/gateway/result";
import { SERVICES, type ServiceId } from "@/platform/registry/products";
import type { VisitorId } from "@/platform/visitor";
import { newSigningEnv, type SigningEnv, stubSigningEnv, VISITOR } from "./keys-fixture";

/**
 * The one gateway pipeline (spec 21 §4): input → per-visitor rate limit → daily budget →
 * contract-v2 token → call → parse → exactly one audit event → typed result. The real budget
 * module (in-process store) and the real token minting run; the rate limiter, the audit writer
 * and the network are the seams.
 */

const { check, capCheck, appendEvent, limiterConfigs } = vi.hoisted(() => ({
  check: vi.fn(),
  capCheck: vi.fn(),
  appendEvent: vi.fn(),
  limiterConfigs: [] as { max: number; windowMs: number }[],
}));

vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: (config: { max: number; windowMs: number }) => {
    limiterConfigs.push(config);
    return { check: config.max === 30 ? check : capCheck };
  },
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));

type CallModule = typeof import("@/platform/gateway/call");
type BudgetModule = typeof import("@/platform/budget");

let gateway: CallModule;
let budget: BudgetModule;
let ConfigError: typeof import("@/platform/secrets").ConfigError;
let keys: SigningEnv;
let warn: MockInstance<typeof console.warn>;
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

const Verdict = z.object({ verdict: z.string() });
const debate: Capability<{ claim: string }, z.infer<typeof Verdict>> = {
  id: "test.debate",
  service: "paper-trail",
  method: "POST",
  path: () => "/debates",
  body: (i) => ({ claim: i.claim }),
  input: z.object({ claim: z.string().min(1) }),
  output: Verdict,
  grant: "editor",
  cost: "llm",
  budget: "debate",
};

const items: Capability<{ name: string }, { items: string[] }> = {
  id: "test.items",
  service: "magpie",
  method: "GET",
  path: (i) => `/sources/${encodeURIComponent(i.name)}/items?limit=5`,
  input: z.object({ name: z.string().min(1) }),
  output: z.object({ items: z.array(z.string()) }),
  grant: "viewer",
  cost: "free",
};

const ctx = { actor: VISITOR, requestId: "req-1", clientIp: "203.0.113.9" };
const sentInit = (i = 0) => fetchMock.mock.calls[i]?.[1] as RequestInit;
const sentHeaders = (i = 0) => new Headers(sentInit(i).headers);
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
const debateLeft = async () => (await budget.budgetsLeft()).debate.left;
/** The structured lines the gateway logs for refusals it does not audit (Ruling H). */
const refusalLines = () =>
  warn.mock.calls
    .map((call) => call[0])
    .filter((line): line is string => typeof line === "string" && line.includes("gateway.refused"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(async () => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  keys = newSigningEnv();
  stubSigningEnv(keys);
  limiterConfigs.length = 0;
  check.mockReset().mockResolvedValue({ success: true, limit: 30, remaining: 29 });
  capCheck.mockReset().mockResolvedValue({ success: true, limit: 2, remaining: 1 });
  appendEvent.mockReset().mockResolvedValue(1);
  fetchMock.mockReset().mockImplementation(async () => Response.json({ verdict: "supported" }));
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  gateway = await import("@/platform/gateway/call");
  budget = await import("@/platform/budget");
  ({ ConfigError } = await import("@/platform/secrets"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("callCapability — success", () => {
  it("returns the parsed data with the upstream status, request id and latency", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ verdict: "refuted" }, { status: 201 }));
    const result = await gateway.callCapability(debate, { claim: "the sky is green" }, ctx);
    expect(result).toStrictEqual({
      ok: true,
      data: { verdict: "refuted" },
      status: 201,
      requestId: "req-1",
      ms: expect.any(Number),
    });
    if (result.ok) expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("calls the service's base URL with the capability's method, path and JSON body", async () => {
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${SERVICES["paper-trail"].baseUrl}/debates`);
    expect(sentInit().method).toBe("POST");
    expect(sentInit().body).toBe(JSON.stringify({ claim: "c" }));
    expect(sentInit().redirect).toBe("manual");
  });

  it("sends a GET without a body or content type", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: ["a"] }));
    const result = await gateway.callCapability(items, { name: "hn" }, ctx);
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${SERVICES.magpie.baseUrl}/sources/hn/items?limit=5`,
    );
    expect(sentInit().body).toBeUndefined();
    expect(sentHeaders().has("content-type")).toBe(false);
  });

  it("parses an empty 204 as null", async () => {
    const remove: Capability<{ id: string }, null> = {
      id: "test.remove",
      service: "feathers-demo",
      method: "DELETE",
      path: (i) => `/users/${i.id}`,
      input: z.object({ id: z.string() }),
      output: z.null(),
      grant: "admin",
      cost: "quota",
    };
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await gateway.callCapability(remove, { id: "7" }, ctx)).toMatchObject({
      ok: true,
      data: null,
      status: 204,
    });
  });

  it("passes a multipart body through untouched, letting fetch set the boundary", async () => {
    const upload: Capability<{ name: string }, { id: string }> = {
      id: "test.upload",
      service: "inkthread",
      method: "POST",
      path: () => "/documents",
      grant: "editor",
      cost: "llm",
      budget: "upload",
      body: (i) => {
        const form = new FormData();
        form.set("file", new Blob(["%PDF-1.7"]), i.name);
        return form;
      },
      input: z.object({ name: z.string() }),
      output: z.object({ id: z.string() }),
    };
    fetchMock.mockResolvedValueOnce(Response.json({ id: "doc-1" }));
    await gateway.callCapability(upload, { name: "a.pdf" }, ctx);
    expect(sentInit().body).toBeInstanceOf(FormData);
    expect(sentHeaders().has("content-type")).toBe(false);
  });
});

describe("callCapability — headers and token", () => {
  it("sends exactly the platform token (twice), the request id, the client address and JSON headers", async () => {
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    const headers = sentHeaders();
    expect([...headers.keys()].sort()).toStrictEqual([
      "accept",
      "authorization",
      "content-type",
      "x-forwarded-for",
      "x-platform-token",
      "x-request-id",
    ]);
    const token = headers.get("x-platform-token") ?? "";
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("x-request-id")).toBe("req-1");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
  });

  it("mints a contract-v2 token for this service, actor, grant and capability", async () => {
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    const token = sentHeaders().get("x-platform-token") ?? "";
    const { payload } = await jose.jwtVerify(token, keys.publicKey, {
      issuer: "bastion",
      audience: "paper-trail",
    });
    expect(payload).toMatchObject({
      service: "paper-trail",
      sub: VISITOR,
      role: "editor",
      cap: "test.debate",
    });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("mints a fresh token (new jti) for every call", async () => {
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    const jti = (i: number) => jose.decodeJwt(sentHeaders(i).get("x-platform-token") ?? "").jti;
    expect(jti(0)).not.toBe(jti(1));
  });

  it("omits x-forwarded-for when there is no client address (system work)", async () => {
    await gateway.callCapability(debate, { claim: "c" }, { actor: "bastion", requestId: "r" });
    expect(sentHeaders().has("x-forwarded-for")).toBe(false);
  });

  it("never forwards anything from the input as a header", async () => {
    await gateway.callCapability(
      items,
      { name: "hn", "x-forwarded-for": "6.6.6.6", authorization: "Bearer forged" },
      ctx,
    );
    expect(sentHeaders().get("x-forwarded-for")).toBe("203.0.113.9");
    expect(sentHeaders().get("authorization")).not.toContain("forged");
  });
});

describe("callCapability — pipeline order", () => {
  it("answers invalid_input without checking limits, reserving budget or fetching", async () => {
    const result = await gateway.callCapability(debate, { claim: "" }, ctx);
    expect(result).toMatchObject({ ok: false, error: "invalid_input", status: 422 });
    if (!result.ok) expect(result.detail).toContain("claim");
    expect(check).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await debateLeft()).toBe(4);
  });

  it("answers rate_limited without reserving budget or fetching", async () => {
    check.mockResolvedValueOnce({ success: false, limit: 30, remaining: 0, retryAfter: 17 });
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toStrictEqual({
      ok: false,
      error: "rate_limited",
      status: 429,
      requestId: "req-1",
      retryAfterS: 17,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await debateLeft()).toBe(4);
  });

  it("limits each visitor to 30 calls a minute, keyed by the visitor", async () => {
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(gateway.VISITOR_CALLS_PER_MIN).toBe(30);
    expect(limiterConfigs).toContainEqual({ max: 30, windowMs: 60_000 });
    expect(check).toHaveBeenCalledWith(`gateway:${VISITOR}`);
  });

  it("applies a capability's own per-visitor limit on top", async () => {
    const tight = { ...debate, perVisitorPerMin: 2 };
    capCheck.mockResolvedValueOnce({ success: false, limit: 2, remaining: 0, retryAfter: 40 });
    const result = await gateway.callCapability(tight, { claim: "c" }, ctx);
    expect(limiterConfigs).toContainEqual({ max: 2, windowMs: 60_000 });
    expect(capCheck).toHaveBeenCalledWith(`gateway:test.debate:${VISITOR}`);
    expect(result).toMatchObject({ ok: false, error: "rate_limited", retryAfterS: 40 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not rate-limit system work, but still budgets it", async () => {
    await gateway.callCapability(debate, { claim: "c" }, { actor: "bastion", requestId: "r" });
    expect(check).not.toHaveBeenCalled();
    expect(await debateLeft()).toBe(3);
  });

  it("answers budget_exhausted (429) without fetching, retrying after UTC midnight", async () => {
    vi.stubEnv("BUDGET_DEBATE", "0");
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({ ok: false, error: "budget_exhausted", status: 429 });
    if (!result.ok) {
      expect(result.retryAfterS).toBeGreaterThanOrEqual(1);
      expect(result.retryAfterS).toBeLessThanOrEqual(86_400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at the daily budget: the fifth debate of the day never reaches paper-trail", async () => {
    for (let i = 0; i < 4; i++) {
      expect((await gateway.callCapability(debate, { claim: "c" }, ctx)).ok).toBe(true);
    }
    const fifth = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(fifth).toMatchObject({ ok: false, error: "budget_exhausted" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not touch any budget for an unbudgeted capability", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));
    await gateway.callCapability(items, { name: "hn" }, ctx);
    const left = await budget.budgetsLeft();
    for (const key of budget.BUDGET_KEYS) expect(left[key].left).toBe(left[key].limit);
  });

  it("keeps the reserved budget when the downstream answers 2xx", async () => {
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(await debateLeft()).toBe(3);
  });

  it("releases the reserved budget when the downstream answers 4xx", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "claim too long" }, { status: 422 }));
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toStrictEqual({
      ok: false,
      error: "downstream_error",
      status: 422,
      requestId: "req-1",
      detail: "claim too long",
    });
    expect(await debateLeft()).toBe(4);
  });

  it("falls back to the HTTP status when a 4xx body has no string detail", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: [{ loc: ["body"], msg: "x" }] }, { status: 400 }),
    );
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({ error: "downstream_error", status: 400, detail: "HTTP 400" });
  });

  it("truncates a long downstream detail", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "x".repeat(5_000) }, { status: 404 }));
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    if (result.ok) throw new Error("expected a failure");
    expect(result.detail?.length).toBeLessThanOrEqual(200);
  });

  it("maps a downstream 429 to rate_limited, releasing the budget", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("slow down", { status: 429, headers: { "retry-after": "12" } }),
    );
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({
      ok: false,
      error: "rate_limited",
      status: 429,
      retryAfterS: 12,
    });
    expect(await debateLeft()).toBe(4);
  });

  it("answers downstream_error 502 on a 5xx and keeps the budget (it may have been spent)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({ ok: false, error: "downstream_error", status: 502 });
    expect(await debateLeft()).toBe(3);
  });

  it("answers downstream_error 502 on a redirect instead of following it with the token", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }),
    );
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({
      ok: false,
      error: "downstream_error",
      status: 502,
      detail: "unexpected_redirect",
    });
  });

  it("answers downstream_error 502 on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({
      ok: false,
      error: "downstream_error",
      status: 502,
      detail: "network_error",
    });
  });

  it("answers asleep when the call times out, keeping the budget", async () => {
    fetchMock.mockImplementationOnce(hang);
    const result = await gateway.callCapability({ ...debate, timeoutMs: 20 }, { claim: "c" }, ctx);
    expect(result).toMatchObject({ ok: false, error: "asleep", status: 504 });
    expect(await debateLeft()).toBe(3);
  });

  it("times a call out after 30 s by default", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(gateway.DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it("answers invalid_response when a 2xx body does not match the schema, keeping the budget", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ verdict: 42, secret: "SECRET-VALUE" }));
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({ ok: false, error: "invalid_response", status: 502 });
    if (!result.ok) {
      expect(result.detail).toContain("verdict");
      expect(result.detail).not.toContain("42");
    }
    expect(await debateLeft()).toBe(3);
  });

  it("answers invalid_response when a 2xx body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>hi</html>", { status: 200 }));
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result).toMatchObject({ ok: false, error: "invalid_response", detail: "not_json" });
  });
});

describe("callCapability — raw capabilities", () => {
  const page: Capability<{ n: number }, RawBody> = {
    id: "test.page",
    service: "inkthread",
    method: "GET",
    path: (i) => `/documents/d1/pages/${i.n}.png`,
    input: z.object({ n: z.number().int().nonnegative() }),
    output: rawBodySchema,
    grant: "viewer",
    cost: "free",
    raw: "png",
  };
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  it("passes the bytes and content type through without parsing JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(PNG, { headers: { "content-type": "image/png" } }),
    );
    const result = await gateway.callCapability(page, { n: 0 }, ctx);
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    expect(result.data.contentType).toBe("image/png");
    expect(result.data.bytes).toBeInstanceOf(Uint8Array);
    expect([...result.data.bytes]).toStrictEqual([...PNG]);
    expect(sentHeaders().get("accept")).toBe("image/png");
  });

  it("keeps bytes that happen to look like JSON as bytes", async () => {
    const json = new TextEncoder().encode('{"a":1}');
    fetchMock.mockResolvedValueOnce(
      new Response(json, { headers: { "content-type": "image/png; q=1" } }),
    );
    const result = await gateway.callCapability(page, { n: 0 }, ctx);
    expect(result.ok && [...result.data.bytes]).toStrictEqual([...json]);
  });

  it("answers invalid_response when the content type is not the declared kind", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html/>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    const result = await gateway.callCapability(page, { n: 0 }, ctx);
    expect(result).toMatchObject({ ok: false, error: "invalid_response", status: 502 });
  });

  it("still reports a downstream 404 as downstream_error", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "no such page" }, { status: 404 }));
    const result = await gateway.callCapability(page, { n: 99 }, ctx);
    expect(result).toMatchObject({ error: "downstream_error", status: 404, detail: "no such page" });
  });
});

describe("callCapability — audit", () => {
  it("appends exactly one gateway.call event, with no request or response body", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ verdict: "SECRET-RESPONSE" }));
    await gateway.callCapability(debate, { claim: "SECRET-CLAIM" }, ctx);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const event = appendEvent.mock.calls[0]?.[0];
    expect(event).toStrictEqual({
      actor: VISITOR,
      action: "gateway.call",
      entityType: "capability",
      entityId: "test.debate",
      service: "paper-trail",
      requestId: "req-1",
      metadata: { status: 200, ms: expect.any(Number), ok: true },
    });
    expect(JSON.stringify(event)).not.toMatch(/SECRET/);
  });

  it("records the error kind and the status bastion answered with", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(appendEvent.mock.calls[0]?.[0].metadata).toStrictEqual({
      status: 502,
      ms: expect.any(Number),
      ok: false,
      error: "downstream_error",
    });
  });

  it.each([
    ["budget exhausted", { claim: "c" }, () => vi.stubEnv("BUDGET_DEBATE", "0")],
    ["timeout", { claim: "c" }, () => fetchMock.mockImplementationOnce(hang)],
    [
      "4xx",
      { claim: "c" },
      () => fetchMock.mockResolvedValueOnce(new Response("", { status: 404 })),
    ],
    [
      "invalid response",
      { claim: "c" },
      () => fetchMock.mockResolvedValueOnce(Response.json({})),
    ],
  ])("appends exactly one event when the call ends as %s", async (_label, input, arrange) => {
    arrange();
    await gateway.callCapability({ ...debate, timeoutMs: 20 }, input, ctx);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent.mock.calls[0]?.[0].metadata.ok).toBe(false);
  });

  it.each([
    ["invalid input", { claim: "" }, () => {}, "invalid_input", 422],
    [
      "rate limited",
      { claim: "SECRET-CLAIM" },
      () => check.mockResolvedValueOnce({ success: false, limit: 30, remaining: 0 }),
      "rate_limited",
      429,
    ],
  ])("writes no audit row for a %s refusal, only one structured log line (Ruling H)", async (_label, input, arrange, error, status) => {
    arrange();
    await gateway.callCapability(debate, input, ctx);
    expect(appendEvent).not.toHaveBeenCalled();
    const lines = refusalLines();
    expect(lines).toStrictEqual([
      {
        event: "gateway.refused",
        capability: "test.debate",
        service: "paper-trail",
        actor: VISITOR,
        requestId: "req-1",
        error,
        status,
      },
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SECRET/);
  });

  it("logs no refusal line for a call that reached the budget", async () => {
    vi.stubEnv("BUDGET_DEBATE", "0");
    await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(refusalLines()).toStrictEqual([]);
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });

  it("records the system actor for runner calls", async () => {
    await gateway.callCapability(debate, { claim: "c" }, { actor: "bastion", requestId: "r" });
    expect(appendEvent.mock.calls[0]?.[0].actor).toBe("bastion");
  });

  it("still returns the result when the audit write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    appendEvent.mockRejectedValueOnce(new Error("db down"));
    const result = await gateway.callCapability(debate, { claim: "c" }, ctx);
    expect(result.ok).toBe(true);
    expect(error).toHaveBeenCalled();
  });
});

describe("callCapability — refuses programming errors before any side effect", () => {
  const expectNoSideEffects = async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
    expect(await debateLeft()).toBe(4);
  };

  it.each([
    ["an actor that is not a visitor id", { ...ctx, actor: "alice" as VisitorId }],
    ["an empty request id", { ...ctx, requestId: "" }],
    ["a request id with a newline", { ...ctx, requestId: "a\r\nx-evil: 1" }],
    ["a forwarded-for chain instead of one address", { ...ctx, clientIp: "1.2.3.4, 5.6.7.8" }],
    ["a client address that is not an IP", { ...ctx, clientIp: "localhost" }],
  ])("throws on %s", async (_label, badCtx) => {
    await expect(gateway.callCapability(debate, { claim: "c" }, badCtx)).rejects.toThrow(TypeError);
    await expectNoSideEffects();
  });

  it.each([
    ["a path without a leading slash", () => "debates"],
    ["a path that changes the host", () => "@evil.example/steal"],
  ])("throws on %s", async (_label, path) => {
    await expect(
      gateway.callCapability({ ...debate, path }, { claim: "c" }, ctx),
    ).rejects.toThrow(TypeError);
    await expectNoSideEffects();
  });

  it.each([
    ["an empty id", { id: "" }],
    ["an unknown service", { service: "evil" as Capability<unknown, unknown>["service"] }],
    ["a zero timeout", { timeoutMs: 0 }],
    ["a fractional per-visitor limit", { perVisitorPerMin: 1.5 }],
    ["an unknown raw kind", { raw: "gif" as Capability<unknown, unknown>["raw"] }],
    ["an llm cost but no budget", { budget: undefined }],
  ])("throws on a capability with %s", async (_label, patch) => {
    await expect(
      gateway.callCapability({ ...debate, ...patch }, { claim: "c" }, ctx),
    ).rejects.toThrow(TypeError);
    await expectNoSideEffects();
  });

  it("throws on a GET capability that declares a body", async () => {
    const bad = { ...items, body: () => ({ x: 1 }) };
    await expect(gateway.callCapability(bad, { name: "hn" }, ctx)).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the budget and throws a ConfigError when the token cannot be minted", async () => {
    vi.stubEnv("BASTION_SIGNING_KEY_PRIVATE", "");
    await expect(gateway.callCapability(debate, { claim: "c" }, ctx)).rejects.toThrow(ConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await debateLeft()).toBe(4);
  });
});

describe("callCapability — paths are canonical before anything happens (Ruling G)", () => {
  /** Interpolates the raw input on purpose: the gateway is the last line, not the first. */
  const scrape: Capability<{ name: string }, { items: string[] }> = {
    id: "test.scrape",
    service: "magpie",
    method: "POST",
    path: (i) => `/api/scrape/${i.name}/once`,
    body: () => ({}),
    input: z.object({ name: z.string() }),
    output: z.object({ items: z.array(z.string()) }),
    grant: "editor",
    cost: "quota",
    budget: "scrape",
  };
  const scrapeLeft = async () => (await budget.budgetsLeft()).scrape.left;
  const expectRefusedBeforeSideEffects = async (name: string) => {
    const result = await gateway.callCapability(scrape, { name }, ctx);
    expect(result).toMatchObject({ ok: false, error: "invalid_input", status: 422 });
    expect(check).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
    expect(await scrapeLeft()).toBe(30);
  };

  it.each([
    ["..", ".."],
    [".", "."],
    ["lowercase %2e%2e", "%2e%2e"],
    ["uppercase %2E%2E", "%2E%2E"],
    ["mixed %2e%2E", "%2e%2E"],
    ["half-encoded .%2e", ".%2e"],
    ["half-encoded %2E.", "%2E."],
    ["a single %2e", "%2e"],
  ])("refuses the dot segment %s", async (_label, name) => {
    await expectRefusedBeforeSideEffects(name);
  });

  it.each([
    ["a space", "a b"],
    ["a backslash", "a\\b"],
    ["a fragment", "a#b"],
    ["a non-ASCII letter", "café"],
    ["a quote", 'a"b'],
    ["a newline", "a\nb"],
    ["a tab", "a\tb"],
  ])("refuses a path the URL parser would rewrite (%s)", async (_label, name) => {
    await expectRefusedBeforeSideEffects(name);
  });

  it.each([
    ["dots inside a segment", "a..b"],
    ["a leading dot", ".hidden"],
    ["three dots", "..."],
    ["an encoded slash", "a%2Fb"],
  ])("allows %s", async (_label, name) => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));
    const result = await gateway.callCapability(scrape, { name }, ctx);
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${SERVICES.magpie.baseUrl}/api/scrape/${name}/once`);
  });

  it("keeps a query string that the URL parser leaves alone", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));
    expect((await gateway.callCapability(items, { name: "hn" }, ctx)).ok).toBe(true);
  });

  it("accepts a base URL with its own path prefix", async () => {
    vi.stubEnv("MAGPIE_BACKEND_URL", "https://magpie.example/api/v2/");
    vi.resetModules();
    const prefixed = await import("@/platform/gateway/call");
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));
    expect((await prefixed.callCapability(items, { name: "hn" }, ctx)).ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://magpie.example/api/v2/sources/hn/items?limit=5",
    );
  });

  it("logs the refusal like any other invalid input (no audit row)", async () => {
    await gateway.callCapability(scrape, { name: ".." }, ctx);
    expect(refusalLines()).toMatchObject([{ capability: "test.scrape", error: "invalid_input" }]);
  });
});

describe("callCapability — capabilities routed by their input", () => {
  const queries: Capability<{ service: "magpie" | "slowquery" }, unknown[]> = {
    id: "test.queries",
    service: "slowquery",
    routeTo: (i) => i.service,
    method: "GET",
    path: () => "/_slowquery/queries",
    input: z.object({ service: z.enum(["magpie", "slowquery"]) }),
    output: z.array(z.unknown()),
    grant: "viewer",
    cost: "free",
  };

  beforeEach(() => {
    fetchMock.mockImplementation(async () => Response.json([]));
  });

  it("calls the service the input names, with a token for that audience", async () => {
    const result = await gateway.callCapability(queries, { service: "magpie" }, ctx);
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${SERVICES.magpie.baseUrl}/_slowquery/queries`);
    const token = sentHeaders().get("x-platform-token") ?? "";
    const { payload } = await jose.jwtVerify(token, keys.publicKey, {
      issuer: "bastion",
      audience: "magpie",
    });
    expect(payload).toMatchObject({ service: "magpie", cap: "test.queries" });
    expect(appendEvent.mock.calls[0]?.[0]).toMatchObject({ service: "magpie" });
  });

  it("goes to the capability's own service when the input names it", async () => {
    await gateway.callCapability(queries, { service: "slowquery" }, ctx);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${SERVICES.slowquery.baseUrl}/_slowquery/queries`);
  });

  it("throws before any side effect when the route names an unknown service", async () => {
    const bad = { ...queries, routeTo: () => "evil" as ServiceId };
    await expect(gateway.callCapability(bad, { service: "magpie" }, ctx)).rejects.toThrow(
      TypeError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });
});

describe("callCapability — PEM text", () => {
  const pem: Capability<Record<string, never>, RawBody> = {
    id: "test.pem",
    service: "inkprint",
    method: "GET",
    path: () => "/public-key.pem",
    input: z.object({}),
    output: rawBodySchema,
    grant: "viewer",
    cost: "free",
    raw: "pem",
  };
  const PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n";

  it.each([
    "text/plain; charset=utf-8",
    "application/x-pem-file",
  ])("passes a PEM served as %s through as bytes", async (contentType) => {
    fetchMock.mockResolvedValueOnce(new Response(PEM, { headers: { "content-type": contentType } }));
    const result = await gateway.callCapability(pem, {}, ctx);
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    expect(new TextDecoder().decode(result.data.bytes)).toBe(PEM);
    expect(result.data.contentType).toBe(contentType);
    expect(sentHeaders().get("accept")).toBe("text/plain, application/x-pem-file");
  });

  it("refuses a PEM capability answered with HTML", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html/>", { headers: { "content-type": "text/html" } }),
    );
    expect(await gateway.callCapability(pem, {}, ctx)).toMatchObject({
      ok: false,
      error: "invalid_response",
    });
  });
});

describe("callCapability — budgets count units, not calls (Ruling K)", () => {
  type Batch = { items: string[] };
  const seal: Capability<Batch, { ok: boolean }> = {
    id: "test.seal",
    service: "inkprint",
    method: "POST",
    path: () => "/certificates/batch",
    body: (i) => i,
    input: z.object({ items: z.array(z.string()).min(1) }),
    output: z.object({ ok: z.boolean() }),
    grant: "editor",
    cost: "quota",
    budget: "certify",
    budgetUnits: (i) => i.items.length,
  };
  const three = { items: ["a", "b", "c"] };
  const certifyLeft = async () => (await budget.budgetsLeft()).certify.left;

  beforeEach(() => {
    vi.stubEnv("BUDGET_CERTIFY", "5");
    fetchMock.mockImplementation(async () => Response.json({ ok: true }));
  });

  it("reserves as many units as the input says (a 3-item batch reserves 3)", async () => {
    expect((await gateway.callCapability(seal, three, ctx)).ok).toBe(true);
    expect(await certifyLeft()).toBe(2);
  });

  it.each([
    ["a 4xx", () => Response.json({ detail: "bad item" }, { status: 422 })],
    ["a downstream 429", () => new Response("slow", { status: 429 })],
  ])("gives all the units back on %s", async (_label, answer) => {
    fetchMock.mockResolvedValueOnce(answer());
    const result = await gateway.callCapability(seal, three, ctx);
    expect(result.ok).toBe(false);
    expect(await certifyLeft()).toBe(5);
  });

  it("keeps all the units on a 5xx (they may have been spent)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await gateway.callCapability(seal, three, ctx);
    expect(await certifyLeft()).toBe(2);
  });

  it("refuses a batch larger than what is left, without fetching or reserving any of it", async () => {
    await gateway.callCapability(seal, three, ctx);
    expect(await certifyLeft()).toBe(2);
    const result = await gateway.callCapability(seal, three, ctx);
    expect(result).toMatchObject({ ok: false, error: "budget_exhausted", status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await certifyLeft()).toBe(2);
  });

  it("still fits a batch that uses exactly what is left", async () => {
    await gateway.callCapability(seal, three, ctx);
    expect((await gateway.callCapability(seal, { items: ["d", "e"] }, ctx)).ok).toBe(true);
    expect(await certifyLeft()).toBe(0);
  });

  it("gives all the units back when the token cannot be minted", async () => {
    vi.stubEnv("BASTION_SIGNING_KEY_PRIVATE", "");
    await expect(gateway.callCapability(seal, three, ctx)).rejects.toThrow(ConfigError);
    expect(await certifyLeft()).toBe(5);
  });

  it("reserves one unit when a capability declares no units", async () => {
    const single = { ...seal, budgetUnits: undefined };
    await gateway.callCapability(single, three, ctx);
    expect(await certifyLeft()).toBe(4);
  });

  it.each([
    ["zero", 0],
    ["a fraction", 1.5],
    ["a negative", -3],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["an unsafe integer", 2 ** 53],
  ])("throws on units that are %s, before any side effect", async (_label, units) => {
    const bad = { ...seal, budgetUnits: () => units };
    await expect(gateway.callCapability(bad, three, ctx)).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
    expect(await certifyLeft()).toBe(5);
  });

  it("throws on units declared without a budget to count them against", async () => {
    const bad = { ...seal, budget: undefined };
    await expect(gateway.callCapability(bad, three, ctx)).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
