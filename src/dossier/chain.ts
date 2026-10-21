import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "@/platform/secrets";
import { type ChainEventName, type TraceValue, traceId } from "./chain-trace";
import type { AdvanceResult } from "./runner";

/**
 * Chaining (spec 21 §6.2): after a stage finishes, the advance route hands the dossier to a fresh
 * invocation from `after()` — a POST to its own advance route. The POST carries an internal HMAC of
 * the dossier id, so the per-visitor rate limit (which would key every server-side call on the
 * deployment's own address) never throttles the runner itself.
 *
 * Self-driving waits: when the next stage is due within CHAIN_WAIT_MAX_MS (a waiting stage's 3 s
 * poll, a retry's 5–10 s backoff) the `after()` callback sleeps until then and chains; anything later
 * is left to the dossier page, which nudges `advance` while it is open, and to lease expiry.
 *
 * The hand-off holds on (fix after the first live smoke, spec 21 §6.2): on Vercel an invocation
 * whose caller disconnects before it has answered loses its after() work, so a caller never lets go
 * on a short timer. It holds the connection until the next invocation has **answered** — which it
 * does as soon as its stage is recorded, before its own hand-off runs — or until the caller's own
 * deadline (`handoffDeadline`: its start + maxDuration − HANDOFF_MARGIN_MS). Each invocation waits
 * for its successor's answer only, so at most two invocations of a dossier live at once. Every
 * failure is logged and swallowed; the page's nudge and lease expiry recover a lost hand-off.
 */

export const ADVANCE_HEADER = "x-bastion-advance";
/** The caller's invocation id, so the two ends of a hop can be joined in the trace (not a secret). */
export const CHAIN_FROM_HEADER = "x-bastion-chain-from";
/** The answering invocation's id, read back by its caller. */
export const INVOCATION_HEADER = "x-bastion-invocation";
/** HKDF `info` for the advance key — bump the version to invalidate every token at once. */
export const ADVANCE_KEY_INFO = "bastion/advance/v1";
export const CHAIN_WAIT_MAX_MS = 10_000;
/** What a caller keeps of its own budget after waiting for its successor: time to finish cleanly. */
export const HANDOFF_MARGIN_MS = 15_000;
/** The shortest window a hand-off asks for, even past its deadline (the successor still starts). */
const MIN_HANDOFF_MS = 1_000;

export type ChainDeps = {
  fetch: (url: URL, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** An abort signal that fires after `ms` — the hand-off's whole window, the answer's body included. */
  timeout: (ms: number) => AbortSignal;
  /** The calling invocation and where its trace lines go (spec 21 §6.2 "The chain's trace"). */
  trace: ChainTrace;
};

export type ChainTrace = {
  invocation: string;
  emit: (
    event: { event: ChainEventName; dossierId: string; invocation: string } & {
      [field: string]: TraceValue;
    },
  ) => Promise<void>;
};

const silent: ChainTrace = { invocation: "-", emit: async () => {} };

const defaultDeps: ChainDeps = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  timeout: (ms) => AbortSignal.timeout(ms),
  trace: silent,
};

/**
 * When a hand-off must let go (epoch ms): the caller's start plus its route's `maxDuration`, less the
 * margin it needs to finish. A route whose maxDuration leaves no room past the margin is a bug.
 */
export function handoffDeadline(startedAtMs: number, maxDurationS: number): number {
  if (!Number.isInteger(maxDurationS) || maxDurationS * 1000 <= HANDOFF_MARGIN_MS) {
    throw new RangeError(
      `handoffDeadline: maxDuration must be a whole number of seconds above ${HANDOFF_MARGIN_MS / 1000}`,
    );
  }
  return startedAtMs + maxDurationS * 1000 - HANDOFF_MARGIN_MS;
}

/** The internal header value for one dossier: base64url HMAC-SHA256(advance key, dossier id). */
export function advanceToken(dossierId: string): string {
  return createHmac("sha256", deriveKey(ADVANCE_KEY_INFO)).update(dossierId).digest("base64url");
}

