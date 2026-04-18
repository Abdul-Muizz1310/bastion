# Spec 16 — Dossier pipeline + data model

## Purpose

Wire the dossier workflow to a real persistence layer and a callable `POST /api/dossiers` endpoint. The *pipeline itself* (the 6-step sequence that calls downstream services) already exists in `src/features/dossier/server/pipeline.ts` (formerly `lib/demo.ts`, renamed in Block 0.4). This spec adds:

1. Three Drizzle tables: `dossiers`, `evidence_items`, `dossier_events`.
2. Zod schemas at `src/features/dossier/schemas.ts` — request/response DTOs, strongly typed.
3. `src/features/dossier/server/create.ts` — orchestrates: create row, call `startDossierRun`, persist results, emit `dossier_events` along the way.
4. `POST /api/dossiers` route — authenticated, RBAC-gated (admin+editor can create; viewer gets 403), rate-limited.

SSE streaming of progress (`GET /api/dossiers/[id]/stream`) and the result page (`/dossiers/[id]`) are **Block 8**. This block ends with the API route returning a `{dossier_id, request_id, stream_url}` payload that the next block can consume.

## Data model

### `dossiers` table (primary record)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK (defaultRandom) | |
| `user_id` | UUID NOT NULL → `users.id` | creator |
| `claim` | TEXT NOT NULL | user's question (1..1024 chars) |
| `sources` | TEXT[] NOT NULL | registered magpie source ids selected |
| `mode` | TEXT NOT NULL | enum `"rapid" | "standard" | "adversarial"` — controls max_rounds for paper-trail (3, 5, 8 respectively) |
| `status` | TEXT NOT NULL | enum `"pending" | "running" | "succeeded" | "failed"` |
| `verdict` | TEXT NULL | `"TRUE" | "FALSE" | "INCONCLUSIVE"` once paper-trail returns |
| `confidence` | NUMERIC(3,2) NULL | 0.00–1.00 |
| `request_id` | TEXT NOT NULL | propagates through every gateway call for this dossier — the "trace id" |
| `envelope_id` | UUID NULL | → future `dossier_envelopes` table in inkprint (Block 11) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | |

Indexes:
- `dossiers_user_idx` on `(user_id, created_at DESC)` — user's dossier list
- `dossiers_status_idx` on `(status, created_at)` — admin view of running/failed

### `evidence_items` table (per-source scraped + signed items)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `dossier_id` | UUID NOT NULL → `dossiers.id` ON DELETE CASCADE | |
| `source` | TEXT NOT NULL | magpie source id |
| `stable_id` | TEXT NOT NULL | magpie's content-derived fingerprint |
| `url` | TEXT NOT NULL | scraped item URL |
| `title` | TEXT NOT NULL | |
| `certificate_id` | UUID NULL | inkprint certificate id (NULL until signing succeeds) |
| `content_hash` | TEXT NOT NULL | sha256 (hex) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |

Indexes: `evidence_dossier_idx` on `(dossier_id, created_at)`; unique `(dossier_id, stable_id)`.

### `dossier_events` table (pipeline progress log — distinct from the audit log)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `dossier_id` | UUID NOT NULL → `dossiers.id` ON DELETE CASCADE | |
| `step` | TEXT NOT NULL | `"gather" | "seal" | "adjudicate" | "measure" | "envelope" | "record"` |
| `status` | TEXT NOT NULL | `"started" | "ok" | "error"` |
| `latency_ms` | INTEGER NULL | fill on `ok`/`error` |
| `metadata` | JSONB NOT NULL DEFAULT '{}' | step-specific (counts, hashes, downstream ids) |
| `at` | TIMESTAMPTZ DEFAULT NOW() | |

Index: `(dossier_id, at)` so the stream endpoint can tail efficiently.

The existing `events` table (from spec 00-schema) stays — it logs gateway calls + RBAC denials + security events. `dossier_events` is specifically the pipeline progress log exposed to the dossier result page. They coexist; don't merge.

