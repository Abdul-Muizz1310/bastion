# Benchmarks

Reproducible measurements for the claims bastion makes about itself. Nothing here
touches the network or a database, so results are comparable across machines.

```bash
pnpm bench     # node benchmarks/jwt-mint.mjs
```

## `jwt-mint` — gateway Ed25519 JWT throughput

Every gateway call (`src/platform/gateway/call.ts`) mints one short-lived
Ed25519 platform JWT (`src/platform/gateway/token.ts`), so this signing cost is on
the hot path of every cross-service request. The benchmark replays the
`SignJWT` call shape used in production: same header (`alg: EdDSA`, `kid`), the
contract-v2 claims (`docs/specs/22-platform-contract-v2.md`), the 60-second
expiry, a fresh `jti` per mint.

20,000 iterations after a 500-iteration warmup; per-call latency sampled with
`process.hrtime.bigint()`.

Measured 2026-10-21 on Node v24.19.0, linux-x64, with the contract-v2 claims:

| Metric | Run 1 | Run 2 |
|---|---|---|
| Throughput | 3,633 mints/sec | 4,558 mints/sec |
| p50 | 0.269 ms | 0.2313 ms |
| p95 | 0.3311 ms | 0.312 ms |
| p99 | 0.3844 ms | 0.3648 ms |

Earlier runs, with the v1 claim set (three fewer claims) on Node v24.12.0, win32-x64:

| Metric | Run 1 | Run 2 |
|---|---|---|
| Throughput | 9,819 mints/sec | 9,620 mints/sec |
| p50 | 0.0965 ms | 0.0976 ms |
| p95 | 0.1321 ms | 0.1359 ms |
| p99 | 0.1845 ms | 0.1921 ms |

Both sets are reported rather than a single best figure; they differ in host and
claim set alike. Run it yourself and expect the same order of magnitude, not the
same digits.

**Reading:** JWT minting costs a tenth to a quarter of a millisecond, i.e. it is
nowhere near the bottleneck of a proxied request — the downstream HTTP call
dominates by three to four orders of magnitude. The gateway's 30 calls/minute
per-visitor limit is a policy choice, not a signing-throughput limit.

The script also emits one JSON line so results can be captured by CI or a
spreadsheet without parsing the table.
