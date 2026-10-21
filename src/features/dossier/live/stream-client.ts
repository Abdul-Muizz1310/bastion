import { parseStreamEvent, type StreamEvent } from "./events";

/**
 * The browser end of a dossier's SSE stream (spec 21 §6.6, "The live run"). Every event is parsed
 * (`parseStreamEvent`) and a malformed one dropped — except `done`, which ends it for good even
 * when its body does not parse (Ruling AK). The route ends each stream within its 300 s budget
 * with `timeout`, after which this reopens a second later; a server-side `stream_error`, or a
 * connection the browser gave up on (a 404, a 500), reopens with a backoff (2 s doubling to 30 s,
 * reset by the next open) — five such failures in a row without one open and it stops and says so.
 * A connection the browser is retrying itself is only reported. `pause` (a hidden tab) closes the
 * stream; `resume` opens it again. Closing stops everything.
 */

/** The part of `EventSource` this needs; the browser's fits, and so does a test's fake. */
export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
};

export type ConnectionState = "open" | "reconnecting" | "paused" | "failed";

export type StreamHandlers = {
  onEvent: (event: StreamEvent) => void;
  onConnection: (state: ConnectionState) => void;
};

export type StreamDeps = {
  EventSourceImpl: new (url: string) => EventSourceLike;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

/** The followed stream: `pause` while the tab is hidden, `resume` when shown, `close` for good. */
export type StreamControl = { close(): void; pause(): void; resume(): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSED = 2;
const TIMEOUT_REOPEN_MS = 1_000;
const BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;
/** Failures in a row, without one open, after which the page stops trying (Ruling AK). */
export const MAX_FAILURES = 5;
const EVENTS = ["step", "status", "done", "timeout", "heartbeat"] as const;

export function streamPath(dossierId: string): string {
  if (!UUID.test(dossierId)) throw new RangeError("stream: not a dossier id");
  return `/api/dossiers/${dossierId}/stream`;
}

export function followDossier(
  dossierId: string,
  handlers: StreamHandlers,
  deps: StreamDeps,
): StreamControl {
  const url = streamPath(dossierId);
  let source: EventSourceLike | null = null;
  let timer: unknown = null;
  let failures = 0;
  /** done, given up, or closed by the page: nothing reopens it. */
  let ended = false;
  let paused = false;

  function stop(): void {
    source?.close();
    source = null;
  }

  function clearTimer(): void {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function reopenIn(ms: number): void {
    stop();
    if (ended || paused) return;
    handlers.onConnection("reconnecting");
    clearTimer();
    timer = deps.setTimer(() => {
      timer = null;
      open();
    }, ms);
  }

  /** One more failure in a row: back off, or — the fifth — stop for good and say so. */
  function failed(): void {
    failures += 1;
    if (failures >= MAX_FAILURES) {
      ended = true;
      stop();
      clearTimer();
      handlers.onConnection("failed");
      return;
    }
    reopenIn(Math.min(BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS));
  }

  function end(): void {
    ended = true;
    clearTimer();
    stop();
  }

  function open(): void {
    if (ended || paused) return;
    const s = new deps.EventSourceImpl(url);
    source = s;
    s.onopen = () => {
      failures = 0;
      handlers.onConnection("open");
    };
    s.onerror = () => {
      if (source !== s) return;
      if (s.readyState === CLOSED) failed();
      else handlers.onConnection("reconnecting");
    };
    for (const type of EVENTS) {
      s.addEventListener(type, (e) => {
        if (source !== s) return;
        const event = parseStreamEvent(type, e.data);
        if (type === "done") {
          // Any done ends the run's stream, even one whose body does not parse (Ruling AK).
          handlers.onEvent(event ?? { type: "ended" });
          end();
          return;
        }
        if (event === null) return;
        handlers.onEvent(event);
        if (event.type === "timeout") reopenIn(TIMEOUT_REOPEN_MS);
      });
    }
    s.addEventListener("stream_error", () => {
      if (source === s) failed();
    });
  }

  open();
  return {
    close: end,
    pause() {
      if (ended || paused) return;
      paused = true;
      clearTimer();
      stop();
      handlers.onConnection("paused");
    },
    resume() {
      if (ended || !paused) return;
      paused = false;
      failures = 0;
      open();
    },
  };
}
