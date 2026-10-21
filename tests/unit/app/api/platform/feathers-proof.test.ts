import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callCapability, check, budgetsLeft } = vi.hoisted(() => ({
  callCapability: vi.fn(),
  check: vi.fn(),
  budgetsLeft: vi.fn(),
}));
vi.mock("@/platform/gateway/call", async (orig) => ({
  ...(await orig<typeof import("@/platform/gateway/call")>()),
  callCapability: (...a: unknown[]) => callCapability(...a),
}));
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter: () => ({ check }) }));
vi.mock("@/platform/budget", async (orig) => ({
  ...(await orig<typeof import("@/platform/budget")>()),
  budgetsLeft: () => budgetsLeft(),
}));

import * as route from "@/app/api/platform/feathers-proof/route";

/**
 * `POST /api/platform/feathers-proof` (spec 21 §5.1, review fix 1): feathers' soft-delete proof run
 * on the server — create a user, delete THAT user, read it back — under one request id, so no
 * visitor can delete a user they did not create.
 */

const FIXTURES = resolve(__dirname, "../../../../fixtures/downstream/feathers-demo");
const created = JSON.parse(readFileSync(resolve(FIXTURES, "user-created.json"), "utf8"));

const req = (init: { body?: string; type?: string } = {}) =>
  new Request("https://bastion.test/api/platform/feathers-proof", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9", "content-type": init.type ?? "application/json" },
    body: init.body ?? "",
  });

const ok = (data: unknown, status: number, requestId: string) => ({ ok: true, data, status, requestId, ms: 3 });
const ids = () => callCapability.mock.calls.map((c) => (c[0] as { id: string }).id);

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 3, remaining: 2 });
  budgetsLeft.mockReset().mockResolvedValue({ "feathers.write": { limit: 50, left: 50 } });
  callCapability.mockReset();
  callCapability.mockImplementation(async (cap: { id: string }, input: { id?: string }, ctx: { requestId: string }) => {
    if (cap.id === "feathers.createUser") return ok(created, 201, ctx.requestId);
    if (cap.id === "feathers.deleteUser") return ok(null, 204, ctx.requestId);
    return { ok: false, error: "downstream_error", status: 404, detail: "User not found", requestId: ctx.requestId };
  });
});

describe("POST /api/platform/feathers-proof", () => {
  it("is rendered per request", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("creates a user, deletes that user, and reads it back — one request id, as the visitor", async () => {
    const res = await route.POST(req());
    expect(res.status).toBe(200);
    const rid = res.headers.get("x-request-id");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(ids()).toEqual(["feathers.createUser", "feathers.deleteUser", "feathers.user"]);
    for (const call of callCapability.mock.calls) {
      expect(call[2]).toMatchObject({ requestId: rid, actor: expect.stringMatching(/^v_/) });
    }
    expect(callCapability.mock.calls[1]?.[1]).toEqual({ id: created.id });
    expect(callCapability.mock.calls[2]?.[1]).toEqual({ id: created.id });
    const body = await res.json();
    expect(body).toMatchObject({ verdict: "honoured", requestId: rid, user: { id: created.id } });
    expect(body.steps.map((s: { step: string; status: number }) => [s.step, s.status])).toEqual([
      ["create", 201],
      ["delete", 204],
      ["read", 404],
    ]);
  });

  it("makes up its own user: a body cannot name one to delete", async () => {
    await route.POST(req({ body: JSON.stringify({ id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", email: "victim@x.io" }) }));
    const input = callCapability.mock.calls[0]?.[1] as { email: string };
    expect(input.email).toMatch(/^proof-[0-9a-f]{8}@example\.com$/);
    expect(callCapability.mock.calls[1]?.[1]).toEqual({ id: created.id });
  });

  it("calls a user still readable after its delete a leak", async () => {
    callCapability.mockImplementation(async (cap: { id: string }, _i: unknown, ctx: { requestId: string }) =>
      cap.id === "feathers.deleteUser" ? ok(null, 204, ctx.requestId) : ok(created, 200, ctx.requestId),
    );
    expect((await (await route.POST(req())).json()).verdict).toBe("leaked");
  });

  it("stops after a refused create, deleting nothing", async () => {
    callCapability.mockImplementation(async (_c: unknown, _i: unknown, ctx: { requestId: string }) => ({
      ok: false,
      error: "budget_exhausted",
      status: 429,
      retryAfterS: 600,
      requestId: ctx.requestId,
    }));
    const body = await (await route.POST(req())).json();
    expect(body.verdict).toBe("incomplete");
    expect(body.steps).toEqual([
      { step: "create", ok: false, status: 429, kind: "budget_exhausted", detail: null },
    ]);
    expect(ids()).toEqual(["feathers.createUser"]);
  });

  it("refuses before calling anything when fewer than its 2 writes are left today", async () => {
    budgetsLeft.mockResolvedValue({ "feathers.write": { limit: 50, left: 1 } });
    const res = await route.POST(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "budget_exhausted" });
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("limits each visitor, before calling anything", async () => {
    check.mockResolvedValue({ success: false, limit: 3, remaining: 0, retryAfter: 20 });
    const res = await route.POST(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("20");
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^feathers-proof:v_[a-z2-7]{10}$/));
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("refuses a request that is not JSON, so a cross-site form cannot run it", async () => {
    const res = await route.POST(req({ type: "application/x-www-form-urlencoded" }));
    expect(res.status).toBe(415);
    expect(callCapability).not.toHaveBeenCalled();
  });
});
