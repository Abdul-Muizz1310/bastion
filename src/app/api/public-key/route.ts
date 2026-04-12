import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = process.env.BASTION_SIGNING_KEY_PUBLIC;
  if (!publicKey) {
    return NextResponse.json({ error: "Public key not configured" }, { status: 500 });
  }

  return NextResponse.json({
    kid: process.env.BASTION_KEY_ID ?? "bastion-ed25519-2026-04",
    algorithm: "EdDSA",
    publicKey,
  });
}
