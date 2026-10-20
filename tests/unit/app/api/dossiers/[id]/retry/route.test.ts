import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/dossiers/[id]/retry {stage}` (spec 21 §6.4, "retry from this stage"): resets only an
 * `error` stage — and only while nothing after it is ok — to pending with attempt 0; 409 otherwise.
 * Rate-limited 5 an hour per visitor; the reset is audited (by `retryStage`) and the run restarts.
 */

const { check, createRateLimiter, retryStage, afterCallbacks, chainAdvance } = vi.hoisted(() => {
  const check = vi.fn();
  return {
    check,
    createRateLimiter: vi.fn(() => ({ check })),
    retryStage: vi.fn(),
    afterCallbacks: [] as Array<() => unknown>,
    chainAdvance: vi.fn(),
  };
});

vi.mock("@/platform/ratelimit", () => ({ createRateLimiter }));
vi.mock("@/dossier/runner", async (orig) => ({
  ...(await orig<typeof import("@/dossier/runner")>()),
  retryStage,
}));
vi.mock("@/dossier/chain", async (orig) => ({
  ...(await orig<typeof import("@/dossier/chain")>()),
  chainAdvance,
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb);
  },
}));

import { NextRequest } from "next/server";
import * as route from "@/app/api/dossiers/[id]/retry/route";
import { isVisitorId } from "@/platform/visitor";

const ID = "550e8400-e29b-41d4-a716-446655440000";

function post(body: string, contentType = "application/json"): Promise<Response> {
  const req = new NextRequest(`https://bastion.test/api/dossiers/${ID}/retry`, {
    method: "POST",
    body,
    headers: { "x-forwarded-for": "203.0.113.9", "content-type": contentType },
  });
  return route.POST(req, { params: Promise.resolve({ id: ID }) });
}

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 5, remaining: 4 });
  retryStage.mockReset().mockResolvedValue({ ok: true, dossier: "running" });
  chainAdvance.mockReset().mockResolvedValue(undefined);
  afterCallbacks.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/dossiers/[id]/retry", () => {
  it("is dynamic and rate-limited to 5 an hour per visitor", async () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(createRateLimiter).toHaveBeenCalledWith({ max: 5, windowMs: 3_600_000 });
    await post(JSON.stringify({ stage: "debate" }));
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^retry:v_[a-z2-7]{10}$/));
  });

  it("answers 429 over the limit without touching the dossier", async () => {
    check.mockResolvedValue({ success: false, limit: 5, remaining: 0, retryAfter: 900 });
    const res = await post(JSON.stringify({ stage: "debate" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("900");
    expect(retryStage).not.toHaveBeenCalled();
  });

  it("answers 415 to anything but a JSON body", async () => {
    const res = await post("stage=debate", "application/x-www-form-urlencoded");
    expect(res.status).toBe(415);
    expect(retryStage).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{"],
    ["no stage", "{}"],
    ["an unknown stage", JSON.stringify({ stage: "adjudicate" })],
    ["an extra key", JSON.stringify({ stage: "debate", attempt: 0 })],
  ])("answers 422 to %s", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_input");
    expect(retryStage).not.toHaveBeenCalled();
  });

  it("resets the stage as the visitor and restarts the run with after()", async () => {
    const res = await post(JSON.stringify({ stage: "debate" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stage: "debate", dossier: "running" });
    const [id, stage, actor] = retryStage.mock.calls[0] ?? [];
    expect([id, stage]).toEqual([ID, "debate"]);
    expect(isVisitorId(actor)).toBe(true);
    expect(afterCallbacks).toHaveLength(1);
    for (const cb of afterCallbacks) await cb();
    expect(chainAdvance).toHaveBeenCalledWith("https://bastion.test", ID, 0);
  });

  it("answers 404 for an unknown dossier", async () => {
    retryStage.mockResolvedValue({ ok: false, reason: "unknown_dossier" });
    const res = await post(JSON.stringify({ stage: "debate" }));
    expect(res.status).toBe(404);
    expect(afterCallbacks).toHaveLength(0);
  });

  it.each(["not_error", "later_stage_ok"])("answers 409 when the stage is %s", async (reason) => {
    retryStage.mockResolvedValue({ ok: false, reason });
    const res = await post(JSON.stringify({ stage: "debate" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_retryable", detail: reason });
    expect(afterCallbacks).toHaveLength(0);
  });
});
