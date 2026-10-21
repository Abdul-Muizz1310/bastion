import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/dossiers/[id]/advance` (spec 21 §6.2, Ruling AM): the visitor's page drives the dossier
 * in the foreground — stage after stage while the request's 300 s last (`driveDossier`; the loop
 * itself is tested in drive.test.ts) — and answers the last round's result with the stages it ran
 * and why it stopped. There is no `after()` hand-off: work kept alive only by after() did not survive
 * on Vercel. Rate-limited 60 a minute per visitor.
 */

const { check, createRateLimiter, driveDossier, afterCalls, chainTracer } = vi.hoisted(() => {
  const check = vi.fn();
  return {
    check,
    createRateLimiter: vi.fn(() => ({ check })),
    driveDossier: vi.fn(),
    afterCalls: [] as unknown[],
    chainTracer: vi.fn(async () => {}),
  };
});
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter }));
vi.mock("@/dossier/drive-dossier", () => ({ driveDossier }));
vi.mock("@/dossier/chain-trace", async (orig) => ({
  ...(await orig<typeof import("@/dossier/chain-trace")>()),
  chainTracer,
  instanceFacts: () => ({ instance: "0a1b2c3d", served: 7, coldStart: false, region: "iad1" }),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (task: unknown) => {
    afterCalls.push(task);
  },
}));

import { NextRequest } from "next/server";
import * as route from "@/app/api/dossiers/[id]/advance/route";
import type { DriveResult } from "@/dossier/drive";
import { UnknownDossierError } from "@/dossier/runner";
import { LEASE_MS, TIMEOUT_GRACE_MS } from "@/dossier/stages";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-21T12:00:00.000Z");

function post(headers: Record<string, string> = {}): Promise<Response> {
  const req = new NextRequest(`https://bastion.test/api/dossiers/${ID}/advance`, {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9", ...headers },
  });
  return route.POST(req, { params: Promise.resolve({ id: ID }) });
}

const driven = (overrides: Partial<DriveResult> = {}): DriveResult => ({
  last: { ran: "seal", status: "ok", dossier: "running", nextAt: new Date(NOW.getTime() + 60_000) },
  stages: [
    { stage: "wake", status: "ok" },
    { stage: "gather", status: "ok" },
    { stage: "seal", status: "ok" },
  ],
  stopped: "later",
  ...overrides,
});

const traced = () =>
  chainTracer.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 60, remaining: 59 });
  driveDossier.mockReset().mockResolvedValue(driven());
  chainTracer.mockClear();
  afterCalls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/dossiers/[id]/advance", () => {
  it("is dynamic and drives for up to 300 s", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(300);
    // A timed-out stage is held off until claim + lease + grace: the claiming invocation is gone by then.
    expect(route.maxDuration * 1000).toBe(LEASE_MS + TIMEOUT_GRACE_MS);
  });

  it("is rate-limited to 60 a minute per visitor — every caller is a visitor now", async () => {
    expect(createRateLimiter).toHaveBeenCalledWith({ max: 60, windowMs: 60_000 });
    await post({ "x-bastion-advance": "anything" });
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^advance:v_[a-z2-7]{10}$/));
  });

  it("answers 429 over the limit without driving", async () => {
    check.mockResolvedValue({ success: false, limit: 60, remaining: 0, retryAfter: 12 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(driveDossier).not.toHaveBeenCalled();
    expect(traced().map((e) => e.event)).toEqual([
      "advance.entry",
      "advance.refused",
      "advance.answer",
    ]);
  });

  it("drives in the foreground as the visitor, with the request's whole 300 s", async () => {
    const res = await post();
    expect(driveDossier).toHaveBeenCalledExactlyOnceWith(
      ID,
      expect.objectContaining({
        driver: "visitor",
        deadlineMs: NOW.getTime() + 300_000,
        emit: chainTracer,
        invocation: res.headers.get("x-bastion-invocation"),
      }),
    );
  });

  it("answers the last round's result with every stage it ran and why it stopped, uncached", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ran: "seal",
      status: "ok",
      dossier: "running",
      nextAt: new Date(NOW.getTime() + 60_000).toISOString(),
      stages: [
        { stage: "wake", status: "ok" },
        { stage: "gather", status: "ok" },
        { stage: "seal", status: "ok" },
      ],
      stopped: "later",
    });
  });

  it("hands nothing to after(): no work outlives the answer", async () => {
    await post();
    expect(afterCalls).toEqual([]);
  });

  it("answers 404 for an unknown dossier", async () => {
    driveDossier.mockRejectedValue(new UnknownDossierError(ID));
    const res = await post();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("unknown_dossier");
    expect(traced().at(-1)).toMatchObject({ event: "advance.answer", status: 404 });
  });

  it("answers 500 (logged) when driving fails unexpectedly, or no round fit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    driveDossier.mockRejectedValueOnce(new Error("connection refused"));
    expect((await post()).status).toBe(500);
    driveDossier.mockResolvedValueOnce(driven({ last: null, stages: [], stopped: "budget" }));
    const res = await post();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("advance_failed");
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("traces its entry and its answer under one invocation id", async () => {
    const res = await post();
    const invocation = res.headers.get("x-bastion-invocation");
    expect(invocation).toMatch(/^[0-9a-f]{8}$/);
    const events = traced();
    for (const e of events) expect(e).toMatchObject({ dossierId: ID, invocation });
    expect(events.map((e) => e.event)).toEqual(["advance.entry", "advance.answer"]);
    expect(events[0]).toMatchObject({
      host: "bastion.test",
      instance: "0a1b2c3d",
      served: 7,
      coldStart: false,
      region: "iad1",
    });
    expect(events[0]).not.toHaveProperty("chained");
    expect(events[1]).toMatchObject({ status: 200 });
  });
});
