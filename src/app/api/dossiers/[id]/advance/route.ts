import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";
import {
  ADVANCE_HEADER,
  CHAIN_FROM_HEADER,
  type ChainTrace,
  chainAdvance,
  chainDelayMs,
  deferChain,
  handoffDeadline,
  INVOCATION_HEADER,
  isAdvanceToken,
} from "@/dossier/chain";
import { chainTracer, instanceFacts, newInvocationId, traceId } from "@/dossier/chain-trace";
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
 * runs (`deferChain`), and the hand-off holds its connection until the next invocation has answered
 * (on Vercel an invocation whose caller leaves early loses its after() work), up to this
 * invocation's own deadline. This route answers as soon as its stage is recorded, so its caller
 * waits for one stage, never for the rest of the chain.
 */

export const dynamic = "force-dynamic";
// One stage's 240 s budget, its recording, and the after() hand-off, which waits for the next
// invocation's answer until 15 s before this one's end (`handoffDeadline`).
export const maxDuration = 300;

const advanceLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Context): Promise<Response> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id } = await ctx.params;
  // The chain's trace (spec 21 §6.2): one id per invocation, in every line and in the answer.
  const invocation = newInvocationId();
  const trace: ChainTrace = { invocation, emit: chainTracer };
  const note = (
    event: Parameters<typeof chainTracer>[0]["event"],
    fields: Record<string, string | number | boolean | null>,
  ) => chainTracer({ event, dossierId: id, invocation, ...fields });
  const answered = (res: Response): Promise<Response> => {
    res.headers.set(INVOCATION_HEADER, invocation);
    return note("advance.answer", { status: res.status, totalMs: Date.now() - startedAt }).then(
      () => res,
    );
  };

  const chained = isAdvanceToken(id, req.headers.get(ADVANCE_HEADER));
  await note("advance.entry", {
    chained,
    from: traceId(req.headers.get(CHAIN_FROM_HEADER)),
    host: req.nextUrl.host,
    deployment: process.env.VERCEL_URL ?? null,
    vercelId: traceId(req.headers.get("x-vercel-id")),
    ...instanceFacts(),
  });
  if (!chained) {
    const limit = await advanceLimiter.check(`advance:${visitorFromRequest(req)}`);
    if (!limit.success) {
      await note("advance.refused", { reason: "rate_limited" });
      return answered(
        errorResponse(429, {
          error: "rate_limited",
          retryAfterS: limit.retryAfter ?? 60,
          requestId,
        }),
      );
    }
  }

  // Registered now, decided once the stage is recorded; the finally settles it on every path.
  // It waits for its successor's answer up to its own deadline, never for the rest of the chain.
  const deadline = handoffDeadline(startedAt, maxDuration);
  const decide = deferChain(
    req.nextUrl.origin,
    id,
    (task) => after(task),
    (origin, dossierId, delayMs) => chainAdvance(origin, dossierId, delayMs, deadline, { trace }),
  );
  let delayMs: number | null = null;
  let result: Awaited<ReturnType<typeof advance>>;
  try {
    result = await advance(id, HANDLERS, { onTrace: (event, fields) => note(event, fields) });
    delayMs = chainDelayMs(result, new Date());
    await note("chain.decision", {
      delayMs,
      ran: result.ran,
      stepStatus: result.status,
      dossierStatus: result.dossier,
      nextAt: result.nextAt?.toISOString() ?? null,
    });
  } catch (err) {
    if (err instanceof UnknownDossierError) {
      return answered(errorResponse(404, { error: "unknown_dossier", requestId }));
    }
    console.error("advance failed", { dossierId: id, requestId, err });
    return answered(errorResponse(500, { error: "advance_failed", requestId }));
  } finally {
    decide(delayMs);
  }

  return answered(
    Response.json(result, {
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    }),
  );
}
