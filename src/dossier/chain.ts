import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey } from "@/platform/secrets";
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
 * The handoff is fire-and-forget: the callback waits up to HANDOFF_MS for the next invocation to
 * answer and then lets go (the next invocation keeps running), so one invocation never stays alive
 * for the whole chain. Every failure is logged and swallowed.
 */

export const ADVANCE_HEADER = "x-bastion-advance";
/** HKDF `info` for the advance key — bump the version to invalidate every token at once. */
export const ADVANCE_KEY_INFO = "bastion/advance/v1";
export const CHAIN_WAIT_MAX_MS = 10_000;
const HANDOFF_MS = 10_000;

export type ChainDeps = {
  fetch: (url: URL, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
};

const defaultDeps: ChainDeps = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

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

export async function chainAdvance(
  origin: string,
  dossierId: string,
  delayMs: number,
  deps: ChainDeps = defaultDeps,
): Promise<void> {
  if (delayMs > 0) await deps.sleep(delayMs);
  const url = new URL(`/api/dossiers/${encodeURIComponent(dossierId)}/advance`, origin);
  try {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { [ADVANCE_HEADER]: advanceToken(dossierId) },
      signal: AbortSignal.timeout(HANDOFF_MS),
    });
    if (!res.ok) {
      console.warn("dossier chain: the next advance was refused", {
        dossierId,
        status: res.status,
      });
    }
  } catch (err) {
    // Letting go after the handoff window is the design, not a failure.
    if (err instanceof DOMException && err.name === "TimeoutError") return;
    console.warn("dossier chain: handing off the next advance failed", {
      dossierId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
