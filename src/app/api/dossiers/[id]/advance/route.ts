import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  type ChainEventName,
  chainTracer,
  INVOCATION_HEADER,
  instanceFacts,
  newInvocationId,
  type TraceValue,
  traceId,
} from "@/dossier/chain-trace";
import type { DriveResult } from "@/dossier/drive";
import { driveDossier } from "@/dossier/drive-dossier";
import { type AdvanceResult, UnknownDossierError } from "@/dossier/runner";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/dossiers/[id]/advance` (spec 21 §6.2, §6.6, Ruling AM): the visitor's page drives the
 * dossier **in the foreground** — the request runs stage after stage while its 300 s last
 * (`driveDossier`: each round claims one stage, with the runner's claim, lease and fencing
 * unchanged) — and answers the last round's result with the stages it ran and why it stopped.
 * Idempotent: a concurrent caller finds nothing to claim. Visitors are limited to 60 a minute.
 *
 * Nothing is handed to `after()`: on Vercel an invocation kept alive only by after() did not
 * survive a long stage, and a dying one holds its stage's lease from everyone else. The two drivers
 * are real clients — this route, called by the page's nudge, and the token-gated sweep.
 */

export const dynamic = "force-dynamic";
// The foreground loop's whole budget: rounds start while 120 s remain, then the answer.
export const maxDuration = 300;

const advanceLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });

type Context = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Context): Promise<Response> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id } = await ctx.params;
  // The trace (spec 21 §6.2): one id per invocation, in every line and in the answer.
  const invocation = newInvocationId();
  const note = (event: ChainEventName, fields: Record<string, TraceValue>) =>
    chainTracer({ event, dossierId: id, invocation, ...fields });
  const answered = async (res: Response): Promise<Response> => {
    res.headers.set(INVOCATION_HEADER, invocation);
    await note("advance.answer", { status: res.status, totalMs: Date.now() - startedAt });
    return res;
  };

  await note("advance.entry", {
    host: req.nextUrl.host,
    deployment: process.env.VERCEL_URL ?? null,
    vercelId: traceId(req.headers.get("x-vercel-id")),
    ...instanceFacts(),
  });
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

  let driven: DriveResult;
  let result: AdvanceResult;
  try {
    driven = await driveDossier(id, {
      driver: "visitor",
      deadlineMs: startedAt + maxDuration * 1000,
      invocation,
      emit: chainTracer,
    });
    if (driven.last === null) throw new Error("the foreground loop ran no round");
    result = driven.last;
  } catch (err) {
    if (err instanceof UnknownDossierError) {
      return answered(errorResponse(404, { error: "unknown_dossier", requestId }));
    }
    console.error("advance failed", { dossierId: id, requestId, err });
    return answered(errorResponse(500, { error: "advance_failed", requestId }));
  }

  return answered(
    Response.json(
      { ...result, stages: driven.stages, stopped: driven.stopped },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    ),
  );
}
