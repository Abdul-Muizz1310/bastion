import { randomUUID } from "node:crypto";
import { bundleFilename, receiptsBundle } from "@/dossier/bundle";
import { listDocuments } from "@/dossier/documents";
import { listEvidence } from "@/dossier/evidence";
import { listReceipts } from "@/dossier/receipts";
import { findDossier } from "@/dossier/store";
import { canonicalJson } from "@/platform/canonical-json";
import { errorResponse } from "@/platform/gateway/http";

/**
 * `GET /api/dossiers/[id]/receipts` (spec 21 §6.3, §6.5): the receipts bundle, a download named
 * `dossier-<id>.receipts.json`. Public: it holds the dossier's public fields, its evidence, its
 * documents and every receipt with its payload — what a stranger needs to re-check the dossier
 * without bastion — as canonical JSON. Never cached: a running dossier gains receipts.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Context): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  try {
    const dossier = await findDossier(id);
    if (dossier === null) return errorResponse(404, { error: "unknown_dossier", requestId });
    const [evidence, documents, receipts] = await Promise.all([
      listEvidence(dossier.id),
      listDocuments(dossier.id),
      listReceipts(dossier.id),
    ]);
    const body = canonicalJson(receiptsBundle({ dossier, evidence, documents, receipts }));
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
