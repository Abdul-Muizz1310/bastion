import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";
import {
  ADVANCE_HEADER,
  chainAdvance,
  chainDelayMs,
  deferChain,
  isAdvanceToken,
} from "@/dossier/chain";
import { HANDLERS } from "@/dossier/handlers";
import { advance, UnknownDossierError } from "@/dossier/runner";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/dossiers/[id]/advance` (spec 21 §6.2): claim the dossier's next runnable stage, run it
 * (one stage, ≤ 240 s), record it, answer the `AdvanceResult`. Idempotent: a concurrent call finds
 * nothing to claim. Anyone may nudge a dossier (the page does, while it is open); visitors are
 * limited to 60 a minute, while the runner's own chained calls carry the internal HMAC header.
 *
 * Chaining: when a stage finished and the next is due within 10 s, `after()` sleeps until it is
 * due and POSTs this route again — see `@/dossier/chain`. The chain is registered before the stage
 * runs (`deferChain`): the previous invocation lets go of this one after 10 s, and Next drops a
 * function given to `after()` once the caller is gone, so a long stage would otherwise end the run.
 */

export const dynamic = "force-dynamic";
// One stage's 240 s budget, its recording, and the after() handoff to the next invocation.
export const maxDuration = 300;

const advanceLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Context): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  if (!isAdvanceToken(id, req.headers.get(ADVANCE_HEADER))) {
    const limit = await advanceLimiter.check(`advance:${visitorFromRequest(req)}`);
    if (!limit.success) {
      return errorResponse(429, {
        error: "rate_limited",
        retryAfterS: limit.retryAfter ?? 60,
        requestId,
      });
    }
  }

  // Registered now, decided once the stage is recorded: every path below decides exactly once.
  const decide = deferChain(req.nextUrl.origin, id, (task) => after(task), chainAdvance);
  let result: Awaited<ReturnType<typeof advance>>;
  try {
    result = await advance(id, HANDLERS);
  } catch (err) {
    decide(null);
    if (err instanceof UnknownDossierError) {
      return errorResponse(404, { error: "unknown_dossier", requestId });
    }
    console.error("advance failed", { dossierId: id, requestId, err });
    return errorResponse(500, { error: "advance_failed", requestId });
  }

  decide(chainDelayMs(result, new Date()));
  return Response.json(result, {
    headers: { "cache-control": "no-store", "x-request-id": requestId },
  });
}
