import { healthSchema } from "@/features/health/model";
import type { ServiceId } from "@/platform/registry/products";
import type { FetchLike } from "./outcome";

/**
 * The browser edge of a workbench's wake gate (spec 21 §5.1, Ruling F): `POST
 * /api/platform/wake/<service>`, which holds a health request open for up to 90 s and answers with
 * the service's final Health. Its own answer drives the gate — never the 30 s shared status. A
 * request that fails is a failed wake, never a guessed state; an abort is rethrown.
 */

export type WakeAnswer =
  | { kind: "answer"; state: "live" | "asleep" | "down"; latencyMs: number }
  | { kind: "rate_limited"; retryAfterS: number }
  | { kind: "failed"; detail: string };

/** The wake route holds up to 90 s and reads /version after; a little more, then give up. */
export const WAKE_REQUEST_TIMEOUT_MS = 100_000;

const DEFAULT_RETRY_S = 60;

function retryAfter(header: string | null): number {
  const value = header?.trim() ?? "";
  if (!/^\d+$/.test(value)) return DEFAULT_RETRY_S;
  return Math.max(1, Number(value));
}

export async function wakeService(
  service: ServiceId,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<WakeAnswer> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/platform/wake/${encodeURIComponent(service)}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(WAKE_REQUEST_TIMEOUT_MS)]),
      headers: { accept: "application/json" },
    });
  } catch (err) {
    if (signal.aborted) throw err;
    return { kind: "failed", detail: "the wake route could not be reached" };
  }
  if (res.status === 429) {
    return { kind: "rate_limited", retryAfterS: retryAfter(res.headers.get("retry-after")) };
  }
  if (!res.ok) return { kind: "failed", detail: `the wake route answered ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "failed", detail: "the wake route answered in an unreadable shape" };
  }
  const parsed = healthSchema.safeParse(body);
  if (!parsed.success || parsed.data.service !== service) {
    return { kind: "failed", detail: "the wake route answered in an unexpected shape" };
  }
  return { kind: "answer", state: parsed.data.state, latencyMs: parsed.data.latencyMs };
}
