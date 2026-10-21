import { randomUUID } from "node:crypto";
import { z } from "zod";
import { traceSinkFromEnv } from "@/dossier/chain-trace";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `GET /api/dossiers/[id]/chain-trace` (spec 21 §6.2 "The chain's trace", diagnostic): the dossier's
 * chain events, oldest first, read from the per-dossier list the runner writes when Upstash is
 * configured — because a platform may not keep what a function logs after its answer. Public like
 * the dossier (ids, stages, statuses and milliseconds only), never cached, 30 a minute per visitor;
 * 503 `trace_unavailable` when no list is kept or it cannot be read.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const traceLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

type Context = { params: Promise<{ id: string }> };

const traceObject = z.record(z.string(), z.json());

/** A stored line that parses to a JSON object; anything else is dropped, never echoed. */
function parsed(line: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const object = traceObject.safeParse(value);
  return object.success ? object.data : null;
}

export async function GET(req: Request, ctx: Context): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const limit = await traceLimiter.check(`chain-trace:${visitorFromRequest(req)}`);
  if (!limit.success) {
    return errorResponse(429, {
      error: "rate_limited",
      retryAfterS: limit.retryAfter ?? 60,
      requestId,
    });
  }
  if (!UUID.test(id)) return errorResponse(404, { error: "unknown_dossier", requestId });

  const sink = traceSinkFromEnv(process.env);
  if (sink === null) {
    return errorResponse(503, {
      error: "trace_unavailable",
      detail: "no trace list is kept",
      requestId,
    });
  }
  let lines: string[];
  try {
    lines = await sink.read(id);
  } catch {
    return errorResponse(503, { error: "trace_unavailable", requestId });
  }
  const events = lines.flatMap((line) => {
    const event = parsed(line);
    return event === null ? [] : [event];
  });
  return Response.json(
    { dossierId: id, events },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
