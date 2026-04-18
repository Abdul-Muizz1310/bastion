# E2E tests

Scaffolded in Block 13. Not run by the default `pnpm test` (unit suite only).

## Activate

```bash
pnpm add -D @playwright/test
npx playwright install chromium
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
