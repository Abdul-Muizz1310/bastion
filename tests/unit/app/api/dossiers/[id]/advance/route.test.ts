import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/dossiers/[id]/advance` (spec 21 §6.2): runs one stage of a dossier and, when a stage
 * finished and more remain, schedules the next advance with `after()`. Rate-limited 60/min per
 * visitor; the runner's own chained calls carry the internal HMAC header and are not limited.
 */

const { check, createRateLimiter, advance, afterCallbacks, chainAdvance } = vi.hoisted(() => {
  const check = vi.fn();
  return {
    check,
    createRateLimiter: vi.fn(() => ({ check })),
    advance: vi.fn(),
    afterCallbacks: [] as Array<() => unknown>,
    chainAdvance: vi.fn(),
  };
});

vi.mock("@/platform/ratelimit", () => ({ createRateLimiter }));
vi.mock("@/dossier/runner", async (orig) => ({
  ...(await orig<typeof import("@/dossier/runner")>()),
  advance,
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
import * as route from "@/app/api/dossiers/[id]/advance/route";
import { ADVANCE_HEADER, advanceToken } from "@/dossier/chain";
import { HANDLERS } from "@/dossier/handlers";
import { type AdvanceResult, UnknownDossierError } from "@/dossier/runner";
import { LEASE_MS, TIMEOUT_GRACE_MS } from "@/dossier/stages";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

function post(headers: Record<string, string> = {}): Promise<Response> {
  const req = new NextRequest(`https://bastion.test/api/dossiers/${ID}/advance`, {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9", ...headers },
  });
  return route.POST(req, { params: Promise.resolve({ id: ID }) });
}

const result = (overrides: Partial<AdvanceResult> = {}): AdvanceResult => ({
  ran: "wake",
  status: "ok",
  dossier: "running",
  nextAt: at(-1000),
  ...overrides,
});

async function runAfter(): Promise<void> {
  for (const cb of afterCallbacks.splice(0)) await cb();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 60, remaining: 59 });
  advance.mockReset().mockResolvedValue(result());
  chainAdvance.mockReset().mockResolvedValue(undefined);
  afterCallbacks.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/dossiers/[id]/advance", () => {
  it("is dynamic and may run a whole stage (maxDuration 300)", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(300);
    // A timed-out stage is held off until claim + lease + grace: the claiming invocation is dead by then.
    expect(route.maxDuration * 1000).toBe(LEASE_MS + TIMEOUT_GRACE_MS);
  });

  it("is rate-limited to 60 a minute per visitor", async () => {
    expect(createRateLimiter).toHaveBeenCalledWith({ max: 60, windowMs: 60_000 });
    await post();
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^advance:v_[a-z2-7]{10}$/));
  });

  it("answers 429 over the limit without advancing", async () => {
    check.mockResolvedValue({ success: false, limit: 60, remaining: 0, retryAfter: 12 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(advance).not.toHaveBeenCalled();
  });

  it("lets the runner's own chained call through the limiter with its HMAC header", async () => {
    check.mockResolvedValue({ success: false, limit: 60, remaining: 0 });
    const res = await post({ [ADVANCE_HEADER]: advanceToken(ID) });
    expect(res.status).toBe(200);
    expect(check).not.toHaveBeenCalled();
  });

  it("limits a call whose header is not this dossier's token", async () => {
    await post({ [ADVANCE_HEADER]: "forged" });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an unknown dossier and schedules nothing", async () => {
    advance.mockRejectedValue(new UnknownDossierError(ID));
    const res = await post();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("unknown_dossier");
    expect(afterCallbacks).toHaveLength(0);
  });

  it("runs one stage with the default handlers and answers the result, uncached", async () => {
    const res = await post();
    expect(advance).toHaveBeenCalledWith(ID, HANDLERS);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ran: "wake",
      status: "ok",
      dossier: "running",
      nextAt: at(-1000).toISOString(),
    });
  });

  it("schedules the next advance with after() when a stage finished and more remain", async () => {
    await post();
    expect(afterCallbacks).toHaveLength(1);
    expect(chainAdvance).not.toHaveBeenCalled();
    await runAfter();
    expect(chainAdvance).toHaveBeenCalledWith("https://bastion.test", ID, 0);
  });

  it("re-advances a waiting stage once its 3 s poll is due", async () => {
    advance.mockResolvedValue(result({ status: "waiting", nextAt: at(3000) }));
    await post();
    await runAfter();
    expect(chainAdvance).toHaveBeenCalledWith("https://bastion.test", ID, 3000);
  });

  it("schedules nothing when the dossier is finished, failed, or nothing ran", async () => {
    for (const r of [
      result({ ran: "record", dossier: "succeeded", nextAt: null }),
      result({ status: "error", dossier: "failed", nextAt: null }),
      result({ ran: null, status: null }),
      result({ status: "waiting", nextAt: at(60_000) }),
    ]) {
      advance.mockResolvedValueOnce(r);
      await post();
    }
    expect(afterCallbacks).toHaveLength(0);
  });

  it("answers 500 (logged) when the runner fails unexpectedly", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    advance.mockRejectedValue(new Error("connection refused"));
    const res = await post();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("advance_failed");
    expect(error).toHaveBeenCalled();
  });
});
