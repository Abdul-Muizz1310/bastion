import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EventSourceLike, followDossier } from "@/features/dossier/live/stream-client";
import { DOSSIER_ID } from "../fixtures";

/**
 * Spec 21 §6.6, "The live run": the browser end of the SSE stream. Every event is parsed; done ends
 * it; a timeout (the route's 300 s budget) or a server-side stream error reconnects; a connection
 * the browser gave up on reconnects with a backoff; closing stops everything.
 */

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = [];
  readonly url: string;
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, ((e: { data: string }) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeSource.all.push(this);
  }

  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
}

const STEP = {
  stage: "seal",
  status: "running",
  attempt: 1,
  error: null,
  nextAt: null,
  leaseUntil: "2026-10-20T10:04:30.000Z",
  startedAt: "2026-10-20T10:00:00.000Z",
  finishedAt: null,
  note: null,
};

function follow() {
  const onEvent = vi.fn();
  const onConnection = vi.fn();
  const close = followDossier(DOSSIER_ID, { onEvent, onConnection }, {
    EventSourceImpl: FakeSource,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  return { onEvent, onConnection, close };
}

beforeEach(() => {
  FakeSource.all = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("followDossier", () => {
  it("opens the dossier's stream and reports the connection", () => {
    const { onConnection } = follow();
    expect(FakeSource.all[0]?.url).toBe(`/api/dossiers/${DOSSIER_ID}/stream`);
    FakeSource.all[0]?.onopen?.();
    expect(onConnection).toHaveBeenCalledWith("open");
  });

  it("hands every parsed step and status event on, and drops a malformed one", () => {
    const { onEvent } = follow();
    const src = FakeSource.all[0];
    src?.emit("step", STEP);
    src?.emit("step", { ...STEP, stage: "adjudicate" });
    src?.emit("status", { status: "running", verdict: null, confidence: null });
    expect(onEvent.mock.calls.map((c) => c[0].type)).toEqual(["step", "status"]);
  });

  it("closes for good on done", async () => {
    const { onEvent } = follow();
    FakeSource.all[0]?.emit("done", { status: "succeeded", verdict: "TRUE", confidence: 0.8 });
    expect(onEvent).toHaveBeenLastCalledWith({
      type: "done",
      done: { status: "succeeded", verdict: "TRUE", confidence: 0.8 },
    });
    expect(FakeSource.all[0]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(FakeSource.all).toHaveLength(1);
  });

  it("reconnects a second after the route's timeout", async () => {
    const { onConnection } = follow();
    FakeSource.all[0]?.emit("timeout", {});
    expect(FakeSource.all[0]?.closed).toBe(true);
    expect(onConnection).toHaveBeenCalledWith("reconnecting");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSource.all).toHaveLength(2);
  });

  it("reconnects after a server-side stream error, with a backoff", async () => {
    follow();
    FakeSource.all[0]?.emit("stream_error", { error: "stream_error" });
    expect(FakeSource.all[0]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(FakeSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.all).toHaveLength(2);
  });

  it("lets the browser retry a dropped connection, and reopens one it gave up on", async () => {
    const { onConnection } = follow();
    const src = FakeSource.all[0];
    if (!src) throw new Error("no source");
    src.readyState = 0; // CONNECTING: the browser is retrying on its own
    src.onerror?.();
    expect(onConnection).toHaveBeenLastCalledWith("reconnecting");
    expect(src.closed).toBe(false);
    src.readyState = 2; // CLOSED: it gave up
    src.onerror?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSource.all).toHaveLength(2);
  });

  it("stops everything when closed: no reconnect after a pending timeout", async () => {
    const { close } = follow();
    FakeSource.all[0]?.emit("timeout", {});
    close();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(FakeSource.all).toHaveLength(1);
  });

  it("refuses an id that is not a dossier id", () => {
    expect(() =>
      followDossier("../x", { onEvent: () => {}, onConnection: () => {} }, {
        EventSourceImpl: FakeSource,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      }),
    ).toThrow(RangeError);
  });
});
