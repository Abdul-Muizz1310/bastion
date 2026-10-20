import type { FailedOutcome, ToolOutcome } from "./outcome";

/**
 * Following a long-running thing — a debate, a leak scan, an upload's job — spec 21 §5.1 case 5.
 * One call at a time: the next is scheduled only after the previous answer, so polls never
 * overlap. It ends at the terminal answer, at its deadline, or when the visitor leaves (the signal).
 *
 * A 429 waits as long as it says (capped at a minute) and asks again; an asleep or unreachable
 * answer waits an interval and asks again, up to five in a row; any other failure ends the poll and
 * is handed back. Time and sleep are injectable, so the scheduler is tested without real timers.
 */

export type PollEnd<O> =
  | { kind: "done"; data: O; requestId: string }
  | { kind: "failed"; failure: FailedOutcome }
  | { kind: "timeout" }
  | { kind: "aborted" };

export type PollOptions<O> = {
  call: (signal: AbortSignal) => Promise<ToolOutcome<O>>;
  isTerminal: (data: O) => boolean;
  onData?: (data: O, requestId: string) => void;
  intervalMs: number;
  deadlineMs: number;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

export const MAX_RETRY_WAIT_MS = 60_000;
export const MAX_TRANSIENT_IN_A_ROW = 5;

/** Resolves after `ms`, or early when the signal aborts (the poll then sees the abort). */
export function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function assertMs(name: string, ms: number): void {
  if (!Number.isSafeInteger(ms) || ms < 1) {
    throw new RangeError(`pollTool: ${name} must be a positive whole number of ms`);
  }
}

export async function pollTool<O>(options: PollOptions<O>): Promise<PollEnd<O>> {
  const { call, isTerminal, onData, intervalMs, deadlineMs, signal } = options;
  assertMs("intervalMs", intervalMs);
  assertMs("deadlineMs", deadlineMs);
  const sleep = options.sleep ?? sleepFor;
  const now = options.now ?? (() => Date.now());
  const started = now();

  let transient = 0;
  for (;;) {
    if (signal.aborted) return { kind: "aborted" };
    const outcome = await call(signal);
    if (signal.aborted) return { kind: "aborted" };

    let wait = intervalMs;
    if (outcome.ok) {
      transient = 0;
      onData?.(outcome.data, outcome.requestId);
      if (isTerminal(outcome.data)) {
        return { kind: "done", data: outcome.data, requestId: outcome.requestId };
      }
    } else if (outcome.kind === "rate_limited") {
      wait = Math.min(MAX_RETRY_WAIT_MS, Math.max(intervalMs, outcome.retryAfterS * 1000));
    } else if (outcome.kind === "asleep" || outcome.kind === "unreachable") {
      transient += 1;
      if (transient >= MAX_TRANSIENT_IN_A_ROW) return { kind: "failed", failure: outcome };
    } else {
      return { kind: "failed", failure: outcome };
    }

    if (now() + wait - started > deadlineMs) return { kind: "timeout" };
    await sleep(wait, signal);
  }
}
