import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubGateway, fetchMock, fixture, fixtureBytes } from "../../../capabilities/harness";

/**
 * `/api/tools/[capability]` — every product, through the one gateway (spec 21 §3, §4): GET reads the
 * input from the query string, POST from a JSON body; a `GatewayResult` becomes the HTTP answer;
 * every response carries a fresh `x-request-id`. The real gateway runs against a stubbed network.
 */

const { appendEvent, check } = vi.hoisted(() => ({ appendEvent: vi.fn(), check: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter: () => ({ check }) }));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));
vi.mock("@/platform/gateway/call", async (orig) => {
  const actual = await orig<typeof import("@/platform/gateway/call")>();
  return { ...actual, callCapability: vi.fn(actual.callCapability) };
});

import * as route from "@/app/api/tools/[capability]/route";
import { callCapability } from "@/platform/gateway/call";
import { SERVICES } from "@/platform/registry/products";
import { isVisitorId } from "@/platform/visitor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const USER = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const IP = "203.0.113.9";

type Init = { body?: string; headers?: Record<string, string> };

function request(method: "GET" | "POST", path: string, init: Init = {}): Request {
  const headers = new Headers({ "x-forwarded-for": `${IP}, 10.0.0.1` });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value);
  return new Request(`https://bastion.test/api/tools/${path}`, {
    method,
    body: init.body,
    headers,
  });
}

async function get(path: string, init?: Init): Promise<Response> {
  const capability = decodeURIComponent(path.split("?")[0] ?? "");
  return route.GET(request("GET", path, init), { params: Promise.resolve({ capability }) });
}

async function post(path: string, body: unknown, init: Init = {}): Promise<Response> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return route.POST(request("POST", path, { body: text, ...init }), {
    params: Promise.resolve({ capability: path }),
  });
}

const answer = (value: unknown, status = 200) => fetchMock.mockResolvedValueOnce(Response.json(value, { status }));

