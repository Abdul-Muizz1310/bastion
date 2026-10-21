import "server-only";

/**
 * What every gateway call returns (spec 21 §4): a typed union, never a thrown downstream failure.
 * Thrown errors are reserved for bastion's own programming and configuration errors.
 */

export type GatewayError =
  | "asleep"
  | "rate_limited"
  | "budget_exhausted"
  | "downstream_error"
  | "invalid_response"
  | "invalid_input";

export type GatewayResult<O> =
  | { ok: true; data: O; status: number; requestId: string; ms: number }
  | {
      ok: false;
      error: GatewayError;
      status: number;
      requestId: string;
      detail?: string;
      retryAfterS?: number;
    };

/**
 * The HTTP status bastion answers with for each error kind. A downstream 4xx keeps its own status
 * (it is the caller's mistake, reported as `downstream_error`); everything else uses this table.
 * `asleep` is a gateway timeout: Render's free services take 50–70 s to wake.
 */
export const GATEWAY_ERROR_STATUS: Readonly<Record<GatewayError, number>> = {
  asleep: 504,
  rate_limited: 429,
  budget_exhausted: 429,
  downstream_error: 502,
  invalid_response: 502,
  invalid_input: 422,
};

export { RAW_CONTENT_TYPES, type RawBody, type RawKind, rawBodySchema } from "../raw-body";
