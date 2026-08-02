#!/usr/bin/env node
/**
 * Gateway JWT mint throughput.
 *
 * Every request through /api/proxy/[service]/[...path] mints one short-lived
 * Ed25519 platform JWT, so this signing cost sits on the hot path of every
 * cross-service call. This measures it in isolation — no network, no database.
 *
 * Reproduce:  pnpm bench
 * Output is written to stdout as a table plus a machine-readable JSON line.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { hrtime } from "node:process";
import * as jose from "jose";

const WARMUP = 500;
const ITERATIONS = 20_000;
const KEY_ID = "bastion-ed25519-bench";

const { privateKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const key = await jose.importPKCS8(
  `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----`,
  "EdDSA",
);

/** Byte-for-byte the same call shape as src/lib/gateway/jwt.ts:mintPlatformJwt. */
async function mint() {
  return new jose.SignJWT({ role: "admin", service: "paper-trail" })
    .setProtectedHeader({ alg: "EdDSA", kid: KEY_ID })
    .setSubject("00000000-0000-4000-8000-000000000000")
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(key);
}

for (let i = 0; i < WARMUP; i++) await mint();

const samples = new Float64Array(ITERATIONS);
const start = hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = hrtime.bigint();
  await mint();
  samples[i] = Number(hrtime.bigint() - t0) / 1e6;
}
const wallMs = Number(hrtime.bigint() - start) / 1e6;

samples.sort();
const at = (q) => samples[Math.min(ITERATIONS - 1, Math.floor(ITERATIONS * q))];
const opsPerSec = (ITERATIONS / wallMs) * 1000;

const result = {
  benchmark: "gateway-jwt-mint",
  algorithm: "Ed25519 (EdDSA) via jose",
  iterations: ITERATIONS,
  warmup: WARMUP,
  wall_ms: Number(wallMs.toFixed(1)),
  ops_per_sec: Math.round(opsPerSec),
  p50_ms: Number(at(0.5).toFixed(4)),
  p95_ms: Number(at(0.95).toFixed(4)),
  p99_ms: Number(at(0.99).toFixed(4)),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
};

console.log(`
gateway JWT mint — Ed25519, ${ITERATIONS.toLocaleString()} iterations (${WARMUP} warmup)
  throughput   ${result.ops_per_sec.toLocaleString()} mints/sec
  p50          ${result.p50_ms} ms
  p95          ${result.p95_ms} ms
  p99          ${result.p99_ms} ms
  node         ${result.node} on ${result.platform}
`);
console.log(JSON.stringify(result));
