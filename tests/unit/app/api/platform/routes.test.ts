import { beforeEach, describe, expect, it, vi } from "vitest";

const { check, probe } = vi.hoisted(() => ({ check: vi.fn(), probe: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ createRateLimiter: () => ({ check }) }));
vi.mock("@/platform/registry/health", async (orig) => ({
  ...(await orig<typeof import("@/platform/registry/health")>()),
  probe: (...a: unknown[]) => probe(...a),
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
});

describe("GET /api/platform/status", () => {
  it("is dynamic and probes with the 8 s budget", async () => {
    expect(status.dynamic).toBe("force-dynamic");
    const res = await status.GET();
    const body = await res.json();
    expect(body.services).toHaveLength(6);
    expect(probe).toHaveBeenCalledTimes(6);
    for (const call of probe.mock.calls) expect(call[1]).toBe(8000);
    expect(res.headers.get("cache-control")).toBe("no-store");
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
    expect(probe).not.toHaveBeenCalled();
  });

  it("404s prototype keys", async () => {
    expect((await call("constructor")).status).toBe(404);
  });

  it("wakes with a 90 s timeout, keyed by visitor", async () => {
    const res = await call("magpie");
    expect(res.status).toBe(200);
    expect(probe).toHaveBeenCalledWith("magpie", 90_000);
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^wake:v_[a-z2-7]{10}$/));
  });

  it("429s when over the per-visitor limit", async () => {
    check.mockResolvedValue({ success: false, limit: 5, remaining: 0, retryAfter: 17 });
    const res = await call("magpie");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(probe).not.toHaveBeenCalled();
  });
});
