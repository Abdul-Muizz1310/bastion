# End-to-end tests

Playwright drives a real Chrome against `next build && next start` (spec 21 §10.1). Every downstream
service is one local stub; nothing reaches a production host or database. CI runs this suite in the
`e2e` job.

## Run it

```bash
pnpm exec playwright install chromium        # once
pnpm build
export DATABASE_URL=postgresql://postgres:pg@localhost:5433/bastion_e2e   # a local Postgres
node scripts/migrate.mjs --force
pnpm test:e2e
```

`DATABASE_URL` must name a local host; the config refuses anything else. Use a fresh database: the
golden dossier's audit events are written at fixed ids, and a database whose ids are taken by
other events is refused. Re-running on the same e2e database is fine: the golden dossier is
written again with the current time, so it stays among the home gallery's six newest. `openssl`
must be on the `PATH` (it makes the stub's certificate).

## What starts, in order

1. **The stub** (`fixtures/upstream.ts`, `https://localhost:8543`), run by Node straight from
   TypeScript. It answers every capability path from `tests/fixtures/downstream/` and the
   issuer-signed `tests/fixtures/receipts/`, under `/<tenant>/<service>/…`.
2. **main** (`:3100`): every service live, budgets generous.
3. **limits** (`:3101`): `BUDGET_DEBATE=0`, and feathers-demo's `/health` hangs until a test calls
   the stub's `POST /__control/wake`.
4. **The seed** (`fixtures/seed.ts`): the golden dossier and its audit events, checked against what
   inkprint signed before anything is written.

Each app's output is written to `.e2e/main.log` and `.e2e/limits.log` (case 5 reads the runner's
hand-off warnings back; CI uploads them with the report on failure). Each app gets a throwaway
Ed25519 key and `IRON_SESSION_PASSWORD` (made once into `.e2e/`, which git
ignores), blank Upstash settings (budgets count in-process; rate limits are off), and
`NODE_EXTRA_CA_CERTS` pointing at the stub's certificate.

## The specs

| Spec | Proves |
|---|---|
| `home.spec.ts` | 8 map nodes, each a workbench link whose name holds its state in words; Tab reaches the map, Enter opens a node |
| `workbenches.spec.ts` | each of the 8 workbenches' main action, clicked (inkthread by keyboard), hands back its receipt with copy button and audit link |
| `dossier.spec.ts` | compose → run → receipt → verify (7 checks in words; the stub's unsigned receipts fail); the golden dossier verifies 7/7; a dossier with no page open crosses a 12 s scrape and a 12 s seal that fails once with a retryable 503 (the first live smoke's failure) on its own `after()` chain, and the app's log shows no hand-off let go before its successor answered, and that every hop's two ends join in the chain's trace |
| `limits.spec.ts` | no debates left: the submit is held, the API answers 429 and paper-trail is never called; an asleep service reads asleep, then live after "wake again" |
| `pages.spec.ts` | `/audit` filters, a request's trail, `/time-travel`, `/platform` |
| `metadata.spec.ts` | spec 20's head tags and metadata routes |
| `live/dossier.spec.ts` | the live smoke (below) |

## The live smoke

```bash
BASTION_LIVE_SMOKE=1 PLAYWRIGHT_BASE_URL=https://bastion-six.vercel.app pnpm test:e2e
```

With `PLAYWRIGHT_BASE_URL` set there is no stub and no seed: only `metadata.spec.ts` runs, plus the
live smoke when `BASTION_LIVE_SMOKE=1`. The smoke spends one debate on that deployment: it composes
one rapid dossier, follows it only over SSE (nothing nudges it; it gives up once no step has changed
for 3 minutes), attaches the dossier's chain trace to the report either way, requires it to succeed through a
single-invocation stage longer than the old 10 s hand-off window, and then passes every verification
check in the browser. It never runs in CI.
