# 08 — Service Registry + Status Aggregation

## Goal

Display the 5-service portfolio as a registry on `/dashboard` with live health, version, and p95 latency for each service. `/api/status` aggregates health from all services in parallel with 60s ISR cache. `/services/[id]` drills into one service with more detail.

## Inputs / Outputs / Invariants

- **Input:** Hardcoded `SERVICES` manifest in `src/lib/services.ts`. Live health/version/metrics fetched from each service's backend URL.
- **Output:** Dashboard cards, aggregated status JSON, per-service detail page.
- **Invariants:**
  - Health checks are fetched in parallel (not sequential) — total latency ≈ slowest service, not sum.
  - `/api/status` returns all 5 statuses within 2 seconds (parallel fetch with 5s per-service timeout).
  - `/api/status` uses ISR with 60-second revalidation.
  - Feathers is shown as "CLI — see PyPI" since it has no hosted backend.
  - A service that fails health check shows as "unhealthy" with the error — never crashes the dashboard.

## Enumerated Test Cases

### Happy path
1. `/dashboard` renders 5 service cards with name, role, tags.
2. Each card (except feathers) shows a health indicator (green/red/yellow).
3. `/api/status` returns JSON with all 5 service statuses, each with `id`, `healthy`, `version`, `latencyMs`.
4. `/api/status` fetches all services in parallel — total response time < 2s when all healthy.
5. `/services/paper-trail` renders the detail page with repo link, backend URL, frontend URL, health, metrics.
6. Feathers card shows "CLI — see PyPI" badge instead of health indicator.
7. `/api/status` response is cached for 60s (ISR).

### Edge / failure cases
8. A service returning non-200 on `/health` shows as unhealthy on dashboard — other cards still render.
9. A service timing out (>5s) shows as "timeout" — doesn't block other services.
10. `/services/nonexistent` returns 404.
11. All services down — dashboard shows 5 red cards, no crash.
12. `/api/status` when all services are down still returns 200 with each marked unhealthy.

### Security
13. `/dashboard` and `/services/[id]` require authentication (any role).
14. `/api/status` and `/api/health` are public (no auth required).

## Acceptance Criteria

- [ ] `/dashboard` renders 5 cards with live health
- [ ] `/api/status` aggregates health in parallel, <2s
- [ ] `/services/[id]` detail page
- [ ] ISR 60s caching on `/api/status`
- [ ] Graceful handling of unhealthy/unreachable services
- [ ] All 14 test cases have passing tests
