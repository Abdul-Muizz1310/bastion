import type { TimeTravelBoundsView, TimeTravelView } from "@/features/time-travel/view";

/**
 * Pure core behind the time-travel slider.
 *
 * Two responsibilities, both free of React and of the DOM so they can be
 * asserted directly (spec 07 cases 3, 4, 9 and 10):
 *   1. map a slider position onto a timestamp inside the event bounds;
 *   2. throttle a drag into at most one query per `DEBOUNCE_MS`, discarding
 *      responses that arrive out of order.
 */

export const SLIDER_MIN = 0;
export const SLIDER_MAX = 1000;
export const DEBOUNCE_MS = 300;

function clampPosition(position: number): number {
  if (!Number.isFinite(position)) return SLIDER_MAX;
  return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, Math.round(position)));
}

/** Slider position -> ISO timestamp. With no lower bound there is nothing to rewind to. */
export function positionToIso(position: number, bounds: TimeTravelBoundsView): string {
  if (bounds.min === null) return bounds.max;

  const minMs = Date.parse(bounds.min);
  const maxMs = Date.parse(bounds.max);
  if (Number.isNaN(minMs) || Number.isNaN(maxMs) || maxMs <= minMs) return bounds.max;

  const ratio = clampPosition(position) / SLIDER_MAX;
  return new Date(Math.round(minMs + (maxMs - minMs) * ratio)).toISOString();
}

/** ISO timestamp -> slider position. Inverse of {@link positionToIso}. */
export function isoToPosition(iso: string, bounds: TimeTravelBoundsView): number {
  if (bounds.min === null) return SLIDER_MAX;

  const minMs = Date.parse(bounds.min);
  const maxMs = Date.parse(bounds.max);
  const atMs = Date.parse(iso);
  if (Number.isNaN(minMs) || Number.isNaN(maxMs) || Number.isNaN(atMs) || maxMs <= minMs) {
    return SLIDER_MAX;
  }

  return clampPosition(((atMs - minMs) / (maxMs - minMs)) * SLIDER_MAX);
}

export type QueryScheduler = {
  /** Request the state at `asOfIso`; coalesced with any other call in the same window. */
  schedule(asOfIso: string): void;
  /** Drop a pending query and ignore any response still in flight. */
  cancel(): void;
};

export type QuerySchedulerOptions = {
  load: (asOfIso: string) => Promise<TimeTravelView>;
  onResult: (view: TimeTravelView) => void;
  onError: (message: string) => void;
  onPending?: (pending: boolean) => void;
  debounceMs?: number;
};

export function createQueryScheduler(options: QuerySchedulerOptions): QueryScheduler {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  // Monotonic issue counter. A response is only accepted while it is still the
  // newest one asked for — a slow early query must never overwrite a fast later
  // one, and a stale rejection must never surface as an error.
  let issued = 0;
  let accepted = 0;

  function run(asOfIso: string): void {
    issued += 1;
    const ticket = issued;
    options.onPending?.(true);

    options.load(asOfIso).then(
      (view) => {
        if (ticket <= accepted) return;
        accepted = ticket;
        options.onPending?.(false);
        options.onResult(view);
      },
      (err: unknown) => {
        if (ticket <= accepted) return;
        accepted = ticket;
        options.onPending?.(false);
        options.onError(err instanceof Error ? err.message : "Time-travel query failed");
      },
    );
  }

  return {
    schedule(asOfIso: string): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run(asOfIso);
      }, debounceMs);
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      accepted = issued;
    },
  };
}
