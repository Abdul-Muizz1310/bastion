import "server-only";
import { type GatewayResult, rawBodySchema } from "./result";

/**
 * A `GatewayResult` as the HTTP answer bastion's own routes give (pure). Success keeps the upstream
 * status — JSON, or the raw bytes with the upstream content type; a failure is its status and
 * `{ error, detail?, retryAfterS?, requestId }`, with `retry-after` when there is one. Every answer
 * carries `x-request-id` and is never cached.
 */

/** Statuses whose response must not have a body (Fetch spec "null body status"). */
const NULL_BODY = new Set([204, 205, 304]);

export type ErrorBody = { error: string; detail?: string; retryAfterS?: number; requestId: string };

function baseHeaders(requestId: string): Headers {
  return new Headers({ "x-request-id": requestId, "cache-control": "no-store" });
}

/** An error answer in the gateway's shape, for refusals a route makes before calling it. */
export function errorResponse(
  status: number,
  body: ErrorBody,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const headers = baseHeaders(body.requestId);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  if (body.retryAfterS !== undefined) headers.set("retry-after", String(body.retryAfterS));
  return Response.json(body, { status, headers });
}

export function toResponse<O>(result: GatewayResult<O>, raw: boolean): Response {
  if (!result.ok) {
    return errorResponse(result.status, {
      error: result.error,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      ...(result.retryAfterS === undefined ? {} : { retryAfterS: result.retryAfterS }),
      requestId: result.requestId,
    });
  }
  const headers = baseHeaders(result.requestId);
  if (NULL_BODY.has(result.status)) return new Response(null, { status: result.status, headers });
  if (raw) {
    // The capability's output schema already parsed this; re-parsing narrows it without a cast.
    const body = rawBodySchema.parse(result.data);
    headers.set("content-type", body.contentType);
    return new Response(body.bytes, { status: result.status, headers });
  }
  return Response.json(result.data, { status: result.status, headers });
}
