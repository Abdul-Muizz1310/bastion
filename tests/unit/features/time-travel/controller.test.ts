import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQueryScheduler,
  DEBOUNCE_MS,
  isoToPosition,
  positionToIso,
  SLIDER_MAX,
  SLIDER_MIN,
} from "@/features/time-travel/controller";
import type { TimeTravelView } from "@/features/time-travel/view";

/**
 * Spec 07 — Time Travel (Event Replay).
 *
 * The controller is the pure core behind the slider: it maps a slider position
 * onto a timestamp inside the event bounds and issues AT MOST one query per
 * `DEBOUNCE_MS` no matter how fast the user drags (spec case 10).
 */

const MIN_ISO = "2026-01-01T00:00:00.000Z";
const MAX_ISO = "2026-01-11T00:00:00.000Z"; // exactly 10 days later

function view(asOf: string): TimeTravelView {
  return {
    asOf,
    bounds: { min: MIN_ISO, max: MAX_ISO },
    entities: [],
    message: null,
  };
}

describe("07-replay controller: position <-> timestamp mapping", () => {
  it("case 3: the minimum slider position maps to the earliest event timestamp", () => {
    expect(positionToIso(SLIDER_MIN, { min: MIN_ISO, max: MAX_ISO })).toBe(MIN_ISO);
  });

  it("case 4: the maximum slider position maps to the upper bound (now)", () => {
    expect(positionToIso(SLIDER_MAX, { min: MIN_ISO, max: MAX_ISO })).toBe(MAX_ISO);
  });

  it("interpolates linearly between the bounds", () => {
    const half = positionToIso(SLIDER_MAX / 2, { min: MIN_ISO, max: MAX_ISO });
    expect(half).toBe("2026-01-06T00:00:00.000Z");
  });

  it("clamps out-of-range positions instead of producing a timestamp outside the bounds", () => {
    expect(positionToIso(-500, { min: MIN_ISO, max: MAX_ISO })).toBe(MIN_ISO);
    expect(positionToIso(SLIDER_MAX * 10, { min: MIN_ISO, max: MAX_ISO })).toBe(MAX_ISO);
  });

  it("case 9: with no earliest event there is nothing to rewind to — every position is `now`", () => {
    expect(positionToIso(SLIDER_MIN, { min: null, max: MAX_ISO })).toBe(MAX_ISO);
    expect(positionToIso(SLIDER_MAX, { min: null, max: MAX_ISO })).toBe(MAX_ISO);
  });

  it("isoToPosition is the inverse of positionToIso", () => {
    for (const p of [SLIDER_MIN, 250, SLIDER_MAX / 2, 999, SLIDER_MAX]) {
      const iso = positionToIso(p, { min: MIN_ISO, max: MAX_ISO });
      expect(isoToPosition(iso, { min: MIN_ISO, max: MAX_ISO })).toBe(p);
    }
  });

  it("isoToPosition returns the maximum when there is no lower bound", () => {
    expect(isoToPosition(MAX_ISO, { min: null, max: MAX_ISO })).toBe(SLIDER_MAX);
  });
});

describe("07-replay controller: debounced slider queries (case 10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues exactly one query for a burst of rapid drags, using the final position", async () => {
    const load = vi.fn(async (iso: string) => view(iso));
    const onResult = vi.fn();
    const scheduler = createQueryScheduler({ load, onResult, onError: vi.fn() });

    for (let p = 0; p <= 10; p++) {
      scheduler.schedule(positionToIso(p * 10, { min: MIN_ISO, max: MAX_ISO }));
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 10);
    }
    expect(load).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(positionToIso(100, { min: MIN_ISO, max: MAX_ISO }));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("never exceeds one query per debounce window across a long drag", async () => {
    const load = vi.fn(async (iso: string) => view(iso));
    const scheduler = createQueryScheduler({ load, onResult: vi.fn(), onError: vi.fn() });

    // 30 drag events over 3 debounce windows.
    for (let i = 0; i < 30; i++) {
      scheduler.schedule(positionToIso(i * 30, { min: MIN_ISO, max: MAX_ISO }));
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 10);
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const elapsedWindows = (30 * (DEBOUNCE_MS / 10) + DEBOUNCE_MS) / DEBOUNCE_MS;
    expect(load.mock.calls.length).toBeLessThanOrEqual(Math.ceil(elapsedWindows));
    expect(load).toHaveBeenCalled();
  });

  it("reports pending state around the query", async () => {
    let release: (v: TimeTravelView) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<TimeTravelView>((resolve) => {
          release = resolve;
        }),
    );
    const onPending = vi.fn();
    const scheduler = createQueryScheduler({
      load,
      onResult: vi.fn(),
      onError: vi.fn(),
      onPending,
    });

    scheduler.schedule(MIN_ISO);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(onPending).toHaveBeenLastCalledWith(true);

    release(view(MIN_ISO));
    await vi.advanceTimersByTimeAsync(0);
    expect(onPending).toHaveBeenLastCalledWith(false);
  });

  it("cancel() drops a scheduled query that has not fired yet", async () => {
    const load = vi.fn(async (iso: string) => view(iso));
    const scheduler = createQueryScheduler({ load, onResult: vi.fn(), onError: vi.fn() });

    scheduler.schedule(MIN_ISO);
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("07-replay controller: out-of-order and failing queries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    const resolvers: Array<() => void> = [];
    const load = vi.fn(
      (iso: string) =>
        new Promise<TimeTravelView>((resolve) => {
          resolvers.push(() => resolve(view(iso)));
        }),
    );
    const onResult = vi.fn();
    const scheduler = createQueryScheduler({ load, onResult, onError: vi.fn() });

    scheduler.schedule(MIN_ISO);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    scheduler.schedule(MAX_ISO);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(load).toHaveBeenCalledTimes(2);

    // Newest resolves first, then the stale one.
    resolvers[1]();
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0]();
    await vi.advanceTimersByTimeAsync(0);

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ asOf: MAX_ISO }));
  });

  it("surfaces a failed query through onError and not onResult", async () => {
    const load = vi.fn(async () => {
      throw new Error("boom");
    });
    const onResult = vi.fn();
    const onError = vi.fn();
    const scheduler = createQueryScheduler({ load, onResult, onError });

    scheduler.schedule(MIN_ISO);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(String));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("ignores a stale rejection once a newer query is in flight", async () => {
    const rejecters: Array<() => void> = [];
    const resolvers: Array<() => void> = [];
    const load = vi.fn(
      (iso: string) =>
        new Promise<TimeTravelView>((resolve, reject) => {
          rejecters.push(() => reject(new Error("stale failure")));
          resolvers.push(() => resolve(view(iso)));
        }),
    );
    const onError = vi.fn();
    const onResult = vi.fn();
    const scheduler = createQueryScheduler({ load, onResult, onError });

    scheduler.schedule(MIN_ISO);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    scheduler.schedule(MAX_ISO);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    resolvers[1]();
    await vi.advanceTimersByTimeAsync(0);
    rejecters[0]();
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
