import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { probe } from "@/platform/registry/health";
import { isServiceId } from "@/platform/registry/products";
import { visitorFromRequest } from "@/platform/visitor";

export const dynamic = "force-dynamic";
export const maxDuration = 100;

const WAKE_TIMEOUT_MS = 90_000;
const wakeLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ service: string }> },
): Promise<NextResponse> {
  const { service } = await ctx.params;
  if (!isServiceId(service)) {
    return NextResponse.json({ error: "unknown_service" }, { status: 404 });
  }
  const limit = await wakeLimiter.check(`wake:${visitorFromRequest(req)}`);
  if (!limit.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(limit.retryAfter ?? 60) } },
    );
  }
  const health = await probe(service, WAKE_TIMEOUT_MS);
  return NextResponse.json(health, { headers: { "cache-control": "no-store" } });
}
