import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { findDossier } from "@/dossier/store";
import type { Check } from "@/dossier/verify";
import { verifyDossier } from "@/dossier/verify-live";
import { appendEvent } from "@/platform/audit/write";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { clientAddress, visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/dossiers/[id]/verify` (spec 21 §6.5, "verify everything"): anyone re-checks every
 * receipt of a dossier live — the certificates with inkprint, the transcript and its signature with
 * paper-trail, the envelope signature, the perf receipt and audit digest from bastion's log, the
 * documents' graph hashes with inkthread — and gets each check as pass, fail, unavailable or
 * expired with the reason. Every capability it calls is free, so there is no budget; the calls go
 * through the gateway as the visitor, under this request's own id (never the dossier's, whose
 * slice of the log the audit digests cover). The result is not stored: one `dossier.verified`
 * audit event records who verified and each check's state. Limited to 10 a minute per visitor.
 */

export const dynamic = "force-dynamic";
// Each issuer gets one bounded call (30 s by default), all in parallel.
export const maxDuration = 120;

const verifyLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });

type Context = { params: Promise<{ id: string }> };

const states = (checks: readonly Check[]) =>
  Object.fromEntries(checks.map((c) => [c.name, c.state]));

export async function POST(req: NextRequest, ctx: Context): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const visitor = visitorFromRequest(req);

  const limit = await verifyLimiter.check(`verify:${visitor}`);
  if (!limit.success) {
    return errorResponse(429, {
      error: "rate_limited",
      retryAfterS: limit.retryAfter ?? 60,
      requestId,
    });
  }

  const dossier = await findDossier(id);
  if (dossier === null) return errorResponse(404, { error: "unknown_dossier", requestId });

  let checks: Check[];
  try {
    checks = await verifyDossier(
      { id: dossier.id, requestId: dossier.requestId },
      { actor: visitor, requestId, clientIp: clientAddress(req) },
    );
  } catch (err) {
    console.error("verify failed", { dossierId: dossier.id, requestId, err });
    return errorResponse(500, { error: "verify_failed", requestId });
  }

  await appendEvent({
    actor: visitor,
    action: "dossier.verified",
    entityType: "dossier",
    entityId: dossier.id,
    service: "bastion",
    requestId,
    metadata: { checks: states(checks) },
  });
  return Response.json(
    { dossierId: dossier.id, checks },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