export function isAdvanceToken(dossierId: string, token: string | null): boolean {
  if (token === null || token === "") return false;
  const expected = Buffer.from(advanceToken(dossierId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** How long to wait before chaining the next advance — or null when this invocation should not. */
export function chainDelayMs(result: AdvanceResult, now: Date): number | null {
  if (result.ran === null || result.status === null) return null;
  if (result.dossier === "succeeded" || result.dossier === "failed") return null;
  if (result.nextAt === null) return null;
  const delay = result.nextAt.getTime() - now.getTime();
  return delay > CHAIN_WAIT_MAX_MS ? null : Math.max(0, delay);
}

/**
 * Registers a chain whose delay is decided later (spec 21 §6.2, Task 15). `schedule` — the route's
 * `after` — receives, at once, a promise that settles after `decide` is called: it chains with the
 * decided delay, or does nothing for null. The route calls this before running its stage: Next runs
 * a *function* given to `after()` only when the response closes, and a close that already happened
 * never fires again, while a promise is kept alive with `waitUntil` and needs no close. Only the
 * first decision counts; `chain` is `chainAdvance` bound to the route's deadline, which never
 * rejects.
 */
export function deferChain(
  origin: string,
  dossierId: string,
  schedule: (task: Promise<void>) => void,
  chain: (origin: string, dossierId: string, delayMs: number) => Promise<void>,
): (delayMs: number | null) => void {
  let decide: (delayMs: number | null) => void = () => {};
  const decided = new Promise<number | null>((resolve) => {
    decide = resolve;
  });
  schedule(
    decided.then((delayMs) => (delayMs === null ? undefined : chain(origin, dossierId, delayMs))),
  );
  return decide;
}

export async function chainAdvance(
  origin: string,
  dossierId: string,
  delayMs: number,
  deadlineMs: number,
  overrides: Partial<ChainDeps> = {},
): Promise<void> {
  const deps: ChainDeps = { ...defaultDeps, ...overrides };
  const { invocation } = deps.trace;
  const note = (event: ChainEventName, fields: Record<string, TraceValue>) =>
    deps.trace.emit({ event, dossierId, invocation, ...fields });
  const began = deps.now();
  await note("chain.after", { delayMs });
  if (delayMs > 0) {
    const slept = deps.now();
    await deps.sleep(delayMs);
    // A timer that fires late means the instance was frozen while this work waited.
    await note("chain.sleep", { plannedMs: delayMs, actualMs: deps.now() - slept });
  }
  const url = new URL(`/api/dossiers/${encodeURIComponent(dossierId)}/advance`, origin);
  const windowMs = Math.max(MIN_HANDOFF_MS, deadlineMs - deps.now());
  await note("chain.fetch", { host: url.host, windowMs });
  const sent = deps.now();
  try {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { [ADVANCE_HEADER]: advanceToken(dossierId), [CHAIN_FROM_HEADER]: invocation },
      signal: deps.timeout(windowMs),
    });
    // Read to the end: the successor has answered, and the connection is released, not left open.
    await res.arrayBuffer();
    await note("chain.response", {
      status: res.status,
      elapsedMs: deps.now() - sent,
      successor: traceId(res.headers.get(INVOCATION_HEADER)),
      vercelId: traceId(res.headers.get("x-vercel-id")),
      mitigated: traceId(res.headers.get("x-vercel-mitigated")),
    });
    if (!res.ok) {
      console.warn("dossier chain: the next advance was refused", {
        dossierId,
        status: res.status,
      });
    }
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      await note("chain.letgo", { elapsedMs: deps.now() - sent, windowMs });
      // The caller's own budget ran out first: the successor's hand-off may be lost on platforms
      // that drop an invocation's after() work once its caller is gone.
      // The id is in the message itself, so one log line names the dossier (the e2e reads it back).
      console.warn(
        `dossier chain: the hand-off let go before the next advance answered (dossier ${dossierId})`,
        { dossierId, windowMs },
      );
    } else {
      const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await note("chain.error", { elapsedMs: deps.now() - sent, error: error.slice(0, 200) });
      console.warn("dossier chain: handing off the next advance failed", {
        dossierId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await note("chain.settled", { totalMs: deps.now() - began });
}
