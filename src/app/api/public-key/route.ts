import { NextResponse } from "next/server";
import { keyId } from "@/platform/gateway/keys";
import { ConfigError } from "@/platform/secrets";

/** bastion's public key as base64 SPKI, for readers older than `/.well-known/jwks.json`. */
export async function GET() {
  const publicKey = process.env.BASTION_SIGNING_KEY_PUBLIC;
  if (!publicKey) {
    return NextResponse.json({ error: "Public key not configured" }, { status: 500 });
  }

  let kid: string;
  try {
    kid = keyId();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`public-key: ${err.message}`);
    return NextResponse.json({ error: "Key id not configured" }, { status: 500 });
  }

  return NextResponse.json({ kid, algorithm: "EdDSA", publicKey });
}
