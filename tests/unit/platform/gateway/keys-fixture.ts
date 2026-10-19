import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { vi } from "vitest";
import type { VisitorId } from "@/platform/visitor";

/** A fresh Ed25519 pair in the env formats bastion reads (PKCS#8 / SPKI DER, base64). */
export type SigningEnv = {
  privateB64: string;
  publicB64: string;
  publicKey: KeyObject;
};

export function newSigningEnv(): SigningEnv {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    publicKey,
  };
}

export function stubSigningEnv(env: SigningEnv, kid?: string): void {
  vi.stubEnv("BASTION_SIGNING_KEY_PRIVATE", env.privateB64);
  vi.stubEnv("BASTION_SIGNING_KEY_PUBLIC", env.publicB64);
  vi.stubEnv("BASTION_KEY_ID", kid);
}

export const VISITOR = "v_abcdefghij" as VisitorId;
export const UUID_V4 = "1b4e28ba-2fa1-4d2b-883f-0016d3cca427";
