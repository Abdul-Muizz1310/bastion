# 06 — Audit Log (Append-Only Events)

## Goal

Provide an `appendEvent` helper that inserts structured events into the append-only `events` table. Every significant action across bastion and downstream services is recorded with actor, action, entity, before/after state, and cross-service request ID. The audit log page (`/audit`) displays events with filtering.

## Inputs / Outputs / Invariants

- **Input:** Event data: `actorId`, `action`, `entityType`, `entityId`, `service?`, `requestId?`, `before?`, `after?`, `metadata?`.
- **Output:** Inserted event row with auto-generated `id` and `createdAt`.
- **Invariants:**
  - Events are immutable — INSERT only, enforced at DB level (spec 00).
  - `appendEvent` never throws — errors are caught and logged to stderr. Audit failures must not break user flows.
  - `action` follows a dot-separated convention: `auth.login`, `demo.magpie.ok`, `security.denied`, etc.
  - `requestId` enables cross-service correlation — all events from the same gateway call share a request ID.
  - `/audit` page is paginated (50 events per page) with filters: service, action prefix, date range, actor.

## Enumerated Test Cases

### Happy path
1. `appendEvent({ action: "auth.login", ... })` inserts a row and returns the event ID.
2. Event `createdAt` is set by the database (server time), not the application.
3. `before` and `after` JSONB fields capture state changes (e.g., role change: `before: { role: "viewer" }`, `after: { role: "editor" }`).
4. Events with the same `requestId` are queryable together.
5. `/audit` page renders events in reverse chronological order.
6. `/audit` filtering by service returns only events from that service.
7. `/audit` filtering by date range returns events within bounds.
8. `/audit` pagination: page 1 shows 50 most recent, page 2 shows next 50.

### Edge / failure cases
9. `appendEvent` with DB connection error does not throw — logs warning, returns `null`.
10. `appendEvent` with missing required fields (`action`, `entityType`, `entityId`) throws a Zod validation error before DB insert.
11. Very large `metadata` object (>1MB) — Postgres JSONB handles it, but application should warn.

### Security
12. `/audit` is accessible only to admin and editor (enforced by RBAC spec 03).
13. Events cannot be modified or deleted via any application endpoint.
14. `actorId` is always the authenticated user — cannot be spoofed via request body.

## Acceptance Criteria

- [ ] `src/lib/audit.ts` exports `appendEvent` helper
- [ ] Events are immutable (DB-level guarantee from spec 00)
- [ ] `/audit` page with pagination and filtering
- [ ] Cross-service correlation via `requestId`
- [ ] `appendEvent` never crashes the calling flow
- [ ] All 14 test cases have passing tests
