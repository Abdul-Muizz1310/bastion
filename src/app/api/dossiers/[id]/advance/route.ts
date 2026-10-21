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
import type { DriveResult } from "@/dossier/drive";
import { driveDossier } from "@/dossier/drive-dossier";
import { type AdvanceResult, UnknownDossierError } from "@/dossier/runner";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/dossiers/[id]/advance` (spec 21 §6.2): drives the dossier **in the foreground** — the
 * request runs stage after stage while its 300 s last (`driveDossier`: each round claims one stage,
 * with the runner's claim, lease and fencing unchanged) — and answers the last round's result with
 * the stages it ran and why it stopped. Idempotent: a concurrent caller finds nothing to claim.
 * Anyone may nudge a dossier (the page does, while it is open); visitors are limited to 60 a minute,
 * while the runner's own chained calls carry the internal HMAC header. The sweep drives due
 * dossiers the same way.
 *
 * Chaining, best effort: when the loop stops with the next stage due within 10 s, `after()` sleeps
 * until it is due and POSTs this route again — see `@/dossier/chain`. On Vercel an invocation kept
 * alive only by after() did not survive a long stage, so nothing relies on the chain: the page's
 * nudge and the sweep are real clients, and their requests always complete.
 */

export const dynamic = "force-dynamic";
// The foreground loop's whole budget: stages run until 20 s before this, then the answer.
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
  let driven: DriveResult;
  let result: AdvanceResult;
  try {
    driven = await driveDossier(id, {
      driver: chained ? "chain" : "visitor",
      deadlineMs: startedAt + maxDuration * 1000,
      invocation,
      emit: chainTracer,
    });
    if (driven.last === null) throw new Error("the foreground loop ran no round");
    result = driven.last;
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
    Response.json(
      { ...result, stages: driven.stages, stopped: driven.stopped },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    ),
  );
}
