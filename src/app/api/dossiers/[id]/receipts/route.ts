import { randomUUID } from "node:crypto";
import { bundleAuditBound, bundleFilename, receiptsBundle } from "@/dossier/bundle";
import { listDocuments } from "@/dossier/documents";
import { listEvidence } from "@/dossier/evidence";
import { listReceipts } from "@/dossier/receipts";
import { findDossier } from "@/dossier/store";
import { requestEvents } from "@/platform/audit/request-events";
import { canonicalJson } from "@/platform/canonical-json";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `GET /api/dossiers/[id]/receipts` (spec 21 §6.3, §6.5): the receipts bundle, a download named
 * `dossier-<id>.receipts.json`. Public: it holds the dossier's public fields, its evidence, its
 * documents, every receipt with its payload and the audit events its digests cover (up to the
 * highest bound a receipt carries) — what a stranger needs to re-check the dossier without
 * bastion — as canonical JSON. Never cached: a running dossier gains receipts. Ruling W: limited
 * to 30 a minute per visitor, since each download reads every receipt with its payload.
 */

export const dynamic = "force-dynamic";

const receiptsLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Context): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const limit = await receiptsLimiter.check(`receipts:${visitorFromRequest(req)}`);
  if (!limit.success) {
    return errorResponse(429, {
      error: "rate_limited",
      retryAfterS: limit.retryAfter ?? 60,
      requestId,
    });
  }
  try {
    const dossier = await findDossier(id);
    if (dossier === null) return errorResponse(404, { error: "unknown_dossier", requestId });
    const [evidence, documents, receipts] = await Promise.all([
      listEvidence(dossier.id),
      listDocuments(dossier.id),
      listReceipts(dossier.id),
    ]);
    const bound = bundleAuditBound(receipts);
    const auditEvents = bound === null ? [] : await requestEvents(dossier.requestId, bound);
    const body = canonicalJson(
      receiptsBundle({ dossier, evidence, documents, receipts, auditEvents }),
    );
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${bundleFilename(dossier.id)}"`,
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    console.error("receipts bundle failed", { dossierId: id, requestId, err });
    return errorResponse(500, { error: "receipts_failed", requestId });
  }
}
