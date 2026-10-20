import { randomUUID } from "node:crypto";
import { proveSoftDelete } from "@/features/tools/feathers/proof";
import { budgetsLeft, secondsUntilUtcMidnight } from "@/platform/budget";
import { errorResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { clientAddress, visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/platform/feathers-proof` (spec 21 §5.1, review fix 1): feathers' soft-delete proof —
 * create a user, delete that user, read it back (which must answer 404) — run here, as the visitor,
 * under one request id. The visitor names nothing: the proof makes up its own user, so it can never
 * delete someone else's. It spends 2 `feathers.write` units and refuses up front when fewer are
 * left; 3 a minute per visitor; JSON only, so a cross-site form cannot start it.
 */

export const dynamic = "force-dynamic";

const PROOF_UNITS = 2;
const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });

async function writesLeft(): Promise<number | null> {
  try {
    return (await budgetsLeft())["feathers.write"].left;
  } catch {
    // The gateway still enforces the budget on each call.
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return errorResponse(415, {
      error: "unsupported_media_type",
      detail: "send application/json",
      requestId,
    });
  }
  const actor = visitorFromRequest(req);
  const limit = await limiter.check(`feathers-proof:${actor}`);
  if (!limit.success) {
    return errorResponse(429, {
      error: "rate_limited",
      retryAfterS: limit.retryAfter ?? 60,
      requestId,
    });
  }
  const left = await writesLeft();
  if (left !== null && left < PROOF_UNITS) {
    return errorResponse(429, {
      error: "budget_exhausted",
      detail: `the proof needs ${PROOF_UNITS} feathers writes; ${left} left today`,
      retryAfterS: secondsUntilUtcMidnight(new Date()),
      requestId,
    });
  }
  const answer = await proveSoftDelete({ actor, requestId, clientIp: clientAddress(req) });
  return Response.json(answer, {
    headers: { "x-request-id": requestId, "cache-control": "no-store" },
  });
}
