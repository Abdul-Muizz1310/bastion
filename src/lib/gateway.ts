import crypto from "node:crypto";
import * as jose from "jose";
import { SERVICES } from "./services";

const KEY_ID = process.env.BASTION_KEY_ID ?? "bastion-ed25519-2026-04";

let _privateKey: CryptoKey | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  if (!_privateKey) {
    const keyB64 = process.env.BASTION_SIGNING_KEY_PRIVATE;
    if (!keyB64) {
      throw new Error("BASTION_SIGNING_KEY_PRIVATE is not set");
    }
    const keyDer = Buffer.from(keyB64, "base64");
    _privateKey = await jose.importPKCS8(
      `-----BEGIN PRIVATE KEY-----\n${keyDer.toString("base64")}\n-----END PRIVATE KEY-----`,
      "EdDSA",
    );
  }
  return _privateKey;
}

export type JwtClaims = {
  sub: string;
  role: string;
  service: string;
};

export async function mintPlatformJwt(claims: JwtClaims): Promise<string> {
  const key = await getPrivateKey();
  const jwt = await new jose.SignJWT({
    role: claims.role,
    service: claims.service,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: KEY_ID })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(crypto.randomUUID())
    .sign(key);

  return jwt;
}

export function resolveService(serviceId: string) {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    throw new Error(`Unknown service: ${serviceId}`);
  }
  if (!service.backendUrl) {
    throw new Error(`No backend URL for service: ${serviceId}`);
  }
  return service;
}

export function parseRequestId(existing: string | undefined | null): string {
  if (existing) return existing;
  return crypto.randomUUID();
}
