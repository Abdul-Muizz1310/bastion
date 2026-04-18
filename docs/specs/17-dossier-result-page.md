# Spec 17 — Dossier result page + SSE stream

## Purpose

Close the loop on the Dossier flow. After `POST /api/dossiers` creates a dossier and kicks off the pipeline (Block 7), the user needs:

1. A **live-streaming SSE endpoint** `GET /api/dossiers/[id]/stream` that tails `dossier_events` rows as they're inserted by `runPipeline`.
2. A **result page** `/dossiers/[id]` (RSC shell + client streaming island) that subscribes to that SSE stream and renders the pipeline's progress as a step-by-step timeline with a final verdict card.

This block ships the **skeletal** result page — step timeline + verdict badge + claim header. Evidence grid, debate panel, perf receipt, and the "verify all signatures" button are deferred to Block 11 (those depend on envelope data populated by the future inkprint `/dossiers/envelope` call).

## DB query helpers (new — `src/features/dossier/server/query.ts`)

```ts
export async function getDossier(id: string): Promise<Dossier | null>;
export async function listDossierEvents(
  dossierId: string,
  sinceAt?: Date,
): Promise<DossierEventRow[]>;
```

- `getDossier(id)`: selects one row by id. Returns null if not found or id malformed. Never throws on missing — null is the sentinel.
- `listDossierEvents(dossierId, sinceAt)`: returns all events for that dossier ordered by `at ASC`, optionally filtered to `at > sinceAt` for SSE tailing. Capped at 200 per call for safety.

## SSE endpoint (`src/app/api/dossiers/[id]/stream/route.ts`)

Streams `text/event-stream` events:

- Event `state` — fired initially (replay of all past events) and on every new event row. Payload: full DossierEvent (step, status, latency_ms, metadata, at).
- Event `status` — fired when the dossier's status column changes (polled alongside). Payload: `{status, verdict?, confidence?}`.
- Event `heartbeat` — every 15 seconds, payload `{t: <iso>}`. Keeps the proxy from closing the connection.
- Event `done` — when `status` in `{"succeeded", "failed"}`. Payload: final `{status, verdict, confidence}`. Server closes stream after emitting.

Poll cadence: every **1 second**. Each tick:
1. Select `dossier_events WHERE dossier_id = $1 AND at > $last_seen ORDER BY at ASC LIMIT 200`.
2. Emit each row as `event: state`.
3. Select dossier's current `status` / `verdict` / `confidence` — if changed since last tick, emit `event: status`.
4. If status is terminal, emit `event: done` and return (close).

Hard cap: 3 minutes total (180 iterations). After that, emit `event: timeout` and close — protects against zombie streams. Client must reconnect if needed (EventSource does this automatically with exponential backoff).

Auth:
- 401 if no session (middleware already handles this; the route double-checks).
- Anyone authenticated can view any dossier in this block. **Block 12** can tighten to creator/admin if needed.
- Unknown dossier id → 404.

## Result page (`src/app/(app)/dossiers/[id]/page.tsx`)

RSC shell that:
1. Validates `id` (UUID regex) — malformed → `notFound()`.
2. Fetches `getDossier(id)` — null → `notFound()`.
3. Fetches initial `listDossierEvents(id)` — seed the client with historical events so the UI doesn't flicker waiting for SSE.
4. Renders:
   - `<PageFrame>` with status bar showing `dossier.id · status` and request_id.
   - **Claim header**: the user's question in big mono type, with mode + sources + created_at below.
   - **Verdict badge**: when `status === "succeeded"` or `"failed"`, shows the verdict + confidence; else shows "running" with a pulsing dot.
   - **Step timeline**: client component that subscribes to SSE. Renders 6 step rows (gather, seal, adjudicate, measure, envelope, record), each showing its latest state (pending/running/ok/error) with latency and any error message.
5. Also renders loading and not-found variants:
   - `loading.tsx`: typewriter "$ bastion dossier load $id…" inside a TerminalWindow.
   - `not-found.tsx`: terminal-styled "dossier not found" message with back-to-dashboard link.

## Client streaming island (`src/features/dossier/components/StepTimeline.tsx`)

`"use client"` component. Props: `{ dossierId: string; initialEvents: DossierEvent[]; initialStatus: DossierStatus; initialVerdict: Verdict | null; initialConfidence: number | null }`.

- Uses `useEffect` + `EventSource(/api/dossiers/${dossierId}/stream)`.
- Maintains state: `events: DossierEvent[]`, `status: DossierStatus`, `verdict/confidence` (for the badge).
- On SSE `state` event: Zod-parse, append to events.
- On SSE `status` event: update status/verdict/confidence.
- On SSE `done` event: close the EventSource.
- On `error`: relies on EventSource's auto-reconnect (exponential backoff by the browser). No manual retry loop.
- Renders a 6-row table: step name | status badge (pending/running/ok/error) | latency | metadata preview.

## Enumerated test cases

### `getDossier` / `listDossierEvents` (`tests/unit/features/dossier/query.test.ts`)

1. `getDossier(validUuid)` when row exists → returns typed row.
2. `getDossier(validUuid)` when no row → returns null (no throw).
3. `getDossier(malformedId)` → returns null (no throw, no SQL injection attempt).
4. `listDossierEvents(id)` returns rows in ASC order by `at`.
5. `listDossierEvents(id, sinceAt)` filters correctly.
6. `listDossierEvents(id)` caps result at 200 rows (verify LIMIT clause is applied — structural).

### SSE route (`tests/unit/app/api/dossiers/[id]/stream/route.test.ts`)

7. GET without session → 401.
8. GET with unknown dossier id → 404.
9. GET with valid dossier + session returns `text/event-stream` content-type.
10. Initial replay emits `event: state` for every historical event.
11. Emits `event: status` when dossier status changes.
12. Emits `event: done` when status is terminal (`succeeded`/`failed`).
13. Heartbeat emitted every 15s.
14. Hard-cap exit after ~180 iterations (verify via short override for test).

### Result page (`tests/unit/app/(app)/dossiers/[id]/page.test.tsx`)

15. Invalid UUID id → `notFound()` called.
16. Unknown dossier id (getDossier returns null) → `notFound()` called.
17. Valid dossier renders claim, status, verdict (if set), sources list.
18. Passes `initialEvents` to StepTimeline.

### StepTimeline component (`tests/unit/features/dossier/components/StepTimeline.test.tsx`)

19. Renders 6 step rows (gather, seal, adjudicate, measure, envelope, record).
20. Shows "pending" for steps with no events.
21. Shows "running" when latest event is `started`.
22. Shows "ok" / "error" badges appropriately.

## Non-goals in Block 8

- Evidence grid, debate panel, perf receipt — Block 11.
- Dossier list page (`/dossiers` index) — Block 9 integrates this into the home page.
- Re-verify-all-signatures button — Block 11 (needs inkprint's `/verify/batch` endpoint from Block 5).
- Replacing the 1s polling in SSE with Postgres LISTEN/NOTIFY — later optimization.
- Dossier delete/edit — not planned.

## Runtime

SSE route uses Node.js runtime (default) — needs DB access via drizzle-orm/postgres-js which is Node-only. Do NOT set `export const runtime = 'edge'`.

## Sub-step ordering

1. **8.1** — spec (this doc).
2. **8.2** — `query.ts` + red tests → green.
3. **8.3** — SSE route + red tests → green.
4. **8.4** — result page + StepTimeline + red tests → green.
5. **8.5** — `pnpm test/lint/build` clean.
