# Spec 15 — Gateway proxy route

## Purpose

Implement the generic gateway at `src/app/api/proxy/[service]/[...path]/route.ts`. This is the **single outbound path** from bastion to every downstream service (magpie, inkprint, paper-trail, slowquery). It:

1. Authenticates the request (session must be valid).
2. Rate-limits per session (60 req/60s using the existing `gatewayLimiter`).
3. Resolves the service ID to a backend URL via `resolveService()`.
4. Mints a short-lived Ed25519 JWT via `mintPlatformJwt()` (60s TTL, includes `sub` = user id, `role`, `service`, `kid`).
5. Forwards the request to `${service.backendUrl}/${path.join('/')}${search}` with `Authorization: Bearer <jwt>`, `X-Request-Id`, `X-Platform-Key-Id`. **Does NOT forward** client `Authorization` or `Cookie` headers.
6. Pipes the downstream response (status, headers, body) back to the client.
7. Appends exactly **one** audit event per call with action `gateway.proxy.ok` or `gateway.proxy.error`, service, status, latency, requestId, actorId.
8. Maps downstream errors: 5xx → 502, network timeout → 504, JWT minting failure → 500 (generic, no stack leak).

This spec implements the **proxy route handler** only. The existing `src/lib/gateway/jwt.ts` and `src/lib/gateway/services.ts` already provide `mintPlatformJwt`, `resolveService`, `parseRequestId`. The spec for those modules is already in `09-gateway.md`.

## Contract

**File:** `src/app/api/proxy/[service]/[...path]/route.ts`

Exports: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (all five methods pointing at one shared handler).

**Route params** (Next 16 async): `{ service: string; path: string[] }`.

**Runtime:** Node.js (default). **NOT** edge runtime — we need `node:crypto` for JWT signing via `jose`, and the in-process `getDb()` client for audit writes.

## Enumerated test cases (must exist before implementation)

### Pass cases (happy path)

1. **Forward GET to known service** — `GET /api/proxy/magpie/api/scrape/hackernews/top` → calls `https://magpie-backend.onrender.com/api/scrape/hackernews/top` with Bearer JWT. Downstream returns `200 {items: [...]}`; proxy returns status `200` with body verbatim.

2. **Forward POST with JSON body** — `POST /api/proxy/inkprint/certificates` body `{text: "x"}` → calls inkprint backend with same body + Bearer JWT + Content-Type preserved. Downstream `201 {certificate_id: "..."}`; proxy returns `201` with body.

3. **Query string preserved** — `GET /api/proxy/slowquery/_slowquery/api/queries?since=2026-04-18T00:00:00Z` → target URL includes `?since=...`.

4. **Catch-all path joined with slashes** — `path: ["api", "scrape", "hackernews", "top"]` → `/api/scrape/hackernews/top` in target URL.

5. **`X-Request-Id` propagated** — if request has `X-Request-Id: abc-123`, proxy forwards the same value in the outgoing request. If missing, proxy generates a UUID and forwards it.

6. **`X-Platform-Key-Id` header added** — outgoing request includes `X-Platform-Key-Id: <BASTION_KEY_ID>` so downstream knows which pub key to verify with.

7. **JWT `sub` = session user id, `role` = session role, `service` = service id** — minted JWT's claims match.

8. **Audit event written on success** — exactly one `appendEvent` call with `action: "gateway.proxy.ok"`, `entityType: "proxy"`, `entityId: "<service>:<path>"`, `service: <serviceId>`, `requestId`, `actorId`, `metadata: {status: 200, latencyMs: <number>}`.

### Fail cases (edge and error)

9. **Unknown service ID** — `GET /api/proxy/fake/anything` → 404 JSON `{error: "Unknown service"}`. No downstream call. Audit event action `gateway.proxy.error` with `metadata.reason: "unknown_service"`.

10. **CLI-only service (empty backendUrl)** — `GET /api/proxy/feathers/anything` → 404 JSON `{error: "Service has no backend"}`. No downstream call.

11. **Unauthenticated (no session cookie)** — middleware catches first and returns 401, but if the route handler is hit directly (unit test with no session), it also returns 401 JSON `{error: "Unauthorized"}`. Defense in depth.

12. **Invalid session cookie (forged HMAC)** — `getSession()` returns null → 401.

13. **Rate limit exceeded** — `gatewayLimiter.check()` returns `success: false, retryAfter: 7` → 429 JSON `{error: "Rate limit exceeded", retryAfter: 7}` with `Retry-After: 7` header. Audit event action `gateway.proxy.error`, `metadata.reason: "rate_limited"`.

14. **Downstream 5xx** — downstream returns 500 or 503 → proxy returns 502 `{error: "Bad Gateway"}`. Audit event action `gateway.proxy.error`, `metadata: {downstreamStatus: 500}`.

15. **Downstream 4xx** — downstream returns 400 or 404 → proxy returns the original 4xx status and body verbatim (client errors flow through; only server errors get 502-wrapped).

16. **Downstream timeout / network error** — fetch throws `AbortError` or network error → 504 `{error: "Gateway Timeout"}`. Audit event action `gateway.proxy.error`, `metadata.reason: "timeout"` or `"network_error"`.

17. **JWT minting failure** — `mintPlatformJwt` throws (e.g., missing `BASTION_SIGNING_KEY_PRIVATE`) → 500 `{error: "Internal Server Error"}` (generic, no stack trace in body). Audit event action `gateway.proxy.error`, `metadata.reason: "jwt_mint_failed"`. **Stack must not appear in response body.**

