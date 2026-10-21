import { generateKeyPairSync } from "node:crypto";
import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/.well-known/jwks.json/route";
import { mintToken, tokenClaims } from "@/platform/gateway/token";
import {
  newSigningEnv,
  type SigningEnv,
  stubSigningEnv,
  UUID_V4,
  VISITOR,
} from "../../platform/gateway/keys-fixture";

/** Spec 21 §7: bastion serves `/.well-known/jwks.json` — the OKP key backends can verify with. */

let keys: SigningEnv;

beforeEach(() => {
  keys = newSigningEnv();
  stubSigningEnv(keys, "bastion-ed25519-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /.well-known/jwks.json", () => {
  it("is never prerendered with a build-time key", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("serves exactly one OKP Ed25519 key with the configured kid", async () => {
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    const expectedX = (keys.publicKey.export({ format: "jwk" }) as { x: string }).x;
    expect(body).toStrictEqual({
      keys: [
        {
          kty: "OKP",
          crv: "Ed25519",
          x: expectedX,
          kid: "bastion-ed25519-test",
          alg: "EdDSA",
          use: "sig",
        },
      ],
    });
  });

  it("defaults the kid to bastion-ed25519-2026-04", async () => {
    stubSigningEnv(keys);
    const body = await (await route.GET()).json();
    expect(body.keys[0].kid).toBe("bastion-ed25519-2026-04");
  });

  it("verifies a token bastion mints (kid lookup through the key set)", async () => {
    const jwks = jose.createLocalJWKSet(await (await route.GET()).json());
    const nowS = Math.floor(Date.now() / 1000);
    const token = await mintToken(
      tokenClaims({
        service: "paper-trail",
        sub: VISITOR,
        role: "editor",
        cap: "paper-trail.debate",
        nowS,
        jti: UUID_V4,
      }),
    );
    const { payload, protectedHeader } = await jose.jwtVerify(token, jwks, {
      issuer: "bastion",
      audience: "paper-trail",
    });
    expect(protectedHeader.kid).toBe("bastion-ed25519-test");
    expect(payload.cap).toBe("paper-trail.debate");
  });

  it("is cacheable briefly by clients", async () => {
    const res = await route.GET();
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("answers 503 without leaking anything when the public key is unset", async () => {
    vi.stubEnv("BASTION_SIGNING_KEY_PUBLIC", "");
    const res = await route.GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({ error: "signing_key_unconfigured" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 for a valid SPKI key that is not Ed25519", async () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    vi.stubEnv(
      "BASTION_SIGNING_KEY_PUBLIC",
      publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    );
    const res = await route.GET();
    expect(res.status).toBe(503);
  });

  it("answers 503 when the public key is not an Ed25519 SPKI key", async () => {
    vi.stubEnv("BASTION_SIGNING_KEY_PUBLIC", Buffer.from("garbage").toString("base64"));
    const res = await route.GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({ error: "signing_key_unconfigured" });
  });
});
