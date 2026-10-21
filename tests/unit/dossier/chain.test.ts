import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADVANCE_HEADER,
  advanceToken,
  CHAIN_WAIT_MAX_MS,
  chainAdvance,
  chainDelayMs,
  deferChain,
  HANDOFF_MARGIN_MS,
  handoffDeadline,
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

/**
 * The hand-off (spec 21 §6.2, fix after the first live smoke): on Vercel an invocation whose caller
 * disconnects before it answers loses its after() work, so the caller holds the connection until the
 * next advance has answered — bounded only by its own invocation's deadline, never a short timer.
 */
describe("handoffDeadline", () => {
  it("is the caller's start plus its maxDuration, less a 15 s margin", () => {
    expect(HANDOFF_MARGIN_MS).toBe(15_000);
    expect(handoffDeadline(1_000_000, 300)).toBe(1_000_000 + 285_000);
  });

  it.each([0, 15, -1, Number.NaN, 1.5])("refuses a maxDuration of %s s", (s) => {
    expect(() => handoffDeadline(1_000_000, s)).toThrow(RangeError);
  });
});

describe("chainAdvance", () => {
  const ORIGIN = "https://bastion.test";
  const START = 1_000_000;

  /** A fake clock: sleep moves it, now reads it, timeout records the window each fetch asks for. */
  function harness(respond: () => Promise<Response> = async () => new Response("{}")) {
    let clock = START;
    const windows: number[] = [];
    const order: string[] = [];
    const deps = {
      now: () => clock,
      sleep: vi.fn(async (ms: number) => {
        order.push(`sleep ${ms}`);
        clock += ms;
      }),
      timeout: vi.fn((ms: number) => {
        windows.push(ms);
        return new AbortController().signal;
      }),
      fetch: vi.fn(async (_url: URL, _init: RequestInit) => {
        order.push("fetch");
        return respond();
      }),
    };
    return { deps, windows, order };
  }

  it("sleeps, then POSTs this dossier's advance route with the internal header", async () => {
    const { deps, order } = harness();
    await chainAdvance(ORIGIN, ID, 3000, START + 285_000, deps);
    expect(order).toEqual(["sleep 3000", "fetch"]);
    const [url, init] = deps.fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://bastion.test/api/dossiers/${ID}/advance`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get(ADVANCE_HEADER)).toBe(advanceToken(ID));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("holds the connection until the next advance answers, up to the caller's deadline — no 10 s timer", async () => {
    const { deps, windows } = harness();
    await chainAdvance(ORIGIN, ID, 0, START + 285_000, deps);
    expect(windows).toEqual([285_000]);
  });

  it("measures the window from after its sleep", async () => {
    const { deps, windows } = harness();
    await chainAdvance(ORIGIN, ID, 3000, START + 285_000, deps);
    expect(windows).toEqual([282_000]);
  });

  it("still asks for 1 s when the caller's deadline has passed", async () => {
    const { deps, windows } = harness();
    await chainAdvance(ORIGIN, ID, 0, START - 5_000, deps);
    expect(windows).toEqual([1_000]);
  });

  it("is done once the next advance has answered — it never waits for that invocation's own hand-off", async () => {
    const answer = new Response(JSON.stringify({ ran: "seal" }), { status: 200 });
    const { deps } = harness(async () => answer);
    await expect(chainAdvance(ORIGIN, ID, 0, START + 285_000, deps)).resolves.toBeUndefined();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    // The answer is read to its end, so the connection is released, not left half-open.
    expect(answer.bodyUsed).toBe(true);
  });

  it("does not sleep when the next stage is due", async () => {
    const { deps } = harness();
    await chainAdvance(ORIGIN, ID, 0, START + 285_000, deps);
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it("logs a hand-off that let go before the next advance answered — its own hand-off may be lost", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps } = harness(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(chainAdvance(ORIGIN, ID, 0, START + 285_000, deps)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("the hand-off let go before the next advance answered"),
      expect.objectContaining({ dossierId: ID, windowMs: 285_000 }),
    );
  });

  it("swallows and logs a failed hand-off — the page's nudge and lease expiry still recover", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps } = harness(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(chainAdvance(ORIGIN, ID, 0, START + 285_000, deps)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dossier chain"), expect.anything());
  });

  it("logs a refused hand-off (non-2xx)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps } = harness(async () => new Response("{}", { status: 429 }));
    await chainAdvance(ORIGIN, ID, 0, START + 285_000, deps);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("dossier chain"),
      expect.objectContaining({ status: 429 }),
    );
  });

  it("uses the platform fetch, a real timer and the real clock by default", async () => {
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    try {
      await chainAdvance(ORIGIN, ID, 1, Date.now() + 60_000);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

/**
 * Task 15 (spec 21 §6.2): the chain is registered before the stage runs. Next runs a function given
 * to after() only when the response closes, and when the previous invocation let go at 10 s that
 * close has already happened; a promise given to after() is kept alive with waitUntil instead.
 */
describe("deferChain", () => {
  const ORIGIN = "https://bastion.test";

  function setup() {
    const scheduled: unknown[] = [];
    const chain = vi.fn(async (_origin: string, _id: string, _delayMs: number) => {});
    const decide = deferChain(ORIGIN, ID, (task) => scheduled.push(task), chain);
    return { scheduled, chain, decide };
  }

  it("hands the scheduler one promise at once, before anything is decided", () => {
    const { scheduled, chain } = setup();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toBeInstanceOf(Promise);
    expect(chain).not.toHaveBeenCalled();
  });

  it("chains with the decided delay once decided", async () => {
    const { scheduled, chain, decide } = setup();
    decide(3_000);
    await scheduled[0];
    expect(chain).toHaveBeenCalledExactlyOnceWith(ORIGIN, ID, 3_000);
  });

  it("settles without chaining when there is nothing to chain", async () => {
    const { scheduled, chain, decide } = setup();
    decide(null);
    await expect(scheduled[0]).resolves.toBeUndefined();
    expect(chain).not.toHaveBeenCalled();
  });

  it("counts only the first decision", async () => {
    const { scheduled, chain, decide } = setup();
    decide(0);
    decide(null);
    decide(5_000);
    await scheduled[0];
    expect(chain).toHaveBeenCalledExactlyOnceWith(ORIGIN, ID, 0);
  });
});

/** Spec 21 §6.2 "The chain's trace": the hand-off says what it did, in order, with ids only. */
describe("chainAdvance — its trace", () => {
  const ORIGIN = "https://bastion.test";
  const START = 1_000_000;

  function traced(respond: () => Promise<Response>) {
    let clock = START;
    const events: Array<Record<string, unknown>> = [];
    const deps = {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      timeout: () => new AbortController().signal,
      fetch: vi.fn(async (_url: URL, _init: RequestInit) => respond()),
      trace: {
        invocation: "a1b2c3d4",
        emit: async (e: Record<string, unknown>) => {
          events.push(e);
        },
      },
    };
    return { deps, events };
  }

  it("says it ran, how its sleep went, what it fetched and how the successor answered", async () => {
    const { deps, events } = traced(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "x-bastion-invocation": "e5f6a7b8", "x-vercel-id": "fra1::iad1::x1-17" },
        }),
    );
    await chainAdvance(ORIGIN, ID, 3000, START + 285_000, deps);
    const base = { dossierId: ID, invocation: "a1b2c3d4" };
    expect(events).toEqual([
      { ...base, event: "chain.after", delayMs: 3000 },
      { ...base, event: "chain.sleep", plannedMs: 3000, actualMs: 3000 },
      { ...base, event: "chain.fetch", host: "bastion.test", windowMs: 282_000 },
      {
        ...base,
        event: "chain.response",
        status: 200,
        elapsedMs: 0,
        successor: "e5f6a7b8",
        vercelId: "fra1::iad1::x1-17",
        mitigated: null,
      },
      { ...base, event: "chain.settled", totalMs: 3000 },
    ]);
    // The successor learns who called it, so the two ends of a hop can be joined.
    expect(new Headers(deps.fetch.mock.calls[0]?.[1]?.headers).get("x-bastion-chain-from")).toBe(
      "a1b2c3d4",
    );
  });

  it("traces a hand-off that let go, and one that failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const letGo = traced(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await chainAdvance(ORIGIN, ID, 0, START + 285_000, letGo.deps);
    expect(letGo.events.map((e) => e.event)).toEqual([
      "chain.after",
      "chain.fetch",
      "chain.letgo",
      "chain.settled",
    ]);
    const failed = traced(async () => {
      throw new TypeError("fetch failed");
    });
    await chainAdvance(ORIGIN, ID, 0, START + 285_000, failed.deps);
    expect(failed.events).toContainEqual(
      expect.objectContaining({ event: "chain.error", error: "TypeError: fetch failed" }),
    );
  });
});

