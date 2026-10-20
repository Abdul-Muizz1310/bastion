import type { StatusSnapshot } from "./model";

/**
 * The status poll's scheduler (spec 21 §3.1 case 3), free of React and of the DOM so it can be
 * driven by fake timers. Each poll is scheduled after the previous one ends, so a slow answer (an
 * asleep service holds the route for up to 8 s) never stacks a second request. A hidden tab does not
 * poll — every probe can wake a Render service — and polls once as soon as it is shown again.
 */

export type Visibility = {
  isHidden(): boolean;
  /** Calls `listener` whenever the page becomes visible; returns an unsubscribe. */
  onVisible(listener: () => void): () => void;
};

export type PollOptions = {
  /** Resolves to an ok snapshot or throws; the signal aborts it. */
  fetchStatus: (signal: AbortSignal) => Promise<StatusSnapshot>;
  onSnapshot: (snapshot: StatusSnapshot) => void;
  intervalMs: number;
  visibility?: Visibility;
  now?: () => Date;
};

export const MIN_INTERVAL_MS = 1_000;

/** Starts polling at once; returns a stop function that aborts the request in flight. */
export function startStatusPoll(options: PollOptions): () => void {
  const { fetchStatus, onSnapshot, intervalMs, visibility } = options;
  const now = options.now ?? (() => new Date());
  if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    throw new RangeError(`status poll: intervalMs must be a whole number ≥ ${MIN_INTERVAL_MS}`);
  }

  let stopped = false;
  let due = false;
  let inFlight: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function poll(): Promise<void> {
    timer = undefined;
    if (stopped) return;
    if (visibility?.isHidden()) {
      due = true;
      return;
    }
    due = false;
    const controller = new AbortController();
    inFlight = controller;
    let snapshot: StatusSnapshot;
    try {
      snapshot = await fetchStatus(controller.signal);
    } catch {
      snapshot = { phase: "error", checkedAt: now().toISOString() };
    }
    inFlight = undefined;
    if (stopped) return;
    onSnapshot(snapshot);
    timer = setTimeout(poll, intervalMs);
  }

  const unsubscribe = visibility?.onVisible(() => {
    if (due && !inFlight && !stopped) void poll();
  });

  void poll();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    inFlight?.abort();
    unsubscribe?.();
  };
}
