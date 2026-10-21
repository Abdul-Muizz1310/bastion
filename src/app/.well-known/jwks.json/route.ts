import { NextResponse } from "next/server";
import { publicJwk } from "@/platform/gateway/keys";
import { ConfigError } from "@/platform/secrets";

/**
 * `/.well-known/jwks.json` (spec 21 §7): the key backends can verify bastion's platform tokens
 * with, selected by the token's `kid`. Read per request so a rotation never serves a key baked in
 * at build time; `/api/public-key` keeps serving the same key as base64 SPKI for older readers.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(
      { keys: [publicJwk()] },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`jwks: ${err.message}`);
    return NextResponse.json(
      { error: "signing_key_unconfigured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
