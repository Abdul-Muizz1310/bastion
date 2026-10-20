import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADVANCE_HEADER,
  advanceToken,
  CHAIN_WAIT_MAX_MS,
  chainAdvance,
  chainDelayMs,
  isAdvanceToken,
} from "@/dossier/chain";
import type { AdvanceResult } from "@/dossier/runner";

/**
 * Spec 21 §6.2 — chaining. After a stage finishes, the advance route hands the dossier to a fresh
 * invocation with `after()`: a POST to its own advance route carrying an internal HMAC header (so the
 * per-visitor rate limit does not throttle the runner itself). A stage that waits is re-advanced
 * once its not_before arrives, if that is within 10 s; anything later is left to the page's nudge.
 */

const ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER = "550e8400-e29b-41d4-a716-446655440001";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

const result = (overrides: Partial<AdvanceResult> = {}): AdvanceResult => ({
  ran: "wake",
  status: "ok",
  dossier: "running",
  nextAt: at(-10),
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("chainDelayMs", () => {
  it("chains at once when the next stage is already due", () => {
    expect(chainDelayMs(result(), NOW)).toBe(0);
  });

  it("waits until a waiting stage's not_before when that is within 10 s", () => {
    expect(chainDelayMs(result({ status: "waiting", nextAt: at(3000) }), NOW)).toBe(3000);
    expect(chainDelayMs(result({ status: "pending", nextAt: at(CHAIN_WAIT_MAX_MS) }), NOW)).toBe(
      CHAIN_WAIT_MAX_MS,
    );
  });

  it("leaves anything further out to the page", () => {
    expect(chainDelayMs(result({ nextAt: at(CHAIN_WAIT_MAX_MS + 1) }), NOW)).toBeNull();
  });

  it("does not chain when this invocation recorded nothing", () => {
    expect(chainDelayMs(result({ ran: null, status: null }), NOW)).toBeNull();
    // a lost lease: the result was discarded, whoever holds the stage now chains it.
    expect(chainDelayMs(result({ ran: "wake", status: null }), NOW)).toBeNull();
  });

  it("does not chain a finished or failed dossier", () => {
    expect(chainDelayMs(result({ dossier: "succeeded", nextAt: null }), NOW)).toBeNull();
    expect(chainDelayMs(result({ status: "error", dossier: "failed", nextAt: null }), NOW)).toBe(
      null,
    );
  });

  it("does not chain when nothing will become claimable", () => {
    expect(chainDelayMs(result({ nextAt: null }), NOW)).toBeNull();
  });
});

describe("advance tokens", () => {
  it("is a base64url HMAC bound to the dossier", () => {
    const token = advanceToken(ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(advanceToken(ID)).toBe(token);
    expect(advanceToken(OTHER)).not.toBe(token);
  });

  it("accepts only this dossier's token", () => {
    expect(isAdvanceToken(ID, advanceToken(ID))).toBe(true);
    expect(isAdvanceToken(ID, advanceToken(OTHER))).toBe(false);
    expect(isAdvanceToken(ID, null)).toBe(false);
    expect(isAdvanceToken(ID, "")).toBe(false);
    expect(isAdvanceToken(ID, `${advanceToken(ID)}x`)).toBe(false);
  });

  it("changes with the deployment secret", () => {
    const token = advanceToken(ID);
    vi.stubEnv("IRON_SESSION_PASSWORD", "y".repeat(32));
    expect(isAdvanceToken(ID, token)).toBe(false);
  });
});

describe("chainAdvance", () => {
  it("sleeps, then POSTs this dossier's advance route with the internal header", async () => {
    const order: string[] = [];
    const sleep = vi.fn(async (ms: number) => {
      order.push(`sleep ${ms}`);
    });
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => {
      order.push("fetch");
      return new Response("{}", { status: 200 });
    });
    await chainAdvance("https://bastion.test", ID, 3000, { fetch, sleep });
    expect(order).toEqual(["sleep 3000", "fetch"]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://bastion.test/api/dossiers/${ID}/advance`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get(ADVANCE_HEADER)).toBe(advanceToken(ID));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the platform fetch and a real timer by default", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    try {
      await chainAdvance("https://bastion.test", ID, 1);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not sleep when the next stage is due", async () => {
    const sleep = vi.fn(async () => {});
    const fetch = vi.fn(async () => new Response("{}"));
    await chainAdvance("https://bastion.test", ID, 0, { fetch, sleep });
    expect(sleep).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("swallows and logs a failed handoff — the page's nudge and lease expiry still recover", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      chainAdvance("https://bastion.test", ID, 0, { fetch, sleep: async () => {} }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dossier chain"), expect.anything());
  });

  it("logs a refused handoff (non-2xx)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response("{}", { status: 429 }));
    await chainAdvance("https://bastion.test", ID, 0, { fetch, sleep: async () => {} });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("dossier chain"),
      expect.objectContaining({ status: 429 }),
    );
  });

  it("lets go after the handoff window without logging a failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await chainAdvance("https://bastion.test", ID, 0, { fetch, sleep: async () => {} });
    expect(warn).not.toHaveBeenCalled();
  });
});
