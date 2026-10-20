import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/sha256";

/** The one SHA-256 the receipts use (spec 21 §6.3, §6.5): lower-case hex over UTF-8 bytes. */

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes a string as its UTF-8 bytes", () => {
    expect(sha256Hex("é")).toBe(sha256Hex(new Uint8Array([0xc3, 0xa9])));
    expect(sha256Hex("abc")).toBe(sha256Hex(new TextEncoder().encode("abc")));
    expect(sha256Hex("😀")).toBe(sha256Hex(new Uint8Array([0xf0, 0x9f, 0x98, 0x80])));
  });

  it("is 64 lower-case hex characters", () => {
    expect(sha256Hex("bastion")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a string with a lone surrogate (it has no UTF-8 encoding)", () => {
    expect(() => sha256Hex("a\ud800b")).toThrow(TypeError);
    expect(() => sha256Hex("\udc00")).toThrow(TypeError);
  });
});
