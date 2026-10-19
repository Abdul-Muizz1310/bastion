import { z } from "zod";

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

/**
 * `raw` capabilities skip JSON: the upstream bytes and content type pass through as a `RawBody`,
 * which the capability's `output` schema (normally `rawBodySchema`) still parses. The content type
 * must be one the raw kind declares, or the call is `invalid_response`.
 */
export type RawKind = "png" | "zip" | "pem";

export const RAW_CONTENT_TYPES: Readonly<Record<RawKind, readonly string[]>> = {
  png: ["image/png"],
  zip: ["application/zip", "application/x-zip-compressed"],
  // A PEM public key: inkprint serves `text/plain; charset=utf-8`; the PEM type is also accepted.
  pem: ["text/plain", "application/x-pem-file"],
};

export const rawBodySchema = z.object({
  contentType: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
});

export type RawBody = z.infer<typeof rawBodySchema>;
