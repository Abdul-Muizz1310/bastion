# Benchmarks

Reproducible measurements for the claims bastion makes about itself. Nothing here
touches the network or a database, so results are comparable across machines.

```bash
pnpm bench     # node benchmarks/jwt-mint.mjs
```

## `jwt-mint` — gateway Ed25519 JWT throughput

Every call through `/api/proxy/[service]/[...path]` mints one short-lived
Ed25519 platform JWT (`src/lib/gateway/jwt.ts`), so this signing cost is on the
hot path of every cross-service request. The benchmark replays the exact
`SignJWT` call shape used in production: same header (`alg: EdDSA`, `kid`), same
claims, same 60-second expiry, a fresh `jti` per mint.

20,000 iterations after a 500-iteration warmup; per-call latency sampled with
`process.hrtime.bigint()`.

| Metric | Run 1 | Run 2 |
|---|---|---|
| Throughput | 9,819 mints/sec | 9,620 mints/sec |
| p50 | 0.0965 ms | 0.0976 ms |
| p95 | 0.1321 ms | 0.1359 ms |
| p99 | 0.1845 ms | 0.1921 ms |

Measured on Node v24.12.0, win32-x64. Both runs are reported rather than a
single best figure — run it yourself and expect the same order of magnitude, not
the same digits.

**Reading:** JWT minting costs roughly a tenth of a millisecond, i.e. it is
nowhere near the bottleneck of a proxied request — the downstream HTTP call
dominates by three to four orders of magnitude. The gateway's 60 requests/minute
rate limit is a policy choice, not a signing-throughput limit.

The script also emits one JSON line so results can be captured by CI or a
spreadsheet without parsing the table.
