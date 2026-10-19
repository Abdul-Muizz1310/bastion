import { generateKeyPairSync } from "node:crypto";
import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintToken, TOKEN_TTL_S, tokenClaims } from "@/platform/gateway/token";
import type { ServiceId } from "@/platform/registry/products";
import { ConfigError } from "@/platform/secrets";
import type { VisitorId } from "@/platform/visitor";
import { newSigningEnv, type SigningEnv, stubSigningEnv, UUID_V4, VISITOR } from "./keys-fixture";

/**
 * Platform token contract v2 (docs/specs/22-platform-contract-v2.md §1, §4): bastion mints exactly
 * these claims, `aud == service`, `exp = iat + 60`, signed EdDSA with the configured `kid`.
 */

const NOW_S = 1_792_454_400; // 2026-10-20T00:00:00Z
const base = {
  service: "inkprint" as ServiceId,
  sub: VISITOR,
  role: "editor" as const,
  cap: "inkprint.certify",
  nowS: NOW_S,
  jti: UUID_V4,
};

let keys: SigningEnv;

beforeEach(() => {
  keys = newSigningEnv();
  stubSigningEnv(keys);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tokenClaims", () => {
  it("carries exactly the contract-v2 fields, with aud equal to the service", () => {
    expect(tokenClaims(base)).toStrictEqual({
      iss: "bastion",
      aud: "inkprint",
      service: "inkprint",
      sub: VISITOR,
      role: "editor",
      cap: "inkprint.certify",
      iat: NOW_S,
      exp: NOW_S + 60,
      jti: UUID_V4,
    });
  });

  it("lives exactly 60 s", () => {
    expect(TOKEN_TTL_S).toBe(60);
    const claims = tokenClaims({ ...base, nowS: 5 });
    expect(claims.exp - claims.iat).toBe(60);
  });

  it("accepts the system actor bastion as sub", () => {
    expect(tokenClaims({ ...base, sub: "bastion" }).sub).toBe("bastion");
  });

  it.each(["viewer", "editor", "admin"] as const)("accepts the %s grant", (role) => {
    expect(tokenClaims({ ...base, role }).role).toBe(role);
  });

  it.each([
    ["a fractional time", { nowS: 1.5 }],
    ["a negative time", { nowS: -1 }],
    ["NaN", { nowS: Number.NaN }],
    ["a millisecond timestamp mistaken for seconds", { nowS: NOW_S * 1000 }],
    ["a non-uuid jti", { jti: "not-a-uuid" }],
    ["a uuid that is not v4", { jti: "1b4e28ba-2fa1-1d2b-883f-0016d3cca427" }],
    ["an empty capability", { cap: "" }],
    ["an unknown service", { service: "evil" as ServiceId }],
    ["a sub that is neither a visitor nor bastion", { sub: "alice" as VisitorId }],
    ["an unknown grant", { role: "frontend" as "viewer" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => tokenClaims({ ...base, ...patch })).toThrow();
  });
});

describe("mintToken", () => {
  it("signs EdDSA with the configured kid in the protected header", async () => {
    stubSigningEnv(keys, "bastion-ed25519-test");
    const token = await mintToken(tokenClaims(base));
    expect(jose.decodeProtectedHeader(token)).toStrictEqual({
      alg: "EdDSA",
      kid: "bastion-ed25519-test",
    });
  });

  it("defaults kid to bastion-ed25519-2026-04", async () => {
    const token = await mintToken(tokenClaims(base));
    expect(jose.decodeProtectedHeader(token).kid).toBe("bastion-ed25519-2026-04");
  });

  it("verifies against the public key with issuer bastion and audience = the service", async () => {
    const claims = tokenClaims(base);
    const token = await mintToken(claims);
    const { payload } = await jose.jwtVerify(token, keys.publicKey, {
      issuer: "bastion",
      audience: "inkprint",
      algorithms: ["EdDSA"],
      currentDate: new Date((NOW_S + 1) * 1000),
    });
    expect(payload).toStrictEqual(claims);
  });

  it("does not verify for another service's audience", async () => {
    const token = await mintToken(tokenClaims(base));
    await expect(
      jose.jwtVerify(token, keys.publicKey, {
        issuer: "bastion",
        audience: "magpie",
        currentDate: new Date((NOW_S + 1) * 1000),
      }),
    ).rejects.toThrow(/aud/);
  });

  it("does not verify under a different key", async () => {
    const token = await mintToken(tokenClaims(base));
    const other = newSigningEnv();
    await expect(
      jose.jwtVerify(token, other.publicKey, { currentDate: new Date((NOW_S + 1) * 1000) }),
    ).rejects.toThrow();
  });

  it("re-reads a rotated private key instead of signing with a cached one", async () => {
    await mintToken(tokenClaims(base));
    const rotated = newSigningEnv();
    stubSigningEnv(rotated);
    const token = await mintToken(tokenClaims(base));
    await expect(
      jose.jwtVerify(token, rotated.publicKey, { currentDate: new Date((NOW_S + 1) * 1000) }),
    ).resolves.toBeTruthy();
  });

  it.each([
    ["a lifetime other than 60 s", { exp: NOW_S + 300 }],
    ["aud differing from service", { aud: "magpie" }],
    ["an extra claim", { admin: true }],
    ["another issuer", { iss: "magpie-frontend" }],
  ])("refuses claims with %s", async (_label, patch) => {
    const claims = { ...tokenClaims(base), ...patch } as ReturnType<typeof tokenClaims>;
    await expect(mintToken(claims)).rejects.toThrow();
  });

  it("fails with a ConfigError naming the variable when the private key is unset", async () => {
    vi.stubEnv("BASTION_SIGNING_KEY_PRIVATE", "");
    const err = await mintToken(tokenClaims(base)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).variable).toBe("BASTION_SIGNING_KEY_PRIVATE");
  });

  it("fails with a ConfigError when the private key is not an Ed25519 PKCS#8 key", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    vi.stubEnv(
      "BASTION_SIGNING_KEY_PRIVATE",
      privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    );
    const err = await mintToken(tokenClaims(base)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(String(err)).not.toContain(keys.privateB64);
  });
});
