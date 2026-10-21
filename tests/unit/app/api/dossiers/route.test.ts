import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/dossiers` (spec 21 §3): POST composes a dossier (202, then the runner is started with
 * after()); GET lists the 12 most recent, public fields only.
 */

const {
  check,
  createRateLimiter,
  createDossier,
  listPublicDossiers,
  afterCallbacks,
  afterKinds,
  chainAdvance,
} = vi.hoisted(() => {
  const check = vi.fn();
  return {
    check,
    createRateLimiter: vi.fn(() => ({ check })),
    createDossier: vi.fn(),
    listPublicDossiers: vi.fn(),
    afterCallbacks: [] as Array<() => unknown>,
    afterKinds: [] as Array<"function" | "promise">,
    chainAdvance: vi.fn(),
  };
});
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter }));
vi.mock("@/dossier/create", async (orig) => ({
  ...(await orig<typeof import("@/dossier/create")>()),
  createDossier,
}));
vi.mock("@/dossier/gallery", async (orig) => ({
  ...(await orig<typeof import("@/dossier/gallery")>()),
  listPublicDossiers,
}));
vi.mock("@/dossier/chain", async (orig) => ({
  ...(await orig<typeof import("@/dossier/chain")>()),
  chainAdvance,
}));
const { chainTracer } = vi.hoisted(() => ({ chainTracer: vi.fn(async () => {}) }));
vi.mock("@/dossier/chain-trace", async (orig) => ({
  ...(await orig<typeof import("@/dossier/chain-trace")>()),
  chainTracer,
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  // after() takes a function (run once the response closes) or a promise (kept alive at once).
  after: (task: (() => unknown) | Promise<unknown>) => {
    afterCallbacks.push(typeof task === "function" ? task : () => task);
    afterKinds.push(typeof task === "function" ? "function" : "promise");
  },
}));

import { NextRequest } from "next/server";
import * as route from "@/app/api/dossiers/route";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-21T12:00:00.000Z");
/** The hand-off's deadline: this invocation's start + maxDuration (300 s) − the 15 s margin. */
const DEADLINE = NOW.getTime() + 285_000;

function post(body: string, contentType = "application/json") {
  return route.POST(
    new NextRequest("https://bastion.test/api/dossiers", {
      method: "POST",
      body,
      headers: { "x-forwarded-for": "203.0.113.9", "content-type": contentType },
    }),
  );
}
const valid = JSON.stringify({ claim: "c", sources: ["hn"] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 3, remaining: 2 });
  createDossier.mockReset().mockImplementation(async (_i, ctx) => ({
    ok: true,
    dossierId: ID,
    requestId: ctx.requestId,
  }));
  chainAdvance.mockReset().mockResolvedValue(undefined);
  listPublicDossiers.mockReset().mockResolvedValue([]);
  afterCallbacks.length = 0;
  afterKinds.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/dossiers", () => {
  it("may stay until the first stage has answered (maxDuration 300)", () => {
    expect(route.maxDuration).toBe(300);
  });

  it("is dynamic and limited to 3 an hour per visitor", async () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(createRateLimiter).toHaveBeenCalledWith({ max: 3, windowMs: 3_600_000 });
    await post(valid);
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^compose:v_[a-z2-7]{10}$/));
  });

  it("answers 202 with the id, request id and url, and starts the runner with after()", async () => {
    const res = await post(valid);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ dossier_id: ID, request_id: res.headers.get("x-request-id"), url: `/d/${ID}` });
    expect(res.headers.get("cache-control")).toBe("no-store");
    await afterCallbacks[0]?.();
    expect(chainAdvance).toHaveBeenCalledWith("https://bastion.test", ID, 0, DEADLINE, expect.anything());
  });

  it("traces the start of the chain and hands its invocation id to the hand-off (spec 21 §6.2)", async () => {
    chainTracer.mockClear();
    await post(valid);
    const first = (chainTracer.mock.calls[0] as unknown[] | undefined)?.[0];
    expect(first).toMatchObject({ event: "start.chain", route: "create", dossierId: ID });
    const invocation = (first as { invocation: string }).invocation;
    expect(invocation).toMatch(/^[0-9a-f]{8}$/);
    expect(chainAdvance.mock.calls[0]?.[4]).toMatchObject({ trace: { invocation } });
  });

  it("hands after() the first advance as a promise, which a client gone before the 202 cannot drop", async () => {
    // Task 15: Next runs a *function* given to after() only when the response closes; a promise is
    // kept alive with waitUntil — the same form the advance route uses.
    await post(valid);
    expect(afterKinds).toEqual(["promise"]);
    expect(chainAdvance).toHaveBeenCalledExactlyOnceWith("https://bastion.test", ID, 0, DEADLINE, expect.anything());
  });

  it("passes the parsed, defaulted input and the visitor to the service", async () => {
    await post(valid);
    const [input, ctx] = createDossier.mock.calls[0] ?? [];
    expect(input).toMatchObject({ claim: "c", sources: ["hn"], documents: [], mode: "standard" });
    expect(ctx.visitor).toMatch(/^v_/);
  });

  it("answers 415 to a non-JSON body", async () => {
    expect((await post("claim=c", "text/plain")).status).toBe(415);
    expect(createDossier).not.toHaveBeenCalled();
  });

  it("answers 429 over the rate limit", async () => {
    check.mockResolvedValue({ success: false, limit: 3, remaining: 0, retryAfter: 1200 });
    const res = await post(valid);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1200");
    expect(createDossier).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{nope"],
    ["no evidence", JSON.stringify({ claim: "c" })],
    ["a long claim", JSON.stringify({ claim: "x".repeat(2000), sources: ["hn"] })],
  ])("answers 422 for %s", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_input");
    expect(createDossier).not.toHaveBeenCalled();
  });

  it("maps a service refusal to its status, detail and retry-after", async () => {
    createDossier.mockResolvedValue({
      ok: false,
      status: 429,
      error: "budget_exhausted",
      retryAfterS: 4000,
    });
    const res = await post(valid);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("4000");
    expect(await res.json()).toMatchObject({ error: "budget_exhausted", retryAfterS: 4000 });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("answers 500 create_failed when the write throws, without leaking the error", async () => {
    createDossier.mockRejectedValue(new Error("password=hunter2"));
    const res = await post(valid);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe("GET /api/dossiers", () => {
  const get = (query = "") => route.GET(new NextRequest(`https://bastion.test/api/dossiers${query}`));

  it("lists the public gallery", async () => {
    listPublicDossiers.mockResolvedValue([{ id: ID }]);
    const res = await get();
    expect(listPublicDossiers).toHaveBeenCalledWith(12, {});
    expect(await res.json()).toEqual({ dossiers: [{ id: ID }] });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["succeeded", "failed", "running", "pending"])(
    "filters by ?status=%s (Ruling AF)",
    async (status) => {
      await get(`?status=${status}`);
      expect(listPublicDossiers).toHaveBeenCalledWith(12, { status });
    },
  );

  it.each(["?status=SUCCEEDED", "?status=", "?status=done", "?status=succeeded&status=failed"])(
    "refuses %s with 422 before reading anything",
    async (query) => {
      const res = await get(query);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: "invalid_input" });
      expect(listPublicDossiers).not.toHaveBeenCalled();
    },
  );
});
