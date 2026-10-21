import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { check, probe, wake: wakeProbe } = vi.hoisted(() => ({
  check: vi.fn(),
  probe: vi.fn(),
  wake: vi.fn(),
}));
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter: () => ({ check }) }));
vi.mock("@/platform/registry/health", async (orig) => ({
  ...(await orig<typeof import("@/platform/registry/health")>()),
  probe: (...a: unknown[]) => probe(...a),
  wake: (...a: unknown[]) => wakeProbe(...a),
}));

import * as status from "@/app/api/platform/status/route";
import * as wake from "@/app/api/platform/wake/[service]/route";

const SECRET = "x".repeat(32);
const req = (path: string) =>
  new Request(`https://bastion.test${path}`, { headers: { "x-forwarded-for": "203.0.113.9" } });
const health = (service: string) => ({
  service,
  state: "live",
  latencyMs: 1,
  checkedAt: new Date().toISOString(),
});

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
  probe.mockReset();
  check.mockReset();
  check.mockResolvedValue({ success: true, limit: 5, remaining: 4 });
  probe.mockImplementation(async (s: string) => health(s));
  wakeProbe.mockReset();
  wakeProbe.mockImplementation(async (s: string) => health(s));
});

describe("GET /api/platform/status (Ruling AE)", () => {
  // The route keeps one shared round for 30 s; each test starts a minute after the last.
  let clock = Date.parse("2026-10-20T10:00:00.000Z");
  beforeEach(() => {
    clock += 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is dynamic and probes every service with the 8 s budget", async () => {
    expect(status.dynamic).toBe("force-dynamic");
    const res = await status.GET();
    const body = await res.json();
    expect(body.services).toHaveLength(6);
    expect(probe).toHaveBeenCalledTimes(6);
    for (const call of probe.mock.calls) expect(call[1]).toBe(8000);
  });

  it("lets the CDN share the answer for 30 s", async () => {
    const res = await status.GET();
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=30");
  });

  it("serves one probe round to every request within 30 s, and a new one after", async () => {
    await status.GET();
    vi.setSystemTime(clock + 29_000);
    await Promise.all([status.GET(), status.GET()]);
    expect(probe).toHaveBeenCalledTimes(6);
    vi.setSystemTime(clock + 30_000);
    await status.GET();
    expect(probe).toHaveBeenCalledTimes(12);
  });
});

describe("POST /api/platform/wake/[service]", () => {
  const call = (service: string) =>
    wake.POST(req(`/api/platform/wake/${service}`), { params: Promise.resolve({ service }) });

  it("allows a long run", () => {
    expect(wake.maxDuration).toBeGreaterThanOrEqual(100);
    expect(wake.dynamic).toBe("force-dynamic");
  });

  it("404s an unknown service without probing", async () => {
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(wakeProbe).not.toHaveBeenCalled();
  });

  it("404s prototype keys", async () => {
    expect((await call("constructor")).status).toBe(404);
  });

  it("wakes with a 90 s deadline (re-probing a cold start), keyed by visitor", async () => {
    const res = await call("magpie");
    expect(res.status).toBe(200);
    expect(wakeProbe).toHaveBeenCalledWith("magpie", 90_000);
    expect(probe).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^wake:v_[a-z2-7]{10}$/));
  });

  it("429s when over the per-visitor limit", async () => {
    check.mockResolvedValue({ success: false, limit: 5, remaining: 0, retryAfter: 17 });
    const res = await call("magpie");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(wakeProbe).not.toHaveBeenCalled();
  });
});
