import * as z from "zod/mini";

/**
 * What one workbench action came to (spec 21 §5.1): the data with its request id, or a failure named
 * for what it is. Pure, and small enough for the browser (zod/mini).
 *
 * - `asleep`, `rate_limited`, `budget_exhausted` — the platform's limits, never the product failing;
 * - `downstream_error` — the product's own answer (a 4xx keeps its status and reason);
 * - `invalid_response` — an answer in a shape the capability's schema refuses;
 * - `invalid_input` — the gateway refused the input before calling anything;
 * - `refused` — bastion's tools route refused the call itself (an unknown capability, a wrong verb);
 * - `unreachable` — bastion did not answer within its own contract (network, an HTML error page).
 */

export type ToolFailure =
  | { kind: "asleep" }
  | { kind: "rate_limited"; retryAfterS: number }
  | { kind: "budget_exhausted"; retryAfterS?: number }
  | { kind: "downstream_error"; status: number; detail?: string }
  | { kind: "invalid_response"; detail?: string }
  | { kind: "invalid_input"; detail?: string }
  | { kind: "refused"; error: string; detail?: string }
  | { kind: "unreachable"; status?: number; detail?: string };

export type FailedOutcome = { ok: false; requestId: string | null } & ToolFailure;

export type ToolOutcome<O> =
  | { ok: true; data: O; status: number; requestId: string }
  | FailedOutcome;

export type FailureKind = ToolFailure["kind"];

/** The part of `fetch` the browser edges use; the real one fits, and so does a test's stub. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_RETRY_S = 60;

/**
 * The tools route's error body (`src/platform/gateway/http.ts`); bastion's other routes send the
 * same shape without a request id.
 */
const errorBody = z.object({
  error: z.string().check(z.minLength(1)),
  detail: z.optional(z.string()),
  retryAfterS: z.optional(z.number().check(z.nonnegative())),
  requestId: z.optional(z.string().check(z.minLength(1))),
});

function retryAfterHeader(value: string | null): number | undefined {
  const trimmed = value?.trim() ?? "";
  return /^\d+$/.test(trimmed) ? Math.max(1, Number(trimmed)) : undefined;
}

/** A non-2xx answer from one of bastion's own routes, as a named failure. */
export function failureFrom(
  status: number,
  body: unknown,
  headerRequestId: string | null,
  retryAfter: string | null = null,
): FailedOutcome {
  const parsed = errorBody.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "unreachable",
      status,
      detail: `bastion answered ${status} outside its contract`,
      requestId: headerRequestId,
    };
  }
  const { error, detail } = parsed.data;
  const requestId = parsed.data.requestId ?? headerRequestId;
  const retryAfterS = parsed.data.retryAfterS ?? retryAfterHeader(retryAfter);
  const base = { ok: false as const, requestId };
  const withDetail = detail === undefined ? {} : { detail };
  switch (error) {
    case "asleep":
      return { ...base, kind: "asleep" };
    case "rate_limited":
      return { ...base, kind: "rate_limited", retryAfterS: retryAfterS ?? DEFAULT_RETRY_S };
    case "budget_exhausted":
      return {
        ...base,
        kind: "budget_exhausted",
        ...(retryAfterS === undefined ? {} : { retryAfterS }),
      };
    case "downstream_error":
      return { ...base, kind: "downstream_error", status, ...withDetail };
    case "invalid_response":
      return { ...base, kind: "invalid_response", ...withDetail };
    case "invalid_input":
      return { ...base, kind: "invalid_input", ...withDetail };
    default:
      return { ...base, kind: "refused", error, ...withDetail };
  }
}

/** Failures worth asking again after a pause: the service may wake, the limit may pass. */
export function isTransient(failure: ToolFailure): boolean {
  return (
    failure.kind === "asleep" || failure.kind === "unreachable" || failure.kind === "rate_limited"
  );
}