### Security cases

18. **Client `Authorization` header NOT forwarded** — if client sends `Authorization: Bearer some-token`, the outgoing request's Authorization header is the minted JWT, not the client token.

19. **Client `Cookie` header NOT forwarded** — prevents leaking session cookie to downstream services.

20. **Body and query string NOT logged** — `metadata` in audit event contains only `status`, `latencyMs`, and optionally `downstreamStatus` or `reason`. It does NOT contain the request body, response body, or query string. (PII/secret leakage prevention.)

21. **Rate-limit key is the session sid** — not the IP, not the userId. This allows per-session budgets without coupling to user-level patterns.

## Dependencies (already exist)

- `@/lib/gateway/jwt` — `mintPlatformJwt`, `resolveService`, `parseRequestId`
- `@/lib/gateway/services` — `SERVICES` array
- `@/lib/auth/session` — `getSession`, `COOKIE_NAME`
- `@/lib/audit/write` — `appendEvent`
- `@/lib/rate-limit` — `gatewayLimiter`
- `@/lib/validation` — (not needed here; only for types)

## Implementation outline

```ts
// src/app/api/proxy/[service]/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mintPlatformJwt, resolveService, parseRequestId } from "@/lib/gateway/jwt";
import { getSession, COOKIE_NAME } from "@/lib/auth/session";
import { appendEvent } from "@/lib/audit/write";
import { gatewayLimiter } from "@/lib/rate-limit";

const TIMEOUT_MS = 30_000;
const KEY_ID = process.env.BASTION_KEY_ID ?? "bastion-ed25519-2026-04";

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ service: string; path: string[] }> },
) {
  const { service: serviceId, path } = await params;
  const requestId = parseRequestId(request.headers.get("x-request-id"));
  const start = Date.now();

  // 1. Auth
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve
  let service;
  try {
    service = resolveService(serviceId);
  } catch {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId: `${serviceId}:${path.join("/")}`,
      service: serviceId,
      requestId,
      metadata: { reason: "unknown_service" },
    });
    return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  }

  // 3. Rate limit (keyed by session sid)
  const rl = await gatewayLimiter.check(session.sid);
  if (!rl.success) {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId: `${serviceId}:${path.join("/")}`,
      service: serviceId,
      requestId,
      metadata: { reason: "rate_limited" },
    });
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  // 4. Mint JWT
  let jwt;
  try {
    jwt = await mintPlatformJwt({
      sub: session.user.id,
      role: session.user.role,
      service: serviceId,
    });
  } catch {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId: `${serviceId}:${path.join("/")}`,
      service: serviceId,
      requestId,
      metadata: { reason: "jwt_mint_failed" },
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  // 5. Forward
  const targetUrl = `${service.backendUrl}/${path.join("/")}${request.nextUrl.search}`;
  const forwardHeaders = new Headers();
  for (const [k, v] of request.headers.entries()) {
    const lower = k.toLowerCase();
    if (lower === "cookie" || lower === "authorization" || lower === "host") continue;
    forwardHeaders.set(k, v);
  }
  forwardHeaders.set("authorization", `Bearer ${jwt}`);
  forwardHeaders.set("x-request-id", requestId);
  forwardHeaders.set("x-platform-key-id", KEY_ID);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let downstream: Response;
  try {
    downstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId: `${serviceId}:${path.join("/")}`,
      service: serviceId,
      requestId,
      metadata: { reason: isAbort ? "timeout" : "network_error" },
    });
    return NextResponse.json({ error: "Gateway Timeout" }, { status: 504 });
  }
  clearTimeout(timer);

  const latencyMs = Date.now() - start;

  // 6. Handle downstream 5xx as 502
  if (downstream.status >= 500) {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId: `${serviceId}:${path.join("/")}`,
      service: serviceId,
      requestId,
      metadata: { status: 502, downstreamStatus: downstream.status, latencyMs },
    });
    return NextResponse.json({ error: "Bad Gateway" }, { status: 502 });
  }

  // 7. Pass through (2xx or 4xx)
  await appendEvent({
    actorId: session.user.id,
    action: "gateway.proxy.ok",
    entityType: "proxy",
    entityId: `${serviceId}:${path.join("/")}`,
    service: serviceId,
    requestId,
    metadata: { status: downstream.status, latencyMs },
  });

  // Build response — copy headers except host, transfer-encoding
  const responseHeaders = new Headers();
  for (const [k, v] of downstream.headers.entries()) {
    const lower = k.toLowerCase();
    if (lower === "transfer-encoding" || lower === "content-encoding") continue;
    responseHeaders.set(k, v);
  }
  responseHeaders.set("x-request-id", requestId);

  return new NextResponse(downstream.body, {
    status: downstream.status,
    headers: responseHeaders,
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
```

## Non-goals for Block 1

- CSRF check on the proxy route (already handled by middleware + same-site cookies). Block 3 adds explicit CSRF double-submit for mutation routes.
- Response body transformation, filtering, or replay.
- Streaming responses from downstream to client (we pass the body stream through, but not SSE-aware multiplexing — that's Block 7's dossier stream).
- Platform JWT verification on downstream services — each downstream service implements its own verification using the public key at `/api/public-key`.

## Rollback

Single file addition. If it breaks anything, `rm src/app/api/proxy/[service]/[...path]/route.ts` + `rm tests/unit/app/api/proxy/[service]/[...path]/route.test.ts` restores the baseline.
