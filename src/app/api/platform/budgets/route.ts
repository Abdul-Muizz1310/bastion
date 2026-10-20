import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { budgetsLeft } from "@/platform/budget";
import { createRateLimiter } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `GET /api/platform/budgets` (spec 21 §5.1): what is left today of every daily budget, `{<key>:
 * {limit, left}}`, for the workbenches' meters and the platform page. Never cached; 60 a minute per
 * visitor. An unreachable budget store is a 503, never a guessed number.
 */

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ max: 60, windowMs: 60_000 });
const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request): Promise<NextResponse> {
  const limit = await limiter.check(`budgets:${visitorFromRequest(req)}`);
  if (!limit.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfter ?? 60) } },
    );
  }
  try {
    return NextResponse.json(await budgetsLeft(), { headers: NO_STORE });
  } catch (err) {
    console.error(`budgets: cannot read today's budgets (${randomUUID()})`, err);
    return NextResponse.json({ error: "budgets_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
