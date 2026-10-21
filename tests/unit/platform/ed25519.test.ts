import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyEd25519 } from "@/platform/ed25519";

/**
 * Ed25519 verification of an issuer's signature (spec 21 §6.5): a base64 signature over a
 * message's UTF-8 bytes, checked against the issuer's PEM public key. It answers a boolean and
 * never throws: a malformed key or signature is simply not a valid signature.
 */

const pair = () => generateKeyPairSync("ed25519");
const { publicKey, privateKey } = pair();
const PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const MESSAGE = '{"claim":"café","confidence":1.0}';
const SIG = sign(null, Buffer.from(MESSAGE, "utf8"), privateKey).toString("base64");

describe("verifyEd25519", () => {
  it("accepts the signature over the message's UTF-8 bytes", () => {
    expect(verifyEd25519({ publicKeyPem: PEM, message: MESSAGE, signature: SIG })).toBe(true);
  });

  it("accepts bytes as the message", () => {
    const message = new TextEncoder().encode(MESSAGE);
    expect(verifyEd25519({ publicKeyPem: PEM, message, signature: SIG })).toBe(true);
  });

  it("refuses a tampered message", () => {
    const message = MESSAGE.replace("1.0", "1");
    expect(verifyEd25519({ publicKeyPem: PEM, message, signature: SIG })).toBe(false);
  });

  it("refuses another key", () => {
    const other = pair().publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyEd25519({ publicKeyPem: other, message: MESSAGE, signature: SIG })).toBe(false);
  });

  it.each([
    ["a flipped bit", `${SIG.slice(0, 10)}${SIG[10] === "A" ? "B" : "A"}${SIG.slice(11)}`],
    ["a truncated signature", SIG.slice(0, 40)],
    ["characters outside base64", `${SIG.slice(0, -3)}*==`],
    ["an unpadded signature", SIG.replace(/=+$/, "")],
    ["whitespace", ` ${SIG}`],
    ["an empty string", ""],
  ])("refuses %s", (_name, signature) => {
    expect(verifyEd25519({ publicKeyPem: PEM, message: MESSAGE, signature })).toBe(false);
  });

  it.each([
    ["garbage", "not a key"],
    [
      "an EC key",
      generateKeyPairSync("ec", { namedCurve: "P-256" })
        .publicKey.export({ type: "spki", format: "pem" })
        .toString(),
    ],
    ["an empty PEM", "-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----\n"],
  ])("refuses %s as the key", (_name, publicKeyPem) => {
    expect(verifyEd25519({ publicKeyPem, message: MESSAGE, signature: SIG })).toBe(false);
  });
});
