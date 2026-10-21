import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/dossiers/[id]/chain-trace` (spec 21 §6.2 "The chain's trace"): a dossier's chain events,
 * oldest first, from the per-dossier list. Public like the dossier itself (ids and timings only),
 * 30 a minute per visitor; 503 when no list is kept (no Upstash).
 */

const { check, createRateLimiter, read, sinkFromEnv } = vi.hoisted(() => {
  const check = vi.fn();
  const read = vi.fn();
  return {
    check,
    createRateLimiter: vi.fn(() => ({ check })),
    read,
    sinkFromEnv: vi.fn(() => ({ push: async () => {}, read })),
  };
});
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter }));
vi.mock("@/dossier/chain-trace", async (orig) => ({
  ...(await orig<typeof import("@/dossier/chain-trace")>()),
  traceSinkFromEnv: sinkFromEnv,
}));

import { NextRequest } from "next/server";
import * as route from "@/app/api/dossiers/[id]/chain-trace/route";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const get = (id = ID) =>
  route.GET(
    new NextRequest(`https://bastion.test/api/dossiers/${id}/chain-trace`, {
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 30, remaining: 29 });
  read.mockReset().mockResolvedValue([]);
  sinkFromEnv.mockClear();
});

describe("GET /api/dossiers/[id]/chain-trace", () => {
  it("is dynamic and limited to 30 a minute per visitor", async () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(createRateLimiter).toHaveBeenCalledWith({ max: 30, windowMs: 60_000 });
    await get();
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^chain-trace:v_[a-z2-7]{10}$/));
  });

  it("answers the events oldest first, uncached, dropping a line that is not a trace object", async () => {
    read.mockResolvedValue([
      JSON.stringify({ tag: "dossier-chain", event: "advance.entry", dossierId: ID }),
      "not json",
      JSON.stringify({ tag: "dossier-chain", event: "chain.decision", dossierId: ID }),
      JSON.stringify([1, 2]),
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      dossierId: ID,
      events: [
        { tag: "dossier-chain", event: "advance.entry", dossierId: ID },
        { tag: "dossier-chain", event: "chain.decision", dossierId: ID },
      ],
    });
    expect(read).toHaveBeenCalledWith(ID);
  });

  it("answers 404 for a malformed id without reading", async () => {
    const res = await get("not-a-uuid");
    expect(res.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers 503 when no trace list is kept", async () => {
    sinkFromEnv.mockReturnValueOnce(null as never);
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("trace_unavailable");
  });

  it("answers 503 when the list cannot be read", async () => {
    read.mockRejectedValue(new Error("upstash down"));
    const res = await get();
    expect(res.status).toBe(503);
  });

  it("answers 429 over the limit, reading nothing", async () => {
    check.mockResolvedValue({ success: false, limit: 30, remaining: 0, retryAfter: 9 });
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(read).not.toHaveBeenCalled();
  });
});
