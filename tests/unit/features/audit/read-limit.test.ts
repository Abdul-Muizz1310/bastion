import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * Ruling AL: the public audit reads — `/audit`, `/audit/[requestId]`, and the time-travel replay
 * (its page and its Server Action) — are limited to 60 a minute per visitor, keyed on the visitor's
 * daily pseudonym, so the open log cannot be used to hammer the database.
 */

const created = vi.hoisted(() => ({ configs: [] as unknown[] }));
vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: (config: unknown) => {
    created.configs.push(config);
    return { check: vi.fn() };
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { allowRead, READS_PER_MINUTE } from "@/features/audit/read-limit";

const SECRET = "x".repeat(32);
const ADDRESS = { "x-forwarded-for": "203.0.113.7" };

function deps(result: { success: boolean; retryAfter?: number }) {
  return {
    headers: vi.fn(async () => new Headers(ADDRESS)),
    check: vi.fn(async (_key: string) => ({
      limit: 60,
      remaining: result.success ? 59 : 0,
      ...result,
    })),
  };
}

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("allowRead", () => {
  it("is 60 a minute per visitor, on one limiter built once", () => {
    expect(READS_PER_MINUTE).toBe(60);
    expect(created.configs).toEqual([{ max: 60, windowMs: 60_000 }]);
  });

  it("keys the audit bucket on the visitor's pseudonym and lets a read through", async () => {
    const d = deps({ success: true });
    await expect(allowRead("audit", d)).resolves.toEqual({ ok: true });
    const visitor = visitorFromRequest(new Request("https://bastion.test/", { headers: ADDRESS }));
    expect(d.check).toHaveBeenCalledWith(`audit-read:${visitor}`);
  });

  it("keeps the replay in a bucket of its own", async () => {
    const d = deps({ success: true });
    await allowRead("replay", d);
    expect(d.check.mock.calls[0]?.[0]).toMatch(/^replay-read:v_[a-z2-7]{10}$/);
  });

  it("refuses with the wait and the limit when the bucket is spent", async () => {
    await expect(allowRead("audit", deps({ success: false, retryAfter: 12 }))).resolves.toEqual({
      ok: false,
      retryAfterS: 12,
      limit: 60,
    });
  });

  it("without a stated wait, says the whole window", async () => {
    await expect(allowRead("audit", deps({ success: false }))).resolves.toEqual({
      ok: false,
      retryAfterS: 60,
      limit: 60,
    });
  });
});
