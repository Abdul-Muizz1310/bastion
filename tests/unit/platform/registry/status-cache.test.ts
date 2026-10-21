import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Health } from "@/platform/registry/health";
import {
  createStatusCache,
  STATUS_KEY,
  type StatusBody,
  type StatusStore,
  upstashStatusStore,
} from "@/platform/registry/status-cache";

/**
 * Ruling AE: GET /api/platform/status serves one shared probe round for 30 s to every visitor
 * (Upstash when configured, in-process otherwise). Requests that arrive while a round is running
 * share it. A failed round is never cached; a broken shared store only costs a probe.
 */

const T0 = new Date("2026-10-20T10:00:00.000Z");

function body(at = new Date()): StatusBody {
  const services: Health[] = [
    { service: "magpie", state: "live", latencyMs: 90, checkedAt: at.toISOString() },
  ];
  return { services, timestamp: at.toISOString() };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function memoryStore(initial: unknown = null) {
  let value: unknown = initial;
  const store: StatusStore & { value: () => unknown } = {
    read: vi.fn(async () => value),
    write: vi.fn(async (b: StatusBody) => {
      value = b;
    }),
    value: () => value,
  };
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createStatusCache", () => {
  it("probes once for two requests within 30 s", async () => {
    const probeAll = vi.fn(async () => body());
    const cache = createStatusCache({ probeAll });
    const a = await cache.get();
    vi.setSystemTime(new Date(T0.getTime() + 29_999));
    const b = await cache.get();
    expect(probeAll).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("probes again once the round is 30 s old", async () => {
    const probeAll = vi.fn(async () => body());
    const cache = createStatusCache({ probeAll });
    await cache.get();
    vi.setSystemTime(new Date(T0.getTime() + 30_000));
    await cache.get();
    expect(probeAll).toHaveBeenCalledTimes(2);
  });

  it("shares one round among requests that arrive while it runs", async () => {
    const round = deferred<StatusBody>();
    const probeAll = vi.fn(() => round.promise);
    const cache = createStatusCache({ probeAll });
    const pending = [cache.get(), cache.get(), cache.get()];
    await vi.advanceTimersByTimeAsync(0);
    round.resolve(body());
    const results = await Promise.all(pending);
    expect(probeAll).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("never caches a failed round: the next request probes again", async () => {
    const probeAll = vi
      .fn<() => Promise<StatusBody>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(body());
    const cache = createStatusCache({ probeAll });
    await expect(cache.get()).rejects.toThrow("boom");
    await expect(cache.get()).resolves.toMatchObject({ services: [{ service: "magpie" }] });
    expect(probeAll).toHaveBeenCalledTimes(2);
  });

  it("serves a fresh round another instance wrote to the shared store, without probing", async () => {
    const store = memoryStore(body(new Date(T0.getTime() - 10_000)));
    const probeAll = vi.fn(async () => body());
    const cache = createStatusCache({ probeAll, store });
    expect((await cache.get()).timestamp).toBe(new Date(T0.getTime() - 10_000).toISOString());
    expect(probeAll).not.toHaveBeenCalled();
  });

  it("probes when the shared round is stale, and writes the new one for 30 s", async () => {
    const store = memoryStore(body(new Date(T0.getTime() - 31_000)));
    const probeAll = vi.fn(async () => body());
    const cache = createStatusCache({ probeAll, store });
    await cache.get();
    expect(probeAll).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledWith(body(T0), 30);
  });

  it("treats a malformed shared value as a miss", async () => {
    const store = memoryStore({ services: "all good" });
    const probeAll = vi.fn(async () => body());
    await createStatusCache({ probeAll, store }).get();
    expect(probeAll).toHaveBeenCalledTimes(1);
  });

  it("treats a round stamped in the future (beyond clock skew) as a miss", async () => {
    const store = memoryStore(body(new Date(T0.getTime() + 60_000)));
    const probeAll = vi.fn(async () => body());
    await createStatusCache({ probeAll, store }).get();
    expect(probeAll).toHaveBeenCalledTimes(1);
  });

  it("still answers when the shared store cannot be read or written, and logs it", async () => {
    const store: StatusStore = {
      read: vi.fn(async () => {
        throw new Error("upstash down");
      }),
      write: vi.fn(async () => {
        throw new Error("upstash down");
      }),
    };
    const probeAll = vi.fn(async () => body());
    const cache = createStatusCache({ probeAll, store });
    await expect(cache.get()).resolves.toMatchObject({ timestamp: T0.toISOString() });
    expect(console.error).toHaveBeenCalledTimes(2);
    // The instance still keeps the round for 30 s.
    await cache.get();
    expect(probeAll).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 999, 1500.5, Number.NaN])("refuses a ttl of %s ms", (ttlMs) => {
    expect(() => createStatusCache({ probeAll: vi.fn(), ttlMs })).toThrow(RangeError);
  });
});

describe("upstashStatusStore", () => {
  it("reads and writes one key, expiring it with the ttl", async () => {
    const redis = { get: vi.fn(async () => null), set: vi.fn(async () => "OK") };
    const store = upstashStatusStore(redis);
    await store.read();
    await store.write(body(), 30);
    expect(redis.get).toHaveBeenCalledWith(STATUS_KEY);
    expect(redis.set).toHaveBeenCalledWith(STATUS_KEY, body(), { ex: 30 });
  });
});
