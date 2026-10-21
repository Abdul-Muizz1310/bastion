import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { capabilityById } from "@/capabilities";
import { keyId } from "@/platform/gateway/keys";
import { tokenClaims } from "@/platform/gateway/token";
import { createRateLimiter } from "@/platform/ratelimit";
import { ConfigError } from "@/platform/secrets";
import { visitorFromRequest } from "@/platform/visitor";

/**
 * `GET /api/platform/token-preview?capability=<id>` (spec 21 §5, §5.1 invariant 8): the header and
 * claims bastion would mint for one capability call by this visitor — decoded, never signed — and
 * where the key that would verify them is published. Nothing here can be replayed: there is no
 * signature, and `exp` is a minute after `iat`. 60 a minute per visitor; never cached.
 */

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ max: 60, windowMs: 60_000 });
const NO_STORE = { "cache-control": "no-store" };
export const JWKS_PATH = "/.well-known/jwks.json";

function refuse(status: number, error: string, detail?: string): NextResponse {
  return NextResponse.json(detail === undefined ? { error } : { error, detail }, {
    status,
    headers: NO_STORE,
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  const visitor = visitorFromRequest(req);
  const limit = await limiter.check(`token-preview:${visitor}`);
  if (!limit.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(limit.retryAfter ?? 60) } },
    );
  }

  const values = new URL(req.url).searchParams.getAll("capability");
  if (values.length !== 1 || values[0] === "") {
    return refuse(422, "invalid_input", "capability: name exactly one capability id");
  }
  const id = values[0] ?? "";
  const cap = capabilityById(id);
  if (cap === undefined) return refuse(404, "unknown_capability");

  let kid: string;
  try {
    kid = keyId();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`token-preview: ${err.message}`);
    return refuse(503, "signing_key_unconfigured");
  }

  const claims = tokenClaims({
    service: cap.service,
    sub: visitor,
    role: cap.grant,
    cap: cap.id,
    nowS: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  });
  return NextResponse.json(
    {
      header: { alg: "EdDSA", kid },
      claims,
      jwks: JWKS_PATH,
      capability: {
        id: cap.id,
        service: cap.service,
        grant: cap.grant,
        cost: cap.cost,
        budget: cap.budget ?? null,
        routed: cap.routeTo !== undefined,
      },
    },
    { headers: NO_STORE },
  );
}
