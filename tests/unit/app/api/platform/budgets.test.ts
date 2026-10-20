import { beforeEach, describe, expect, it, vi } from "vitest";

const { check, budgetsLeft } = vi.hoisted(() => ({ check: vi.fn(), budgetsLeft: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter: () => ({ check }) }));
vi.mock("@/platform/budget", async (orig) => ({
  ...(await orig<typeof import("@/platform/budget")>()),
  budgetsLeft: () => budgetsLeft(),
}));

import * as route from "@/app/api/platform/budgets/route";

/**
 * `GET /api/platform/budgets` (spec 21 §5.1, "Routes added"): what is left today of every budget,
 * for the workbenches and the platform page. Never cached; 60 a minute per visitor.
 */

const req = () =>
  new Request("https://bastion.test/api/platform/budgets", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });

const today = {
  debate: { limit: 4, left: 3 },
  upload: { limit: 3, left: 3 },
  leakscan: { limit: 10, left: 10 },
  scrape: { limit: 30, left: 29 },
  certify: { limit: 200, left: 200 },
  "feathers.write": { limit: 50, left: 0 },
};

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 60, remaining: 59 });
  budgetsLeft.mockReset().mockResolvedValue(today);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/platform/budgets", () => {
  it("is rendered per request", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("answers {key: {limit, left}} for every budget, never cached", async () => {
    const res = await route.GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(today);
  });

  it("limits each visitor to 60 a minute", async () => {
    await route.GET(req());
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^budgets:v_[a-z2-7]{10}$/));
    check.mockResolvedValue({ success: false, limit: 60, remaining: 0, retryAfter: 12 });
    const res = await route.GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(budgetsLeft).toHaveBeenCalledTimes(1);
  });

  it("answers 503 budgets_unavailable when the budget store cannot be read", async () => {
    budgetsLeft.mockRejectedValue(new Error("upstash down"));
    const res = await route.GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "budgets_unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