## Zod schemas (`src/features/dossier/schemas.ts`)

```ts
import { z } from "zod/v4";

export const dossierModeSchema = z.enum(["rapid", "standard", "adversarial"]);
export type DossierMode = z.infer<typeof dossierModeSchema>;

export const dossierStatusSchema = z.enum(["pending", "running", "succeeded", "failed"]);
export type DossierStatus = z.infer<typeof dossierStatusSchema>;

export const verdictSchema = z.enum(["TRUE", "FALSE", "INCONCLUSIVE"]);
export type Verdict = z.infer<typeof verdictSchema>;

export const dossierCreateRequestSchema = z.object({
  claim: z.string().min(1).max(1024),
  sources: z.array(z.string().regex(/^[a-z0-9-]+$/).min(1).max(64)).min(1).max(10),
  mode: dossierModeSchema.default("standard"),
});
export type DossierCreateRequest = z.infer<typeof dossierCreateRequestSchema>;

export const dossierCreateResponseSchema = z.object({
  dossier_id: z.uuid(),
  request_id: z.string(),
  stream_url: z.string().startsWith("/api/dossiers/"),
});
export type DossierCreateResponse = z.infer<typeof dossierCreateResponseSchema>;

export const dossierEventSchema = z.object({
  step: z.enum(["gather", "seal", "adjudicate", "measure", "envelope", "record"]),
  status: z.enum(["started", "ok", "error"]),
  latency_ms: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  at: z.string(),  // ISO datetime
});
export type DossierEvent = z.infer<typeof dossierEventSchema>;
```

All frozen / strict. Zod at every boundary — no `any` crossing the request/DB seam.

## `src/features/dossier/server/create.ts`

Signature:

```ts
export async function createDossier(
  input: DossierCreateRequest,
  actor: { id: string; role: Role },
): Promise<DossierCreateResponse>;
```

Behavior:

1. Call `withRole(["admin", "editor"], actor, "dossier.create")` — viewer rejected with `AccessDeniedError`.
2. Generate `dossier_id` (UUID) and `request_id` (UUID).
3. `INSERT INTO dossiers` with status `"pending"`, sources, claim, mode, user_id = actor.id.
4. Append `events` row with action `dossier.created`, entityType `dossier`, entityId = dossier_id, service = `bastion`.
5. Fire-and-forget: call `runPipeline(dossier_id, request_id, input, actor)` **without awaiting** (Next.js `after()` or a raw promise that logs errors). The actual pipeline runs in the same server process; returning early lets the client poll the SSE stream for progress.
6. Return `{ dossier_id, request_id, stream_url: "/api/dossiers/" + dossier_id + "/stream" }`.

### `runPipeline` (new internal function)

Wraps the existing `startDossierRun` with dossier persistence:

```ts
async function runPipeline(
  dossierId: string,
  requestId: string,
  input: DossierCreateRequest,
  actor: { id: string; role: Role },
): Promise<void>;
```

1. Update dossier status → `"running"`.
2. Emit `dossier_events` row `{step: "gather", status: "started"}`.
3. Call existing `startDossierRun({ userId: actor.id, role: actor.role })` — but this needs the request-id threaded through; extend `startDossierRun` to accept a `requestId` parameter (backward-compat — default to `crypto.randomUUID()`).
4. For each step in the result, emit `dossier_events` rows with the right `step` name (rename: existing pipeline has "magpie"/"inkprint"/"paper-trail"/"slowquery"/"audit" — map to dossier steps: magpie→gather, inkprint→seal, paper-trail→adjudicate, slowquery→measure, audit→record; envelope is deferred to Block 11).
5. On pipeline complete: update dossier → `"succeeded"` with verdict + confidence extracted from the paper-trail result data.
6. On pipeline error: update dossier → `"failed"` with error message persisted in the latest `dossier_events` row's metadata.
7. No throw out of `runPipeline` — errors are swallowed into dossier status to prevent uncaught Promise rejections.

