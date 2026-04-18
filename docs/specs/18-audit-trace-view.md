# Spec 18 — Real `/audit` + `/audit/[requestId]` trace view

## Purpose

Replace the `MOCK_EVENTS` array in `src/app/(app)/audit/page.tsx` with real data from the `events` table, and add a single-request trace view at `/audit/[requestId]` showing the full waterfall of gateway calls + dossier pipeline events tied to a single `request_id`.

## Contract

### `/audit` page

Server Component. Authenticated (middleware) + role-aware:

- **admin / editor** — see all events (most recent 100 by default, filters narrow).
- **viewer** — see only their own events (`where actor_id = session.user.id`). Never leaks other users' actions.

Filters (driven by `searchParams`):
- `service?: string` — one of bastion / magpie / inkprint / paper-trail / slowquery.
- `action?: string` — prefix match (e.g., `gateway.` shows all gateway events).
- `since?: ISO datetime` — default: last 24h.
- `limit?: int` — default 100, cap 500.

Layout: terminal-styled table (same column shape as current: `#`, `action`, `actor`, `service`, `time`). Rows are `<Link>` to `/audit/[requestId]` if the event has one.

### `/audit/[requestId]` trace view

Server Component. Returns all events (any service) with matching `request_id`, ordered by `created_at ASC`. Renders a waterfall:

- Each row is a lane labeled with the service.
- Shows action, actor, status (derived from suffix: `.ok`/`.error`), latency (from metadata when present).
- Total wall-clock at top: first `created_at` → last `created_at`.
- 404 if no events match the id.

### RBAC

- `/audit` — any authenticated role (viewer gets own-only; admin/editor get all). No `forbidden()` for viewer; the server silently scopes the query.
- `/audit/[requestId]` — viewer 403s if the trace has any events whose `actor_id !== session.user.id`. Admin/editor always pass.

## Test cases

### `/audit` page

1. unauth'd → middleware redirects to `/login?returnTo=%2Faudit` (already handled — no new test).
2. admin session: queryEvents called with no actor filter; renders rows.
3. editor session: same — sees all events.
4. viewer session: queryEvents called with `actorId = session.user.id`; only own events rendered.
5. `?service=magpie` passes `service: "magpie"` into queryEvents.
6. `?action=gateway.` passes `actionPrefix: "gateway."`.
7. renders empty-state when no rows: "no events match".
8. rows with `requestId` wrap in a `<Link>` to `/audit/<requestId>`.

### `/audit/[requestId]`

9. admin session + matching trace → renders waterfall with all events.
10. unknown requestId → `notFound()`.
11. viewer session + trace containing other-user events → `forbidden()` thrown.
12. viewer session + trace entirely own events → renders.
13. renders total latency from first/last event timestamps.

## Implementation outline

- `src/features/audit/server/query.ts` — wraps `queryEvents` (already exists in `lib/audit/query`) with role-scoping. Exports `queryAuditFor(session, filters)` and `queryTraceFor(session, requestId)`.
- `src/app/(app)/audit/page.tsx` — async RSC; reads searchParams, calls `queryAuditFor`.
- `src/app/(app)/audit/[requestId]/page.tsx` — async RSC; calls `queryTraceFor`, 404/403 as needed.
- `src/features/audit/components/AuditTable.tsx` — presentational server component; takes rows, renders the table (stays close to the existing mock styling).
- `src/features/audit/components/TraceWaterfall.tsx` — presentational; takes the ordered rows, renders a simple swim-lane-per-service view.

## Non-goals

- SSE live-streaming of new events to `/audit` (polling refresh in Block 12 polish).
- Full-text search on metadata (out of scope).
- Pagination UI (simple limit-based cap; infinite scroll = Block 12).
- JWT claim inspector UI on trace rows (deferred).
