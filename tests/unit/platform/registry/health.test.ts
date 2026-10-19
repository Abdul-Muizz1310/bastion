import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyProbe, probe, VERSION_BUDGET_MS, wake } from "@/platform/registry/health";

describe("classifyProbe", () => {
  it.each([200, 204, 299])("maps %i to live", (status) => {
    expect(classifyProbe({ kind: "response", status, body: null, ms: 5 })).toBe("live");
  });
  it.each([500, 502, 503, 599])("maps %i to down", (status) => {
    expect(classifyProbe({ kind: "response", status, body: null, ms: 5 })).toBe("down");
  });
  it.each([301, 401, 404])("maps non-2xx %i to down", (status) => {
    expect(classifyProbe({ kind: "response", status, body: null, ms: 5 })).toBe("down");
  });
  it("maps a timeout to asleep", () => {
    expect(classifyProbe({ kind: "timeout", ms: 8000 })).toBe("asleep");
  });
  it("maps a network error to down", () => {
    expect(classifyProbe({ kind: "network_error", ms: 3 })).toBe("down");
  });
});

describe("probe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports live with version and commit from /version", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith("/version")
        ? Response.json({ version: "1.2.3", commit_sha: "abc123" })
        : Response.json({ status: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const h = await probe("magpie", 1000);
    expect(h).toMatchObject({
      service: "magpie",
      state: "live",
      version: "1.2.3",
      commitSha: "abc123",
    });
    expect(Number.isNaN(Date.parse(h.checkedAt))).toBe(false);
  });

  it("stays live when /version is malformed", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith("/version") ? new Response("nope") : Response.json({}),
    );
    const h = await probe("magpie", 1000);
    expect(h.state).toBe("live");
    expect(h.version).toBeUndefined();
  });

  it("reports down on a 503", async () => {
    vi.stubGlobal("fetch", async () => new Response("x", { status: 503 }));
    expect((await probe("inkprint", 1000)).state).toBe("down");
  });

  it("reports asleep when the probe times out", async () => {
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      return new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () =>
          rej(new DOMException("timed out", "TimeoutError")),
        );
      });
    });
    expect((await probe("inkprint", 20)).state).toBe("asleep");
  });

  it("reports down on a network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect((await probe("inkprint", 1000)).state).toBe("down");
  });
});

const hang = (_u: string, init: RequestInit) =>
  new Promise<Response>((_res, rej) => {
    init.signal?.addEventListener("abort", () => rej(init.signal?.reason));
  });
const isHealth = (url: string) => String(url).endsWith("/health");

describe("probe — the /version budget (Ruling E)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gives /version at most 3 s, not the whole probe budget", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", async () => Response.json({ version: "1" }));
    await probe("magpie", 90_000);
    expect(VERSION_BUDGET_MS).toBe(3_000);
    expect(timeout.mock.calls[0]?.[0]).toBe(90_000);
    expect(timeout.mock.calls[1]?.[0]).toBeLessThanOrEqual(3_000);
    expect(timeout.mock.calls[1]?.[0]).toBeGreaterThan(0);
  });

  it("gives /version only what is left of a shorter budget", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", async () => Response.json({}));
    await probe("magpie", 1_000);
    expect(timeout.mock.calls[1]?.[0]).toBeLessThanOrEqual(1_000);
  });

  it("skips /version when /health used the whole budget", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(1_000);
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const h = await probe("magpie", 1_000);
    expect(h.state).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a fractional budget (AbortSignal.timeout only takes whole ms)", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith("/version") ? Response.json({ version: "9" }) : Response.json({}),
    );
    const h = await probe("magpie", 1_000.5);
    expect(h).toMatchObject({ state: "live", version: "9" });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("refuses a timeout of %s", async (ms) => {
    await expect(probe("magpie", ms)).rejects.toThrow(RangeError);
  });
});

describe("wake — re-probes a cold start until the deadline (Ruling E)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const opts = { attemptMs: 20, pauseMs: 5 };

  type Answer = (url: string, init: RequestInit) => Promise<Response>;
  function scripted(healthAnswers: Answer[]) {
    const healthCalls: number[] = [];
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      if (!isHealth(url)) return Promise.resolve(Response.json({ version: "2.0.0" }));
      healthCalls.push(1);
      const next = healthAnswers.shift() ?? hang;
      return next(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return { healthCalls, fetchMock };
  }
  const status = (code: number) => async () => new Response("x", { status: code });
  const ok = async () => Response.json({ status: "ok" });

  it.each([502, 503])("keeps probing through %i answers until live", async (code) => {
    const { healthCalls } = scripted([status(code), status(code), ok]);
    const h = await wake("magpie", 1_000, opts);
    expect(h).toMatchObject({ service: "magpie", state: "live", version: "2.0.0" });
    expect(healthCalls).toHaveLength(3);
  });

  it("keeps probing after an attempt times out", async () => {
    const { healthCalls } = scripted([hang, ok]);
    const h = await wake("magpie", 1_000, opts);
    expect(h.state).toBe("live");
    expect(healthCalls).toHaveLength(2);
  });

  it("reports asleep when every attempt times out until the deadline", async () => {
    const { healthCalls } = scripted([]);
    const started = performance.now();
    const h = await wake("magpie", 120, { attemptMs: 30, pauseMs: 5 });
    expect(h.state).toBe("asleep");
    expect(healthCalls.length).toBeGreaterThanOrEqual(2);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("reports down when the cold-start 503 outlasts the deadline", async () => {
    const answers = Array.from({ length: 100 }, () => status(503));
    const { healthCalls } = scripted(answers);
    const h = await wake("magpie", 60, opts);
    expect(h.state).toBe("down");
    expect(healthCalls.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ["a 500", status(500)],
    ["a 404", status(404)],
    [
      "a network error",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("does not retry %s — that is down, not asleep", async (_label, answer) => {
    const { healthCalls } = scripted([answer]);
    const h = await wake("magpie", 1_000, opts);
    expect(h.state).toBe("down");
    expect(healthCalls).toHaveLength(1);
  });

  it("gives /version at most 3 s of what is left of the deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    scripted([ok]);
    await wake("magpie", 90_000);
    const budgets = timeout.mock.calls.map((c) => c[0]);
    expect(budgets).toHaveLength(2);
    expect(budgets[0]).toBeLessThanOrEqual(90_000);
    expect(budgets[1]).toBeLessThanOrEqual(3_000);
  });

  it("caps each attempt so a stuck connection is retried", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    scripted([ok]);
    await wake("magpie", 90_000);
    expect(timeout.mock.calls[0]?.[0]).toBe(30_000);
  });

  it.each([0, -1, Number.NaN])("refuses a deadline of %s", async (ms) => {
    await expect(wake("magpie", ms)).rejects.toThrow(RangeError);
  });
});
