import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTracer,
  instanceFacts,
  redisTraceSink,
  TRACE_KEEP,
  TRACE_TTL_S,
  traceId,
  traceLine,
  traceSinkFromEnv,
} from "@/dossier/chain-trace";

/**
 * Spec 21 §6.2 "The trace": one structured line per chain event — ids, stages, statuses and
 * milliseconds only — to the log and, with Upstash, to a per-dossier list, because a platform may
 * not keep what a function logs after its answer. Writing a line never fails or holds a stage.
 */

const ID = "550e8400-e29b-41d4-a716-446655440000";
const AT = Date.parse("2026-10-21T07:16:46.000Z");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("traceLine", () => {
  it("is one JSON object tagged dossier-chain, with the time and every field", () => {
    const line = traceLine(
      { event: "drive.stage", dossierId: ID, invocation: "a1b2c3d4", driver: "sweep", ms: 15_812 },
      AT,
    );
    expect(JSON.parse(line)).toEqual({
      tag: "dossier-chain",
      at: "2026-10-21T07:16:46.000Z",
      event: "drive.stage",
      dossierId: ID,
      invocation: "a1b2c3d4",
      driver: "sweep",
      ms: 15_812,
    });
    expect(line).not.toContain("\n");
  });

  it("keeps null fields and drops none", () => {
    const line = traceLine(
      { event: "advance.claim", dossierId: ID, invocation: "x", stage: null },
      AT,
    );
    expect(JSON.parse(line).stage).toBeNull();
  });
});

describe("traceId", () => {
  it.each([
    ["a1b2c3d4", "a1b2c3d4"],
    ["fra1::iad1::abcd-1729495006123-0f9e", "fra1::iad1::abcd-1729495006123-0f9e"],
  ])("keeps an id made of id characters: %s", (raw, kept) => {
    expect(traceId(raw)).toBe(kept);
  });

  it.each([null, "", "has space", "x".repeat(97), "evil\nline", '"quoted"'])(
    "drops anything else (%j)",
    (raw) => {
      expect(traceId(raw)).toBeNull();
    },
  );
});

describe("createTracer", () => {
  const event = {
    event: "advance.entry" as const,
    dossierId: ID,
    invocation: "a1b2c3d4",
    served: 3,
  };

  it("logs the line and pushes it to the dossier's list", async () => {
    const log = vi.fn();
    const push = vi.fn(async () => {});
    await createTracer({ sink: { push, read: async () => [] }, log, now: () => AT })(event);
    const line = traceLine(event, AT);
    expect(log).toHaveBeenCalledExactlyOnceWith(line);
    expect(push).toHaveBeenCalledExactlyOnceWith(ID, line);
  });

  it("only logs without a sink", async () => {
    const log = vi.fn();
    await createTracer({ sink: null, log, now: () => AT })(event);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("never throws when the sink fails", async () => {
    const log = vi.fn();
    const push = vi.fn(async () => {
      throw new Error("upstash down");
    });
    await expect(
      createTracer({ sink: { push, read: async () => [] }, log, now: () => AT })(event),
    ).resolves.toBeUndefined();
  });

  it("holds a stage at most capMs when the sink hangs", async () => {
    vi.useFakeTimers();
    const push = vi.fn(() => new Promise<void>(() => {}));
    const done = vi.fn();
    void createTracer({
      sink: { push, read: async () => [] },
      log: () => {},
      now: () => AT,
      capMs: 500,
    })(event).then(done);
    await vi.advanceTimersByTimeAsync(499);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("redisTraceSink", () => {
  it("pushes newest first, keeps the newest 500 for 2 days, and reads them oldest first", async () => {
    const calls: unknown[][] = [];
    const pipeline = {
      lpush: (...a: unknown[]) => (calls.push(["lpush", ...a]), pipeline),
      ltrim: (...a: unknown[]) => (calls.push(["ltrim", ...a]), pipeline),
      expire: (...a: unknown[]) => (calls.push(["expire", ...a]), pipeline),
      exec: async () => [],
    };
    const redis = {
      pipeline: () => pipeline,
      lrange: vi.fn(async () => ["third", "second", "first"]),
    };
    const sink = redisTraceSink(redis);
    await sink.push(ID, "line");
    expect(TRACE_KEEP).toBe(500);
    expect(TRACE_TTL_S).toBe(2 * 24 * 60 * 60);
    expect(calls).toEqual([
      ["lpush", `diag:chain:${ID}`, "line"],
      ["ltrim", `diag:chain:${ID}`, 0, 499],
      ["expire", `diag:chain:${ID}`, TRACE_TTL_S],
    ]);
    expect(await sink.read(ID)).toEqual(["first", "second", "third"]);
    expect(redis.lrange).toHaveBeenCalledWith(`diag:chain:${ID}`, 0, 499);
  });

  it("is built only with BASTION_CHAIN_TRACE=1 and Upstash configured (Ruling AM)", () => {
    const upstash = {
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    };
    expect(traceSinkFromEnv({})).toBeNull();
    expect(traceSinkFromEnv(upstash)).toBeNull();
    expect(traceSinkFromEnv({ ...upstash, BASTION_CHAIN_TRACE: "true" })).toBeNull();
    expect(
      traceSinkFromEnv({
        BASTION_CHAIN_TRACE: "1",
        UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      }),
    ).toBeNull();
    expect(traceSinkFromEnv({ ...upstash, BASTION_CHAIN_TRACE: "1" })).not.toBeNull();
  });
});

describe("instanceFacts", () => {
  it("names this instance once and counts what it served; only the first request is cold", () => {
    const a = instanceFacts();
    const b = instanceFacts();
    expect(a.instance).toMatch(/^[0-9a-f]{8}$/);
    expect(b.instance).toBe(a.instance);
    expect(b.served).toBe(a.served + 1);
    expect(b.coldStart).toBe(false);
    expect(a.coldStart).toBe(a.served === 1);
  });
});
