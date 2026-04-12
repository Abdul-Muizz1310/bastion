#!/usr/bin/env node
/**
 * Generate Ed25519 keypair for bastion JWT signing.
 * Outputs base64-encoded PKCS8 (private) and SPKI (public) keys.
 */
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const privB64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const pubB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

console.log(`BASTION_SIGNING_KEY_PRIVATE=${privB64}`);
console.log(`BASTION_SIGNING_KEY_PUBLIC=${pubB64}`);
console.log(`BASTION_KEY_ID=bastion-ed25519-${new Date().toISOString().slice(0, 7)}`);
