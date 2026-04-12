# 09 — API Gateway (Proxy + JWT + Request ID)

## Goal

Implement an API gateway at `/api/proxy/[service]/[...path]` that proxies authenticated requests to downstream services. Each proxied request gets a freshly minted Ed25519-signed JWT (`X-Platform-Token`) and a propagated request ID (`X-Request-Id`). Demonstrates microservice auth delegation and distributed tracing.

## Inputs / Outputs / Invariants

- **Input:** Authenticated request to `/api/proxy/{serviceId}/{path}`. `BASTION_SIGNING_KEY_PRIVATE`, `BASTION_KEY_ID` env vars.
- **Output:** Proxied response from the downstream service, with JWT and request ID injected.
- **Invariants:**
  - JWT is Ed25519-signed, short-lived (60 seconds), contains `{ sub: userId, role, service: serviceId, iat, exp, jti, kid }`.
  - JWT is signed with `BASTION_SIGNING_KEY_PRIVATE`, verifiable with `BASTION_SIGNING_KEY_PUBLIC`.
  - `X-Request-Id` is a UUID generated at the gateway (or propagated if already present in the incoming request).
  - The gateway only proxies to services in the `SERVICES` manifest — no arbitrary URL proxying.
  - Rate-limited per spec 05 (60 req/min per session).
  - Request and response are streamed — gateway doesn't buffer the full body.

## Enumerated Test Cases

### Happy path
1. `GET /api/proxy/paper-trail/health` proxies to `https://paper-trail-backend.onrender.com/health` and returns the response.
2. Proxied request includes `X-Platform-Token` header with a valid Ed25519-signed JWT.
3. JWT contains correct `sub` (user ID), `role`, `service`, `kid`, and has `exp` = `iat + 60`.
4. Proxied request includes `X-Request-Id` header (UUID).
5. If the incoming request already has `X-Request-Id`, it is propagated (not replaced).
6. Response from downstream is returned to the client with original status code and headers.
7. Gateway logs the proxy call as an `gateway.proxy` audit event with service, path, status code, latency.

### Edge / failure cases
8. `GET /api/proxy/nonexistent/health` returns 404 `{ error: "Unknown service" }`.
9. `GET /api/proxy/feathers/anything` returns 400 `{ error: "Service has no backend URL" }`.
10. Downstream service returns 500 — gateway returns 502 with error details.
11. Downstream service times out (>10s) — gateway returns 504.
12. Unauthenticated request to gateway returns 401.

### Security
13. JWT is verifiable using the public key exposed at `/api/public-key`.
14. `/api/public-key` returns the SPKI-encoded public key as base64 (public endpoint, no auth).
15. Gateway never proxies to URLs outside the `SERVICES` manifest.
16. Request body is not logged (may contain sensitive data) — only method, path, status, latency.

## Acceptance Criteria

- [ ] `/api/proxy/[service]/[...path]` route handler
- [ ] Ed25519 JWT minting with 60s TTL
- [ ] Request ID generation/propagation
- [ ] `/api/public-key` endpoint
- [ ] Proxy restricted to manifest services only
- [ ] All 16 test cases have passing tests
