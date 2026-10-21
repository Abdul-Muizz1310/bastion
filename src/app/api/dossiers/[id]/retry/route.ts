import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { chainAdvance, handoffDeadline } from "@/dossier/chain";
import { chainTracer, newInvocationId } from "@/dossier/chain-trace";
import { retryStage } from "@/dossier/runner";
import { STAGES } from "@/dossier/stages";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/dossiers/[id]/retry` with `{ stage }` (spec 21 §6.4, "retry from this stage"): resets an
 * `error` stage — only while nothing after it is ok — to pending with attempt 0, audited as the
 * visitor, then restarts the run with `after()`. 409 when the stage cannot be retried. Limited to 5
 * an hour per visitor: each retry can spend a stage's downstream budget again.
 */

export const dynamic = "force-dynamic";
// The answer is quick; the after() hand-off then holds until the first stage has answered.
export const maxDuration = 300;

const retryLimiter = createRateLimiter({ max: 5, windowMs: 3_600_000 });
const bodySchema = z.strictObject({ stage: z.enum(STAGES) });

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Context): Promise<Response> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id } = await ctx.params;

  // A JSON body (declared as such), so a cross-site form cannot post one.
  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return errorResponse(415, {
      error: "unsupported_media_type",
      detail: "send application/json",
      requestId,
    });
  }

  const visitor = visitorFromRequest(req);
  const limit = await retryLimiter.check(`retry:${visitor}`);
  if (!limit.success) {
    return errorResponse(429, {
      error: "rate_limited",
      retryAfterS: limit.retryAfter ?? 3600,
      requestId,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    return errorResponse(422, { error: "invalid_input", detail: "body is not JSON", requestId });
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) {
    return errorResponse(422, {
      error: "invalid_input",
      detail: `stage must be one of ${STAGES.join(", ")}`,
      requestId,
    });
  }

  const result = await retryStage(id, body.data.stage, visitor);
  if (!result.ok) {
    if (result.reason === "unknown_dossier") {
      return errorResponse(404, { error: "unknown_dossier", requestId });
    }
    return errorResponse(409, { error: "not_retryable", detail: result.reason, requestId });
  }

  const origin = req.nextUrl.origin;
  // A promise, not a function: Next runs a function given to after() only when the response
  // closes, and a client gone before it is written would leave the run unstarted. It holds until the
  // first stage has answered, up to this invocation's own deadline (spec 21 §6.2).
  // The chain's trace (spec 21 §6.2): this invocation starts the run.
  const invocation = newInvocationId();
  await chainTracer({ event: "start.chain", dossierId: id, invocation, route: "retry" });
  after(
    chainAdvance(origin, id, 0, handoffDeadline(startedAt, maxDuration), {
      trace: { invocation, emit: chainTracer },
    }),
  );
  return Response.json(
    { stage: body.data.stage, dossier: result.dossier },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
