import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/dossiers/[id]/verify` (spec 21 §6.5, "verify everything"): public, rate-limited to 5 a
 * minute per visitor, no budget (every capability it calls is free). Ruling W: it re-checks every
 * receipt live as the system actor (outside the per-visitor gateway limit) under a fresh request id
 * of its own, answers the checks, stores none of them and appends one `dossier.verified` audit
 * event — as the visitor — with each check's state.
 */

const m = vi.hoisted(() => {
  const check = vi.fn();
  return {
    check,
    createRateLimiter: vi.fn(() => ({ check })),
    findDossier: vi.fn(),
    verifyDossier: vi.fn(),
    appendEvent: vi.fn(),
  };
});

vi.mock("@/platform/ratelimit", () => ({ createRateLimiter: m.createRateLimiter }));
vi.mock("@/dossier/store", () => ({ findDossier: m.findDossier }));
vi.mock("@/dossier/verify-live", () => ({ verifyDossier: m.verifyDossier }));
vi.mock("@/platform/audit/write", () => ({ appendEvent: m.appendEvent }));

import { NextRequest } from "next/server";
import * as route from "@/app/api/dossiers/[id]/verify/route";
import type { Check } from "@/dossier/verify";
import { isVisitorId } from "@/platform/visitor";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const CHECKS: Check[] = [
  { name: "certificates", state: "pass", detail: "2 of 2", items: [] },
  { name: "transcript", state: "unavailable", detail: "paper-trail is asleep" },
  { name: "documents", state: "expired", detail: "DR-0029" },
];

function post(id = ID): Promise<Response> {
  const req = new NextRequest(`https://bastion.test/api/dossiers/${id}/verify`, {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  return route.POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  m.check.mockReset().mockResolvedValue({ success: true, limit: 10, remaining: 9 });
  m.findDossier
    .mockReset()
    .mockResolvedValue({ id: ID, requestId: "req-dossier-1", visitor: "v_aaaaaaaaaa" });
  m.verifyDossier.mockReset().mockResolvedValue(CHECKS);
  m.appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/dossiers/[id]/verify", () => {
  it("is dynamic, allowed 120 s, and rate-limited to 5 a minute per visitor", async () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(120);
    expect(m.createRateLimiter).toHaveBeenCalledWith({ max: 5, windowMs: 60_000 });
    await post();
    expect(m.check).toHaveBeenCalledWith(expect.stringMatching(/^verify:v_[a-z2-7]{10}$/));
  });

  it("answers the checks, never cached, with its own request id", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await res.json()).toEqual({ dossierId: ID, checks: CHECKS });
  });

  it("verifies as the system actor (Ruling W), under a fresh request id (not the dossier's)", async () => {
    const res = await post();
    const [dossier, ctx] = m.verifyDossier.mock.calls[0] ?? [];
    expect(dossier).toEqual({ id: ID, requestId: "req-dossier-1" });
    expect(ctx.actor).toBe("bastion");
    expect(isVisitorId(ctx.actor)).toBe(false);
    expect(ctx.requestId).toBe(res.headers.get("x-request-id"));
    expect(ctx.requestId).not.toBe("req-dossier-1");
    expect(ctx.clientIp).toBe("203.0.113.9");
  });

  it("stores no result but appends one dossier.verified event with each check's state", async () => {
    const res = await post();
    expect(m.appendEvent).toHaveBeenCalledExactlyOnceWith({
      actor: expect.stringMatching(/^v_/),
      action: "dossier.verified",
      entityType: "dossier",
      entityId: ID,
      service: "bastion",
      requestId: res.headers.get("x-request-id"),
      metadata: {
        checks: { certificates: "pass", transcript: "unavailable", documents: "expired" },
      },
    });
  });

  it("answers 429 over the limit without reading the dossier or calling anyone", async () => {
    m.check.mockResolvedValue({ success: false, limit: 5, remaining: 0, retryAfter: 42 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(await res.json()).toMatchObject({ error: "rate_limited", retryAfterS: 42 });
    expect(m.findDossier).not.toHaveBeenCalled();
    expect(m.verifyDossier).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown dossier, and audits nothing", async () => {
    m.findDossier.mockResolvedValue(null);
    const res = await post("not-a-dossier");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "unknown_dossier" });
    expect(m.verifyDossier).not.toHaveBeenCalled();
    expect(m.appendEvent).not.toHaveBeenCalled();
  });

  it("answers 500 in the gateway's error shape when bastion itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.verifyDossier.mockRejectedValue(new Error("db down"));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "verify_failed",
      requestId: expect.any(String),
    });
    expect(m.appendEvent).not.toHaveBeenCalled();
  });
});
