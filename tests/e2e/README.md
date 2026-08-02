# E2E tests

Scaffolded in Block 13. Not run by the default `pnpm test` (unit suite only).

## Activate

`@playwright/test` is a committed devDependency, so `pnpm install` already provides
the runner. You only need the browser binaries:

```bash
pnpm exec playwright install chromium
```

## Run

```bash
# Terminal 1 — server (DEMO_MODE=true required for guest sign-in used by the specs)
DEMO_MODE=true pnpm build && pnpm start

# Terminal 2 — tests
pnpm test:e2e
```

Or against a deployed preview:

```bash
PLAYWRIGHT_BASE_URL=https://bastion-six.vercel.app pnpm test:e2e
```

## What's covered

- `auth-flow.spec.ts` — redirect with returnTo + demo-mode viewer sign-in + role-pill rendering + read-only UX.
- `rbac.spec.ts` — viewer/editor hitting `/time-travel` get the styled 403 page.

## What's not covered yet

- **Full dossier run** — POST `/api/dossiers` kicks off a real pipeline that calls magpie/inkprint/paper-trail/slowquery backends. Running this in CI needs either: (a) live deployments of all four + a seeded Neon test branch, or (b) MSW-style mocks at the gateway boundary. Both are infrastructure work beyond the scope of this block. Recommended next step: add a `PLAYWRIGHT_MOCK_GATEWAY=true` env path that intercepts `/api/proxy/*` with canned responses, then write `dossier-flow.spec.ts`.
- **Audit trace flow** — depends on a dossier existing in the DB, same shape as above.
- **Admin happy path on `/time-travel`** — the admin demo button now exists, so the page is reachable end-to-end, but asserting that dragging the slider changes the entity list needs events seeded at known timestamps. Until that fixture exists, the wiring is covered at unit level (`tests/unit/features/time-travel/**`, `tests/unit/app/(app)/time-travel/page.test.tsx`) and the DB guarantee it rests on is covered by `tests/integration/db/append-only.test.ts`.

## Tiers

`pnpm test` (unit) and `pnpm test:integration` (real Postgres) both run in CI ahead of
these specs; see `.github/workflows/ci.yml`.
