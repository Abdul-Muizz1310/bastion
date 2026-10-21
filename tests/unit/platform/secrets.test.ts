import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, deriveKey } from "@/platform/secrets";

/**
 * Spec 21 §4 / plan Task 1 — keys are derived, never added: one secret already on Vercel
 * (IRON_SESSION_PASSWORD) is the HKDF-SHA256 input keying material, and each purpose gets its
 * own key through a distinct `info` string.
 */

const SECRET = `${"s".repeat(24)}-32-char`; // exactly 32 characters
const OTHER_SECRET = "o".repeat(40);

/** An independent oracle: WebCrypto's HKDF, not the node:crypto call the module uses. */
async function webCryptoHkdf(secret: string, info: string): Promise<Uint8Array> {
  const ikm = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deriveKey — the derivation", () => {
  it("returns 32 bytes", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const key = deriveKey("bastion/visitor/v1");
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.byteLength).toBe(32);
  });

  it("is HKDF-SHA256 with an empty salt and the info string", async () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const expected = await webCryptoHkdf(SECRET, "bastion/visitor/v1");
    expect(Buffer.from(deriveKey("bastion/visitor/v1")).toString("hex")).toBe(
      Buffer.from(expected).toString("hex"),
    );
  });

  it("is deterministic for the same secret and info", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    expect(deriveKey("bastion/visitor/v1")).toEqual(deriveKey("bastion/visitor/v1"));
  });

  it("separates purposes: a different info gives a different key", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    expect(deriveKey("bastion/visitor/v1")).not.toEqual(deriveKey("bastion/other/v1"));
  });

  it("a different secret gives a different key", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const first = deriveKey("bastion/visitor/v1");
    vi.stubEnv("IRON_SESSION_PASSWORD", OTHER_SECRET);
    expect(deriveKey("bastion/visitor/v1")).not.toEqual(first);
  });

  it("accepts a secret of exactly 32 characters", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    expect(SECRET).toHaveLength(32);
    expect(() => deriveKey("bastion/visitor/v1")).not.toThrow();
  });
});

describe("deriveKey — what must not happen", () => {
  it("rejects a 31-character secret with a ConfigError naming the variable", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET.slice(1));
    expect(() => deriveKey("bastion/visitor/v1")).toThrow(ConfigError);
    expect(() => deriveKey("bastion/visitor/v1")).toThrow(/IRON_SESSION_PASSWORD/);
  });

  it("rejects a missing secret with a ConfigError naming the variable", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", undefined);
    let caught: unknown;
    try {
      deriveKey("bastion/visitor/v1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).variable).toBe("IRON_SESSION_PASSWORD");
    expect((caught as ConfigError).message).toMatch(/IRON_SESSION_PASSWORD/);
  });

  it("rejects an empty secret", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", "");
    expect(() => deriveKey("bastion/visitor/v1")).toThrow(ConfigError);
  });

  it("never echoes the secret in the error", () => {
    const short = "short-but-secret-value";
    vi.stubEnv("IRON_SESSION_PASSWORD", short);
    expect(() => deriveKey("bastion/visitor/v1")).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(short) }),
    );
  });

  it("rejects an empty info string — every key needs its own purpose label", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    expect(() => deriveKey("")).toThrow(/info/);
  });
});
