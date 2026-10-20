import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { findDossier, loadSteps } from "@/dossier/store";
import type { Check } from "@/dossier/verify";
import { verifyDossier } from "@/dossier/verify-live";
import { SYSTEM_ACTOR } from "@/platform/audit/event";
import { appendEvent } from "@/platform/audit/write";
import type { CallContext } from "@/platform/gateway/call";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { clientAddress, visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/dossiers/[id]/verify` (spec 21 §6.5, "verify everything"): anyone re-checks every
 * receipt of a dossier live — the certificates with inkprint, the transcript and its signature with
 * paper-trail, the envelope signature, the perf receipt and audit digest from bastion's log, the
 * documents' graph hashes with inkthread — and gets each check as pass, fail, unavailable or
 * expired with the reason. Every capability it calls is free, so there is no budget. Ruling W: the
 * calls go through the gateway as the system actor — verification is bastion re-checking its own
 * receipts, so the per-visitor gateway limit does not apply; this route's own limit (5 a minute per
 * visitor) bounds it — under this run's own request id, never the dossier's (verification is not
 * part of the dossier's trace; its slice of the log is what the audit digests cover). The visitor's
 * address is still forwarded. The result is not stored: one `dossier.verified` audit event, as the
 * visitor, records who verified and each check's state.
 *
 * Ruling Z: a dossier with no `dossier_steps` rows predates the v2 runner and its receipts, so no
 * implied-receipt rule applies to it: it answers `legacy: true` with no checks and says so.
 */

export const dynamic = "force-dynamic";
// Each issuer gets one bounded call (30 s by default), all in parallel.
export const maxDuration = 120;

const LEGACY_NOTE = "this dossier predates verifiable receipts";

const verifyLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });

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

  let legacy: boolean;
  let checks: Check[];
  try {
    const steps = await loadSteps(dossier.id);
    legacy = steps.length === 0;
    // The whole row (the checks bind what the page shows to what they verify) and the step rows
    // (a failed dossier is judged by its envelope step, Ruling AB).
    const call: CallContext = { actor: SYSTEM_ACTOR, requestId, clientIp: clientAddress(req) };
    checks = legacy ? [] : await verifyDossier(dossier, call, steps);
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
    metadata: legacy ? { legacy: true, checks: {} } : { checks: states(checks) },
  });
  return Response.json(
    legacy
      ? { dossierId: dossier.id, legacy: true, note: LEGACY_NOTE, checks: [] }
      : { dossierId: dossier.id, legacy: false, checks },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
