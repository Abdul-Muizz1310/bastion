import { createPublicKey } from "node:crypto";
import * as jose from "jose";
import { ConfigError } from "@/platform/secrets";

/**
 * bastion's Ed25519 signing key material (contract v2 §1, §4). The private half is
 * `BASTION_SIGNING_KEY_PRIVATE` (PKCS#8 DER, base64), the public half `BASTION_SIGNING_KEY_PUBLIC`
 * (SPKI DER, base64), the key id `BASTION_KEY_ID`. All three are read per call, so a rotation takes
 * effect without a restart; the imported private key is cached per env value.
 */

export const DEFAULT_KEY_ID = "bastion-ed25519-2026-04";

const PRIVATE_VARIABLE = "BASTION_SIGNING_KEY_PRIVATE";
const PUBLIC_VARIABLE = "BASTION_SIGNING_KEY_PUBLIC";

export type PublicJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
};

export function keyId(): string {
  const kid = process.env.BASTION_KEY_ID;
  return kid === undefined || kid === "" ? DEFAULT_KEY_ID : kid;
}

function readKey(variable: string): Buffer {
  const value = process.env[variable];
  if (value === undefined || value === "") throw new ConfigError(variable, "is not set");
  return Buffer.from(value, "base64");
}

let cached: { source: string; key: CryptoKey } | null = null;

export async function signingKey(): Promise<CryptoKey> {
  const der = readKey(PRIVATE_VARIABLE);
  const source = der.toString("base64");
  if (cached?.source === source) return cached.key;
  let key: CryptoKey;
  try {
    key = await jose.importPKCS8(
      `-----BEGIN PRIVATE KEY-----\n${source}\n-----END PRIVATE KEY-----`,
      "EdDSA",
    );
  } catch {
    // Never echo the key material: name the variable and what it should be.
    throw new ConfigError(PRIVATE_VARIABLE, "is not an Ed25519 PKCS#8 key (DER, base64)");
  }
  cached = { source, key };
  return key;
}

/** The public half as the one JWK in `/.well-known/jwks.json`. */
export function publicJwk(): PublicJwk {
  const der = readKey(PUBLIC_VARIABLE);
  let jwk: { kty?: string; crv?: string; x?: string };
  try {
    jwk = createPublicKey({ key: der, format: "der", type: "spki" }).export({ format: "jwk" });
  } catch {
    throw new ConfigError(PUBLIC_VARIABLE, "is not an SPKI public key (DER, base64)");
  }
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new ConfigError(PUBLIC_VARIABLE, "is not an Ed25519 public key");
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x, kid: keyId(), alg: "EdDSA", use: "sig" };
}
