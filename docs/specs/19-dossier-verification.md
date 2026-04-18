# Spec 19 — Dossier verification endpoint + verify button

## Purpose

Add `GET /api/dossiers/[id]/verify` and a **Verify Signatures** button on the dossier result page. The endpoint loads the dossier's evidence items, calls inkprint's `POST /verify/batch` (Block 5) for every `certificate_id`, and returns a per-item valid/invalid verdict plus an `overall_valid` rollup.

This closes the "dossier is a tamper-proof artifact" promise: users can re-open a dossier months later and click Verify to confirm every signature still holds.

## Contract

### `GET /api/dossiers/[id]/verify`

- Auth: session required (401 otherwise).
- Dossier must exist (404 otherwise). Viewer role can verify their own dossiers; admin+editor can verify any. 403 for viewer viewing someone else's dossier.
- Reads `evidence_items` for the dossier.
- If no evidence items: returns 200 with `{ overall_valid: null, message: "no_evidence_yet", results: [] }` — idempotent no-op. Ship this case first since evidence-item population isn't wired end-to-end yet; verify becomes meaningful once the pipeline persists cert IDs.
- If items exist: calls inkprint via `lib/gateway/client.ts` (new) — mints an Ed25519 platform JWT and POSTs `{items: [{certificate_id}, ...]}` to `${inkprint.backendUrl}/verify/batch`. Parses the response as `{results: [{certificate_id, valid, checks: {signature, hash, simhash?, embedding?}, reason?}, ...]}`.
- Response shape:
  ```
  {
    dossier_id: UUID,
    overall_valid: boolean | null,
    results: [{ certificate_id, valid, checks, reason? }],
    verified_at: ISO datetime,
  }
  ```
- `overall_valid` = `true` if every `valid === true`, `false` if any `valid === false`, `null` if `results` empty.
- Writes one audit event `dossier.verified.ok` or `dossier.verified.error` with metadata `{total, passed, failed}`.

### `lib/gateway/client.ts` (new)

Generic server-side helper:

```ts
export async function callService<T>(
  serviceId: string,
  path: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    actor: { id: string; role: Role };
    requestId: string;
  },
): Promise<{ ok: boolean; status: number; data?: T; error?: string }>;
```

Resolves the service, mints JWT, fetches, parses JSON, returns typed envelope. Used by the verify endpoint AND future server-side orchestrations. Not the same as the public `/api/proxy/*` route (which has a client-side HTTP round-trip); this is a direct server-to-server call.

### `VerifyButton` client component

- Placed inside the dossier result page, below the StepTimeline.
- Button label: `▸ verify all signatures` initially. On click: POSTs (or GETs — GET is fine since it's idempotent and we're not passing a body from the client) to `/api/dossiers/${id}/verify`.
- While in flight: `verifying…` with pulse-ring.
- After: shows a VerifyBadge per result plus an overall badge (green/red/amber for null).
- Disabled for viewer when viewing someone else's dossier (but the RBAC check is server-side too).

## Enumerated test cases

### `callService` (`tests/unit/lib/gateway/client.test.ts`)

1. Successful call returns `{ok: true, status: 200, data: <parsed JSON>}`.
2. Downstream 4xx returns `{ok: false, status: 404, error: <body error message>}`.
3. Downstream 5xx returns `{ok: false, status: 502, error: "bad_gateway"}`.
4. Network error returns `{ok: false, status: 0, error: "network_error"}`.
5. Timeout (30s) returns `{ok: false, status: 0, error: "timeout"}`.
6. Outgoing request has `Authorization: Bearer <jwt>` and `X-Request-Id`.
7. Unknown service id throws (caught by caller) — programmer error.

### `GET /api/dossiers/[id]/verify`

8. No session → 401.
9. Unknown dossier → 404.
10. Viewer + own dossier + no evidence → 200 `{overall_valid: null, message: "no_evidence_yet", results: []}`.
11. Viewer + other's dossier → 403.
12. Admin + any dossier + no evidence → same 200 empty payload.
13. Admin + dossier with 3 evidence items (all valid) → `overall_valid: true`, 3 results.
14. Admin + dossier with 1 tampered item → `overall_valid: false`, results show which failed.
15. Audit event `dossier.verified.ok` appended on success.
16. Audit event `dossier.verified.error` appended when inkprint returns non-200.

### `VerifyButton`

17. Renders label "verify all signatures" initially.
18. Disabled state applied when `canVerify={false}`.
19. Shows overall-valid badge (green "verified") when response is `overall_valid: true`.
20. Shows red "tampered" badge when `overall_valid: false`.
21. Shows amber "no evidence yet" when `overall_valid: null`.

## Non-goals

- Storing the verify-response — if the user clicks again, it re-queries (cheap enough; ~100ms).
- Integrating with inkprint's batch-cert issuance yet (pipeline still calls single-item `/certificates` per Block 7 scope).
- WebCrypto client-side verification — we trust inkprint's server-side verification and re-check over HTTPS with signed JWT.
