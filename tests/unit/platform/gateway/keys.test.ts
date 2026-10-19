import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jwks from "@/app/.well-known/jwks.json/route";
import * as publicKeyRoute from "@/app/api/public-key/route";
import { DEFAULT_KEY_ID, keyId } from "@/platform/gateway/keys";
import { mintToken, tokenClaims } from "@/platform/gateway/token";
import { ConfigError } from "@/platform/secrets";
import { newSigningEnv, type SigningEnv, stubSigningEnv, UUID_V4, VISITOR } from "./keys-fixture";

/**
 * Ruling G(2): `BASTION_KEY_ID` is read through one helper — a byte-order mark and edge whitespace
 * (values pasted from a Windows shell) are stripped, the rest must be `[A-Za-z0-9._-]+`, and token
 * minting, the JWKS and `/api/public-key` all use it, so the three can never disagree.
 */

let keys: SigningEnv;

beforeEach(() => {
  keys = newSigningEnv();
  stubSigningEnv(keys);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const claims = () =>
  tokenClaims({
    service: "magpie",
    sub: VISITOR,
    role: "viewer",
    cap: "magpie.sources",
    nowS: Math.floor(Date.now() / 1000),
    jti: UUID_V4,
  });

describe("keyId", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["only whitespace", "  \t\n"],
    ["only a byte-order mark", "\uFEFF"],
  ])("defaults to bastion-ed25519-2026-04 when %s", (_label, value) => {
    vi.stubEnv("BASTION_KEY_ID", value);
    expect(keyId()).toBe(DEFAULT_KEY_ID);
    expect(DEFAULT_KEY_ID).toBe("bastion-ed25519-2026-04");
  });

  it.each([
    ["a byte-order mark", "\uFEFFbastion-ed25519-2026-10", "bastion-ed25519-2026-10"],
    ["surrounding whitespace", "  bastion-ed25519-2026-10\r\n", "bastion-ed25519-2026-10"],
    ["both", "\uFEFF bastion.key_1 \n", "bastion.key_1"],
  ])("strips %s", (_label, value, expected) => {
    vi.stubEnv("BASTION_KEY_ID", value);
    expect(keyId()).toBe(expected);
  });

  it.each([
    ["an inner space", "bastion key"],
    ["a slash", "bastion/key"],
    ["a quote", 'bastion"key'],
    ["a newline inside", "bastion\nkey"],
    ["a non-ASCII letter", "bastiön"],
    ["a zero-width space", "bastion\u200bkey"],
    ["a byte-order mark inside", "bastion\uFEFFkey"],
  ])("refuses %s with a ConfigError naming the variable, never the value", (_label, value) => {
    vi.stubEnv("BASTION_KEY_ID", value);
    const err = (() => {
      try {
        keyId();
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).variable).toBe("BASTION_KEY_ID");
    expect((err as ConfigError).message).not.toContain(value);
  });
});

describe("one key id everywhere", () => {
  const PASTED = "\uFEFF bastion-ed25519-2026-10 \r\n";

  it("mints the cleaned kid into the token header", async () => {
    vi.stubEnv("BASTION_KEY_ID", PASTED);
    const token = await mintToken(claims());
    expect(jose.decodeProtectedHeader(token).kid).toBe("bastion-ed25519-2026-10");
  });

  it("serves the cleaned kid in the JWKS", async () => {
    vi.stubEnv("BASTION_KEY_ID", PASTED);
    const body = await (await jwks.GET()).json();
    expect(body.keys[0].kid).toBe("bastion-ed25519-2026-10");
  });

  it("serves the cleaned kid from /api/public-key", async () => {
    vi.stubEnv("BASTION_KEY_ID", PASTED);
    const res = await publicKeyRoute.GET();
    expect(res.status).toBe(200);
    expect((await res.json()).kid).toBe("bastion-ed25519-2026-10");
  });

  it("refuses to mint under a malformed kid", async () => {
    vi.stubEnv("BASTION_KEY_ID", "bad kid");
    await expect(mintToken(claims())).rejects.toBeInstanceOf(ConfigError);
  });

  it("answers 503 from the JWKS under a malformed kid", async () => {
    vi.stubEnv("BASTION_KEY_ID", "bad kid");
    const res = await jwks.GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toStrictEqual({ error: "signing_key_unconfigured" });
  });

  it("answers 500 from /api/public-key under a malformed kid, naming no value", async () => {
    vi.stubEnv("BASTION_KEY_ID", "bad kid");
    const res = await publicKeyRoute.GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toStrictEqual({ error: "Key id not configured" });
    expect(JSON.stringify(body)).not.toContain("bad kid");
  });
});
