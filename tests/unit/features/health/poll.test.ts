import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusSnapshot } from "@/features/health/model";
import { startStatusPoll, type Visibility } from "@/features/health/poll";

/**
 * Task 11: the home map polls GET /api/platform/status every 30 s. A poll can take up to 8 s (an
 * asleep service times out), so the next one is scheduled after the previous one finishes — never
 * two at once. A hidden tab does not poll (each probe can wake a Render service); it catches up as
 * soon as it is visible again. Stopping aborts the request in flight and ignores its answer.
 */

const AT = "2026-10-20T10:00:00.000Z";
const OK: StatusSnapshot = { phase: "ok", checkedAt: AT, services: {} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeVisibility(hidden = false) {
  const listeners = new Set<() => void>();
  const state = { hidden };
  const visibility: Visibility = {
    isHidden: () => state.hidden,
    onVisible(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    visibility,
    listeners,
    show() {
      state.hidden = false;
      for (const l of listeners) l();
    },
    hide() {
      state.hidden = true;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startStatusPoll", () => {
  it("polls at once, then 30 s after each answer", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(OK);
    const onSnapshot = vi.fn();
    const stop = startStatusPoll({ fetchStatus, onSnapshot, intervalMs: 30_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenLastCalledWith(OK);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    stop();
  });

  it("never overlaps: a slow answer delays the next poll instead of stacking another", async () => {
    const slow = deferred<StatusSnapshot>();
    const fetchStatus = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValue(OK);
    const stop = startStatusPoll({ fetchStatus, onSnapshot: vi.fn(), intervalMs: 30_000 });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    slow.resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports a failed request as an error snapshot and keeps polling", async () => {
    const fetchStatus = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue(OK);
    const onSnapshot = vi.fn();
    const stop = startStatusPoll({ fetchStatus, onSnapshot, intervalMs: 30_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(onSnapshot).toHaveBeenLastCalledWith({ phase: "error", checkedAt: AT });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(onSnapshot).toHaveBeenLastCalledWith(OK);
    stop();
  });

  it("stops: aborts the request in flight, ignores its answer and schedules nothing", async () => {
    const pending = deferred<StatusSnapshot>();
    let signal: AbortSignal | undefined;
    const fetchStatus = vi.fn((s: AbortSignal) => {
      signal = s;
      return pending.promise;
    });
    const onSnapshot = vi.fn();
    const stop = startStatusPoll({ fetchStatus, onSnapshot, intervalMs: 30_000 });
    await vi.advanceTimersByTimeAsync(0);

    stop();
    expect(signal?.aborted).toBe(true);
    pending.resolve(OK);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("does not poll while the tab is hidden, and polls as soon as it is shown", async () => {
    const tab = fakeVisibility(true);
    const fetchStatus = vi.fn().mockResolvedValue(OK);
    const stop = startStatusPoll({
      fetchStatus,
      onSnapshot: vi.fn(),
      intervalMs: 30_000,
      visibility: tab.visibility,
    });

    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchStatus).not.toHaveBeenCalled();

    tab.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    stop();
    expect(tab.listeners.size).toBe(0);
  });

  it("skips a poll that falls due while hidden and catches up once on showing", async () => {
    const tab = fakeVisibility(false);
    const fetchStatus = vi.fn().mockResolvedValue(OK);
    const stop = startStatusPoll({
      fetchStatus,
      onSnapshot: vi.fn(),
      intervalMs: 30_000,
      visibility: tab.visibility,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    tab.hide();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    tab.show();
    tab.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    stop();
  });

  it("showing the tab before the next poll is due does not poll early", async () => {
    const tab = fakeVisibility(false);
    const fetchStatus = vi.fn().mockResolvedValue(OK);
    const stop = startStatusPoll({
      fetchStatus,
      onSnapshot: vi.fn(),
      intervalMs: 30_000,
      visibility: tab.visibility,
    });
    await vi.advanceTimersByTimeAsync(0);
    tab.hide();
    await vi.advanceTimersByTimeAsync(10_000);
    tab.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    stop();
  });

  it.each([0, -1, 999, Number.NaN, Number.POSITIVE_INFINITY, 1500.5])(
    "refuses an interval of %s ms (at least 1 s, a whole number)",
    (intervalMs) => {
      expect(() =>
        startStatusPoll({ fetchStatus: vi.fn(), onSnapshot: vi.fn(), intervalMs }),
      ).toThrow(RangeError);
    },
  );
});
