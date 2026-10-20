import { parseStreamEvent, type StreamEvent } from "./events";

/**
 * The browser end of a dossier's SSE stream (spec 21 §6.6, "The live run"). Every event is parsed
 * (`parseStreamEvent`) and a malformed one dropped. `done` ends it for good. The route ends each
 * stream within its 300 s budget with `timeout`, after which this reopens a second later; a
 * server-side `stream_error`, or a connection the browser gave up on, reopens with a backoff
 * (2 s doubling to 30 s, reset by the next open). A connection the browser is retrying itself is
 * only reported. Closing stops everything.
 */

/** The part of `EventSource` this needs; the browser's fits, and so does a test's fake. */
export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
};

export type StreamHandlers = {
  onEvent: (event: StreamEvent) => void;
  onConnection: (state: "open" | "reconnecting") => void;
};

export type StreamDeps = {
  EventSourceImpl: new (url: string) => EventSourceLike;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSED = 2;
const TIMEOUT_REOPEN_MS = 1_000;
const BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;
const EVENTS = ["step", "status", "done", "timeout", "heartbeat"] as const;

export function streamPath(dossierId: string): string {
  if (!UUID.test(dossierId)) throw new RangeError("stream: not a dossier id");
  return `/api/dossiers/${dossierId}/stream`;
}

export function followDossier(
  dossierId: string,
  handlers: StreamHandlers,
  deps: StreamDeps,
): () => void {
  const url = streamPath(dossierId);
  let source: EventSourceLike | null = null;
  let timer: unknown = null;
  let failures = 0;
  let closed = false;

  function stop(): void {
    source?.close();
    source = null;
  }

  function reopenIn(ms: number): void {
    stop();
    if (closed) return;
    handlers.onConnection("reconnecting");
    if (timer !== null) deps.clearTimer(timer);
    timer = deps.setTimer(() => {
      timer = null;
      open();
    }, ms);
  }

  function backoff(): number {
    failures += 1;
    return Math.min(BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
  }

  function open(): void {
    if (closed) return;
    const s = new deps.EventSourceImpl(url);
    source = s;
    s.onopen = () => {
      failures = 0;
      handlers.onConnection("open");
    };
    s.onerror = () => {
      if (source !== s) return;
      if (s.readyState === CLOSED) reopenIn(backoff());
      else handlers.onConnection("reconnecting");
    };
    for (const type of EVENTS) {
      s.addEventListener(type, (e) => {
        if (source !== s) return;
        const event = parseStreamEvent(type, e.data);
        if (event === null) return;
        handlers.onEvent(event);
        if (event.type === "done") {
          closed = true;
          stop();
        } else if (event.type === "timeout") {
          reopenIn(TIMEOUT_REOPEN_MS);
        }
      });
    }
    s.addEventListener("stream_error", () => {
      if (source === s) reopenIn(backoff());
    });
  }

  open();
  return () => {
    closed = true;
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    stop();
  };
}