beforeEach(() => {
  stubGateway();
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  appendEvent.mockReset().mockResolvedValue(1);
  check.mockReset().mockResolvedValue({ success: true, limit: 30, remaining: 29 });
  vi.mocked(callCapability).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("route segment config", () => {
  it("is dynamic and allows the slowest capability's timeout", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBeGreaterThanOrEqual(100);
  });
});

describe("which capabilities answer", () => {
  it.each([["nope.nothing"], ["constructor"], ["__proto__"], ["toString"], ["magpie"]])(
    "answers 404 for the unknown capability %j, without calling anything",
    async (id) => {
      const res = await get(id);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toStrictEqual({ error: "unknown_capability", requestId: expect.any(String) });
      expect(res.headers.get("x-request-id")).toBe(body.requestId);
      expect(callCapability).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["GET", () => get("inkthread.upload")],
    ["POST", () => post("inkthread.upload", {})],
  ])("refuses inkthread.upload on %s: uploads go through /api/uploads only", async (_m, send) => {
    const res = await send();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_a_tool" });
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("answers 405 to a GET of a POST capability, naming the method it takes", async () => {
    const res = await get("magpie.scrape?source=hackernews");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await res.json()).toMatchObject({ error: "method_not_allowed" });
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("answers 405 to a POST of a GET capability", async () => {
    const res = await post("magpie.sources", {});
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });

  it("refuses feathers.deleteUser: only the server-side proof may delete, and only its own user", async () => {
    const res = await post("feathers.deleteUser", { id: USER });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: "not_a_tool",
      detail: "use /api/platform/feathers-proof",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET — input from the query string", () => {
  it("calls the capability with the query and answers its parsed data", async () => {
    const items = fixture("magpie", "items.json");
    answer(items);
    const res = await get("magpie.items?name=hackernews&limit=5");
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${SERVICES.magpie.baseUrl}/sources/hackernews/items?limit=5`,
    );
    expect(await res.json()).toStrictEqual(items);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a __proto__ parameter as an unknown key, not a prototype", async () => {
    const res = await get("magpie.sources?__proto__=x");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a repeated query parameter instead of picking one", async () => {
    const res = await get("magpie.items?name=hackernews&name=lobsters");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the gateway's invalid_input with its detail", async () => {
    const res = await get("magpie.items?name=..");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_input", requestId: expect.any(String) });
    expect(body.detail).toContain("name");
  });

  it("streams a raw capability's bytes with the upstream content type", async () => {
    const pem = fixtureBytes("inkprint", "public-key.pem");
    fetchMock.mockResolvedValueOnce(
      new Response(pem, { headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
    const res = await get("inkprint.publicKey");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(new Uint8Array(await res.arrayBuffer())).toStrictEqual(pem);
  });

  it("streams a page PNG", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    fetchMock.mockResolvedValueOnce(new Response(png, { headers: { "content-type": "image/png" } }));
    const res = await get(`inkthread.page?documentId=${DOC}&page=1`);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toStrictEqual(png);
  });
});

describe("POST — input from a JSON body", () => {
  it("calls the capability with the body and keeps the upstream status", async () => {
    answer(fixture("paper-trail", "debate-create.json"), 201);
    const res = await post("paper-trail.debate", { claim: "The fee is 350.", max_rounds: 1 });
    expect(res.status).toBe(201);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toStrictEqual({
      claim: "The fee is 350.",
      max_rounds: 1,
    });
  });

  it("answers 415 unless the body is declared JSON", async () => {
    const res = await post("slowquery.switch", '{"target":"fast"}', {
      headers: { "content-type": "text/plain" },
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: "unsupported_media_type" });
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("answers 422 to a body that is not JSON", async () => {
    const res = await post("slowquery.switch", "{target:");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "invalid_input", detail: "body is not JSON" });
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("treats an empty body as no input", async () => {
    const res = await post("slowquery.switch", "");
    expect(res.status).toBe(422);
    expect(vi.mocked(callCapability).mock.calls[0]?.[1]).toStrictEqual({});
  });
});

describe("the context every call carries", () => {
  it("acts as the visitor, forwards one client address and a fresh request id", async () => {
    answer(fixture("inkthread", "samples.json"));
    answer(fixture("inkthread", "samples.json"));
    const first = await get("inkthread.samples");
    const second = await get("inkthread.samples");
    const [, , ctx] = vi.mocked(callCapability).mock.calls[0] ?? [];
    expect(isVisitorId(ctx?.actor)).toBe(true);
    expect(ctx?.clientIp).toBe(IP);
    const id = first.headers.get("x-request-id") ?? "";
    expect(id).toMatch(UUID);
    expect(ctx?.requestId).toBe(id);
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get("x-request-id")).toBe(id);
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get("x-forwarded-for")).toBe(IP);
    expect(second.headers.get("x-request-id")).not.toBe(id);
  });

  it("forwards no address when the request carries none it can trust", async () => {
    answer(fixture("inkthread", "samples.json"));
    const req = new Request("https://bastion.test/api/tools/inkthread.samples", {
      headers: { "x-forwarded-for": "unknown" },
    });
    const res = await route.GET(req, { params: Promise.resolve({ capability: "inkthread.samples" }) });
    expect(res.status).toBe(200);
    expect(vi.mocked(callCapability).mock.calls[0]?.[2].clientIp).toBeUndefined();
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).has("x-forwarded-for")).toBe(false);
  });
});

describe("errors become HTTP answers", () => {
  it("passes a downstream 404 through with its reason", async () => {
    answer({ detail: "Certificate not found" }, 404);
    const res = await get("inkprint.certificate?id=2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toStrictEqual({
      error: "downstream_error",
      detail: "Certificate not found",
      requestId: res.headers.get("x-request-id"),
    });
  });

  it("answers budget_exhausted as 429 with retry-after", async () => {
    vi.stubEnv("BUDGET_DEBATE", "0");
    const res = await post("paper-trail.debate", { claim: "c" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: "budget_exhausted", retryAfterS: expect.any(Number) });
    expect(res.headers.get("retry-after")).toBe(String(body.retryAfterS));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the gateway's own rate limit as 429 with retry-after", async () => {
    check.mockResolvedValueOnce({ success: false, limit: 30, remaining: 0, retryAfter: 17 });
    const res = await get("inkthread.samples");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
  });

  it("answers asleep as 504", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const res = await get("inkthread.samples");
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: "asleep" });
    expect(res.headers.has("retry-after")).toBe(false);
  });

  it("answers an unexpected body shape as 502 invalid_response, never the body", async () => {
    answer({ items: [{ id: "SECRET-VALUE" }] });
    const res = await get("inkthread.samples");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: "invalid_response" });
    expect(text).not.toContain("SECRET-VALUE");
  });
});