## `POST /api/dossiers` route (`src/app/api/dossiers/route.ts`)

1. Read session cookie; if no valid session → 401 (defense in depth — proxy.ts catches first).
2. Parse body with `dossierCreateRequestSchema.safeParse` → 422 on validation error with Zod error details.
3. Rate-limit: `gatewayLimiter.check(session.sid)` → 429 on exceed.
4. Validate every source in `input.sources` exists in the magpie registry. **For this block**, hardcode the known source list: `["hackernews", "arxiv-cs", "weather-live"]` (reading from `@/lib/gateway/services` doesn't help here — that's the service registry, not magpie's per-source registry). Unknown source → 422 `{error: "Unknown source: X"}`.
5. Call `createDossier(parsed, { id: session.user.id, role: session.user.role })`. `AccessDeniedError` → 403 JSON.
6. Return 202 Accepted with `DossierCreateResponse` body — 202 because the pipeline is still running asynchronously when we respond.

## Enumerated test cases

### Zod schema tests (`tests/unit/features/dossier/schemas.test.ts`)

1. Valid create request → parses.
2. claim length 0 → fails.
3. claim length 1025 → fails.
4. sources empty → fails.
5. sources with 11 items → fails.
6. sources with invalid slug char (`"Bad Name"`) → fails.
7. Unknown mode → fails.
8. Default mode is "standard" when omitted.
9. DossierCreateResponse validates UUID + stream_url prefix.

### `createDossier` tests (`tests/unit/features/dossier/create.test.ts`)

10. viewer role → throws `AccessDeniedError`, no DB insert.
11. admin/editor happy path → inserts dossier row with status "pending", writes audit event `dossier.created`, returns correct shape.
12. dossier_id and request_id are valid UUIDs.
13. stream_url format: `/api/dossiers/<dossier_id>/stream`.
14. runPipeline is called but NOT awaited (response returns before pipeline finishes) — verify by mocking `startDossierRun` with a promise that never resolves and asserting `createDossier` returns within 100ms.

### Route tests (`tests/unit/app/api/dossiers/route.test.ts`)

15. POST with valid body + admin session → 202 with correct shape.
16. POST with valid body + viewer session → 403 (AccessDeniedError mapped).
17. POST without session → 401.
18. POST with empty `claim` → 422 with Zod error details.
19. POST with unknown source → 422 with `error: "Unknown source: X"`.
20. Rate limit exceeded → 429 with Retry-After.
21. Request includes `X-Request-Id` — response's dossier's request_id matches.

## Non-goals for Block 7

- SSE stream endpoint (Block 8 builds `/api/dossiers/[id]/stream`).
- Dossier list endpoint (`GET /api/dossiers`) — add in Block 9 (home page needs it).
- Dossier delete, edit (not yet).
- Envelope signing (Block 11 — needs inkprint's batch/envelope endpoints from Block 5).
- `evidence_items` population — extracted from the raw pipeline result payload; minimal wiring this block, fuller sync in Block 8.
- Batch scrape — the pipeline still uses the existing single-source `/api/scrape/hackernews/top` endpoint. Block 4's batch endpoint is an optimization for later.

## Sub-step ordering

1. **7.1** — this spec.
2. **7.2** — add drizzle tables to `src/lib/db/schema.ts`. Run `pnpm db:generate` to produce migration SQL. Do NOT run `db:migrate` against a live DB — just generate.
3. **7.3** — `src/features/dossier/schemas.ts` + red tests → green.
4. **7.4** — `src/features/dossier/server/create.ts` + red tests → green. Requires extending `startDossierRun` to accept optional requestId.
5. **7.5** — `src/app/api/dossiers/route.ts` + red tests → green.
6. **7.6** — full `pnpm test`, `pnpm lint`, `pnpm build`.

## Rollback

Each sub-step is a single commit. Drizzle migration SQL is reversible via a down-migration; since we're only generating (not applying), rollback is literally `git rm` on the generated file.
