# Spec 12 — Bastion directory restructure

## Purpose

Move bastion from a flat, colocated-test layout to a Next.js 16 layout that scales: route groups for shared layouts, a `features/` folder for feature-scoped code, a segmented `lib/` for cross-cutting concerns, and a separate `tests/` tree mirroring `src/`.

This is a **mechanical restructure** — no behavior changes. The contract: **every one of the 258 existing tests stays green after every intermediate step**, coverage stays at its current level, biome lint stays clean.

## Non-goals

- New features, new APIs, new behavior.
- UI polish.
- Renaming the `bastion` repo/folder itself (bastion stays; only the internal workflow name changes from `demo` → `dossier`).
- Renaming `DEMO_MODE` env var (that's the guest-login shortcut, unrelated to the workflow).

## Invariants (must hold after every sub-step)

1. `pnpm test` → 258 passed, no regressions.
2. `pnpm lint` → zero errors.
3. `pnpm build` → success.
4. Existing routes continue to resolve at the same URLs (`/login`, `/dashboard`, `/services/[id]`, `/audit`, `/time-travel`, `/whoami`, `/run` — though `/run` is a stub that gets replaced later by the dossier console home page in Block 9; for Block 0 it stays intact).
5. No change to drizzle schema (new tables are Block 7 work, not Block 0).
6. No change to deployed Vercel env vars (Block 9 touches those).

## Target tree (end of Block 0)

```
bastion/
├── src/
│   ├── app/
│   │   ├── layout.tsx                      (root: fonts, providers, globals.css)
│   │   ├── page.tsx                        (unchanged stub — replaced in Block 9)
│   │   ├── globals.css
│   │   ├── favicon.ico
│   │   ├── actions.ts                      (unchanged)
│   │   ├── (public)/                       ── route group
│   │   │   ├── login/
│   │   │   │   ├── page.tsx
│   │   │   │   └── login-form.tsx
│   │   │   └── auth/callback/route.ts
│   │   ├── (app)/                          ── route group (shared authed layout comes in Block 3)
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── services/[id]/page.tsx
│   │   │   ├── audit/page.tsx
│   │   │   ├── time-travel/page.tsx
│   │   │   ├── whoami/page.tsx
│   │   │   └── run/page.tsx                (stub — replaced in Block 9)
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── public-key/route.ts
│   │       └── status/route.ts
│   │
│   ├── features/                           ── feature-scoped (mostly empty at end of Block 0)
│   │   ├── dossier/
│   │   │   ├── server/
│   │   │   │   └── pipeline.ts            (from src/lib/demo.ts, renamed)
│   │   │   ├── components/                (empty — populated in Block 8)
│   │   │   ├── hooks/                     (empty)
│   │   │   └── schemas.ts                 (empty stub)
│   │   ├── services-registry/components/   (empty)
│   │   ├── audit/
│   │   │   ├── server/                    (empty)
│   │   │   └── components/                (empty)
│   │   ├── auth/
│   │   │   ├── components/                (empty)
│   │   │   └── server/                    (empty)
│   │   └── time-travel/
│   │       ├── server/                    (empty)
│   │       └── components/                (empty)
│   │
│   ├── components/
│   │   └── terminal/                      (unchanged — shared chrome)
│   │
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── session.ts                 (was src/lib/session.ts)
│   │   │   ├── magic-link.ts              (from src/lib/auth.ts — sendMagicLink + consumeMagicLink)
│   │   │   ├── guest-sign-in.ts           (from src/lib/auth.ts — demoSignIn stays named the same for compat)
│   │   │   ├── rbac.ts                    (was src/lib/rbac.ts)
│   │   │   └── csrf.ts                    (was src/lib/csrf.ts)
│   │   ├── gateway/
│   │   │   ├── jwt.ts                     (from src/lib/gateway.ts — mintPlatformJwt)
│   │   │   ├── services.ts                (was src/lib/services.ts)
│   │   │   └── request-id.ts              (from src/lib/gateway.ts — parseRequestId + resolveService)
│   │   ├── audit/
│   │   │   ├── write.ts                   (from src/lib/audit.ts — appendEvent)
│   │   │   ├── query.ts                   (from src/lib/audit.ts — queryEvents)
│   │   │   └── replay.ts                  (was src/lib/replay.ts)
│   │   ├── db/
│   │   │   ├── client.ts                  (was src/lib/db.ts)
│   │   │   └── schema.ts                  (was src/lib/schema.ts)
│   │   ├── rate-limit/
│   │   │   └── index.ts                   (was src/lib/rate-limit.ts)
│   │   ├── registry.ts                    (unchanged — cross-cutting service-health probe)
│   │   └── validation.ts                  (unchanged — cross-cutting Zod schemas)
│   │
│   └── middleware.ts                      (stays in Block 0 — renamed to proxy.ts in Block 0.7)
│
├── tests/                                  ── NEW — separate tree mirroring src/
│   ├── unit/
│   │   ├── app/                            (mirrors src/app/)
│   │   ├── features/                       (empty until Block 7+)
│   │   ├── lib/
│   │   │   ├── auth/{session,magic-link,guest-sign-in,rbac,csrf}.test.ts
│   │   │   ├── gateway/{jwt,services,request-id}.test.ts
│   │   │   ├── audit/{write,query,replay}.test.ts
│   │   │   ├── db/{client,schema}.test.ts
│   │   │   ├── rate-limit/*.test.ts
│   │   │   ├── registry.test.ts
│   │   │   └── validation.test.ts          (if exists)
│   │   ├── components/terminal/*.test.tsx
│   │   └── middleware.test.ts              (→ proxy.test.ts after Block 0.7)
│   ├── integration/                        (empty until later blocks)
│   ├── e2e/                                (empty until Block 13)
│   ├── fixtures/                           (empty)
│   ├── helpers/                            (empty)
│   └── setup.ts                            (empty placeholder)
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEMO.md                             (renamed to DOSSIER.md in Block 9)
│   └── specs/
│       ├── 00-schema.md … 11-security-e2e.md       (unchanged)
│       ├── 12-restructure.md                        (THIS DOC)
│       ├── 13-return-to-auth.md                     (Block 2)
│       ├── 14-page-rbac.md                          (Block 3)
│       ├── 15-gateway-proxy-route.md                (Block 1)
│       ├── 16-dossier-pipeline.md                   (Block 7)
│       ├── 17-dossier-result-page.md                (Block 8)
│       ├── 18-audit-trace-view.md                   (Block 10)
│       ├── 19-dossier-verification.md               (Block 11)
│       └── api-additions/
│           ├── magpie-batch-scrape.md               (Block 4)
│           ├── inkprint-batch-and-envelope.md       (Block 5)
│           └── paper-trail-evidence-pool.md         (Block 6)
```

## Import-path migration table

Every updated import must be verified by `pnpm test` passing.

| Old | New |
|---|---|
| `@/lib/audit` | `@/lib/audit/write` (appendEvent) or `@/lib/audit/query` (queryEvents) |
| `@/lib/auth` | `@/lib/auth/magic-link` or `@/lib/auth/guest-sign-in` |
| `@/lib/csrf` | `@/lib/auth/csrf` |
| `@/lib/db` | `@/lib/db/client` |
| `@/lib/demo` | `@/features/dossier/server/pipeline` |
| `@/lib/gateway` | `@/lib/gateway/jwt` or `@/lib/gateway/request-id` |
| `@/lib/rate-limit` | `@/lib/rate-limit` (index.ts — same path, just now a folder) |
| `@/lib/rbac` | `@/lib/auth/rbac` |
| `@/lib/replay` | `@/lib/audit/replay` |
| `@/lib/schema` | `@/lib/db/schema` |
| `@/lib/services` | `@/lib/gateway/services` |
| `@/lib/session` | `@/lib/auth/session` |
| `@/lib/validation` | `@/lib/validation` (unchanged) |
| `@/lib/registry` | `@/lib/registry` (unchanged) |

## Rename: `demo` → `dossier` (workflow-only)

Applies to:
- File: `src/lib/demo.ts` → `src/features/dossier/server/pipeline.ts`
- Function: `startDemoRun` → `startDossierRun`
- Types: `DemoRunInput` → `DossierRunInput`, `DemoStepResult` → `DossierStepResult`, `DemoRunResult` → `DossierRunResult`
- Constant: `DEMO_STEPS` → `DOSSIER_STEPS`
- Audit action prefixes: `demo.magpie.ok` → `dossier.magpie.ok` (etc.)
- Audit entityType: `"demo"` → `"dossier"`

**Does NOT apply to:**
- `DEMO_MODE` env var (guest-auth shortcut, unrelated)
- `demoSignIn` / `demoSignInAction` function names (same reason)
- `DEMO_ALLOWED_ROLES` (guest-auth role allowlist)

These stay for Block 0. A later block may rename them to `GUEST_MODE` / `guestSignIn`, but that requires a coordinated Vercel env var change and is out of scope here.

## Test-file migration

All `*.test.ts(x)` files currently sit next to source. They move to `tests/unit/` preserving relative path:

- `src/lib/audit.test.ts` → `tests/unit/lib/audit/write.test.ts` + `tests/unit/lib/audit/query.test.ts` (split with the source)
- `src/lib/gateway.test.ts` → `tests/unit/lib/gateway/jwt.test.ts` + `tests/unit/lib/gateway/request-id.test.ts` (split)
- `src/lib/auth.test.ts` → `tests/unit/lib/auth/magic-link.test.ts` + `tests/unit/lib/auth/guest-sign-in.test.ts` (split)
- `src/lib/demo.test.ts` → `tests/unit/features/dossier/pipeline.test.ts` (renamed)
- Every other `.test.ts` moves 1:1 preserving name, under `tests/unit/<same-relative-path>`
- `src/middleware.test.ts` → `tests/unit/middleware.test.ts` (renamed to `proxy.test.ts` in Block 0.7)

No test content changes in this block — only import paths change. Test case names, assertions, mocks: all identical.

## Config changes

- `vitest.config.ts`: change `include` from `["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"]` to `["tests/unit/**/*.test.{ts,tsx}"]`. Add coverage `include` and `exclude` updated for the new layout.
- `tsconfig.json`: add path alias `"@test/*": ["./tests/*"]` alongside existing `"@/*": ["./src/*"]`.
- `package.json` scripts: add `test:unit`, keep `test` as alias. `test:integration` and `test:e2e` are stubbed (Block 7+ / Block 13).

## Sub-step ordering (each tests-green gated)

1. **0.2** (this turn) — write this spec; create empty directory skeleton. No source touched; tests still pass.
2. **0.3** — split `src/lib/` flat files into subfolders. Move files, update every import, run tests.
3. **0.4** — rename `demo` → `dossier`: move `src/lib/demo.ts` → `src/features/dossier/server/pipeline.ts`, rename exports, update all imports.
4. **0.5** — move app routes into `(public)` and `(app)` route groups. URLs unchanged (route groups don't affect URLs).
5. **0.6** — lift colocated tests into `tests/unit/` mirror. Update `vitest.config.ts` to include only `tests/**`.
6. **0.7** — rename `src/middleware.ts` → `src/proxy.ts` and the export function `middleware` → `proxy` (Next 16 convention).
7. **0.8** — final verification: `pnpm test`, `pnpm lint`, `pnpm build`.

## Rollback

Each sub-step is a single commit. If `pnpm test` fails, `git reset --hard HEAD~1` recovers. Do not proceed to the next sub-step with red tests.
