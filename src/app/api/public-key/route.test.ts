import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/public-key", () => {
  const origPublicKey = process.env.BASTION_SIGNING_KEY_PUBLIC;
  const origKeyId = process.env.BASTION_KEY_ID;

  afterEach(() => {
    if (origPublicKey !== undefined) {
      process.env.BASTION_SIGNING_KEY_PUBLIC = origPublicKey;
    } else {
      delete process.env.BASTION_SIGNING_KEY_PUBLIC;
    }
    if (origKeyId !== undefined) {
      process.env.BASTION_KEY_ID = origKeyId;
    } else {
      delete process.env.BASTION_KEY_ID;
    }
  });

  it("returns 500 when public key is not configured", async () => {
    delete process.env.BASTION_SIGNING_KEY_PUBLIC;
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Public key not configured");
  });

  it("returns public key info when configured", async () => {
    process.env.BASTION_SIGNING_KEY_PUBLIC = "test-public-key-base64";
    process.env.BASTION_KEY_ID = "test-kid";
    const response = await GET();
    const body = await response.json();
    expect(body.publicKey).toBe("test-public-key-base64");
    expect(body.kid).toBe("test-kid");
    expect(body.algorithm).toBe("EdDSA");
  });

  it("uses default key ID when BASTION_KEY_ID is not set", async () => {
    process.env.BASTION_SIGNING_KEY_PUBLIC = "test-public-key";
    delete process.env.BASTION_KEY_ID;
    const response = await GET();
    const body = await response.json();
    expect(body.kid).toBe("bastion-ed25519-2026-04");
  });
});
