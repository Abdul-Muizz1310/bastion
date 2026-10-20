import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { chainAdvance } from "@/dossier/chain";
import { createBodySchema, createDossier } from "@/dossier/create";
import { listPublicDossiers } from "@/dossier/gallery";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `/api/dossiers` (spec 21 §3). POST composes a dossier from a claim and evidence (web sources and
 * PDFs), answers 202 and starts the runner after the response. GET is the home gallery: the 12 most
 * recent dossiers, public fields only. Composing is limited to 3 an hour per visitor on top of the
 * daily `debate` budget it reserves.
 */

export const dynamic = "force-dynamic";

const GALLERY_SIZE = 12;
const composeLimiter = createRateLimiter({ max: 3, windowMs: 3_600_000 });

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return errorResponse(415, {
      error: "unsupported_media_type",
      detail: "send application/json",
      requestId,
    });
  }

  const visitor = visitorFromRequest(req);
  const limit = await composeLimiter.check(`compose:${visitor}`);
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
  const body = createBodySchema.safeParse(raw);
  if (!body.success) {
    const issue = body.error.issues[0];
    const where = issue?.path.join(".");
    return errorResponse(422, {
      error: "invalid_input",
      detail: `${where ? `${where}: ` : ""}${issue?.message ?? "invalid"}`.slice(0, 200),
      requestId,
    });
  }

  let result: Awaited<ReturnType<typeof createDossier>>;
  try {
    result = await createDossier(body.data, { visitor, requestId });
  } catch (err) {
    console.error("dossier create failed", { requestId, error: err });
    return errorResponse(500, { error: "create_failed", requestId });
  }
  if (!result.ok) {
    return errorResponse(result.status, {
      error: result.error,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      ...(result.retryAfterS === undefined ? {} : { retryAfterS: result.retryAfterS }),
      requestId,
    });
  }

  const origin = req.nextUrl.origin;
  const id = result.dossierId;
  after(() => chainAdvance(origin, id, 0));
  return Response.json(
    { dossier_id: id, request_id: requestId, url: `/d/${id}` },
    { status: 202, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export async function GET(): Promise<Response> {
  const dossiers = await listPublicDossiers(GALLERY_SIZE);
  return Response.json({ dossiers }, { headers: { "cache-control": "no-store" } });
}
