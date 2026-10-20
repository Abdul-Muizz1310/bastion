import "server-only";
import { headers as requestHeaders } from "next/headers";
import { createRateLimiter, type RateLimitResult } from "@/platform/ratelimit";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * Ruling AL: the open log's reads are limited per visitor — 60 a minute — keyed on the visitor's
 * daily pseudonym. `audit` covers `/audit` and `/audit/[requestId]`; `replay` covers the
 * time-travel page and its Server Action, so dragging the slider never starves the log. Like the
 * other read limits it fails open when Upstash is not configured; each read stays bounded by its
 * own page limit either way.
 */

export const READS_PER_MINUTE = 60;

export type ReadBucket = "audit" | "replay";

export type ReadAllowance = { ok: true } | { ok: false; retryAfterS: number; limit: number };

export type ReadLimitDeps = {
  headers: () => Promise<Headers>;
  check: (key: string) => Promise<RateLimitResult>;
};

const limiter = createRateLimiter({ max: READS_PER_MINUTE, windowMs: 60_000 });

const DEFAULT_DEPS: ReadLimitDeps = {
  headers: requestHeaders,
  check: (key) => limiter.check(key),
};

export async function allowRead(
  bucket: ReadBucket,
  deps: ReadLimitDeps = DEFAULT_DEPS,
): Promise<ReadAllowance> {
  const visitor = visitorFromRequest({ headers: await deps.headers() });
  const result = await deps.check(`${bucket}-read:${visitor}`);
  if (result.success) return { ok: true };
  return { ok: false, retryAfterS: result.retryAfter ?? 60, limit: READS_PER_MINUTE };
}
