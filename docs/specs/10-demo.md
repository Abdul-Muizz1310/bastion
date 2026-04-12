# 10 — Integrated Demo Workflow

## Goal

Build the `/run` page that kicks off a cross-service demo workflow in one click. The workflow calls all 4 hosted services (magpie → inkprint → paper-trail → slowquery) via the bastion gateway, streams progress via SSE, and renders the results as artifact cards plus a timeline.

## Inputs / Outputs / Invariants

- **Input:** Admin or editor clicks "Run end-to-end platform demo" on `/run`.
- **Output:** `run_id` returned immediately, SSE stream at `/api/runs/[run_id]/stream` delivers step updates, final render shows 3 artifact cards + timeline.
- **Invariants:**
  - Every step calls via the bastion gateway (`/api/proxy/[service]/...`), not directly.
  - Each step emits an audit event: `demo.magpie.ok`, `demo.inkprint.ok`, `demo.paper-trail.ok`, `demo.slowquery.ok`, `demo.audit.ok`.
  - All steps share the same `requestId` for cross-service correlation.
  - A failed step marks the run as partial — subsequent steps are skipped, partial results still displayed.
  - SSE stream sends JSON events: `{ step, status, data?, error? }`.

## Workflow Steps (per §9.6)

1. **magpie** — `POST /api/proxy/magpie/api/scrape/hackernews/top` → 1 fresh HN article.
2. **inkprint** — `POST /api/proxy/inkprint/certificates` with article text → signed C2PA certificate.
3. **paper-trail** — `POST /api/proxy/paper-trail/debates` with article title, `max_rounds=3` → transcript.
4. **slowquery** — `GET /api/proxy/slowquery/_slowquery/api/queries?since={run_start}` → slow-query fingerprints.
5. **bastion audit** — fetch events for this `requestId`, render timeline.

## Enumerated Test Cases

### Happy path
1. Clicking "Run" returns a `run_id` and starts the SSE stream.
2. SSE stream emits 5 step events in order (magpie → inkprint → paper-trail → slowquery → audit).
3. Each step event includes `{ step: "magpie", status: "ok", data: {...} }`.
4. Final render shows 3 artifact cards: scraped article + cert link, debate transcript, slowquery snapshot.
5. Timeline shows all cross-service calls with timestamps and latency.
6. All 5 audit events share the same `requestId`.
7. Demo results are persisted (viewable after page reload via run_id).

### Edge / failure cases
8. If magpie fails (service down), run stops at step 1 with `{ step: "magpie", status: "error", error: "..." }`. Partial result displayed.
9. If inkprint fails but magpie succeeded, the magpie result is still shown.
10. Running a demo while another is in progress — second run gets its own `run_id` (no global lock).
11. SSE connection dropped mid-stream — client reconnects and gets remaining events (or polls final state).
12. Viewer role attempting to run demo gets 403 (RBAC enforced).

### Security
13. Demo endpoint requires admin or editor role.
14. All downstream calls go through the gateway (JWT + request ID injected).
15. Demo run events appear in the audit log.

## Acceptance Criteria

- [ ] `/run` page with "Run" button and live progress
- [ ] SSE streaming of step results
- [ ] 5-step workflow via gateway
- [ ] Artifact cards + timeline rendering
- [ ] Graceful partial failure handling
- [ ] All 15 test cases have passing tests
