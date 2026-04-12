# 05 — Rate Limiting (Upstash Sliding Window)

## Goal

Rate-limit sensitive endpoints using Upstash Redis sliding window algorithm. Prevents brute-force attacks on auth endpoints and abuse of the API gateway. Returns standard `429 Too Many Requests` with `Retry-After` header.

## Inputs / Outputs / Invariants

- **Input:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Request IP or session ID as the rate limit key.
- **Output:** Request proceeds if under limit, 429 response with `Retry-After` header if over.
- **Invariants:**
  - Auth endpoints (`POST /login`, `/auth/callback`): 10 requests/minute per IP.
  - API gateway (`/api/proxy/*`): 60 requests/minute per session.
  - `/api/csrf`: 30 requests/minute per session.
  - Rate limit state is stored in Upstash Redis, not in-memory (works across Vercel serverless instances).
  - Sliding window — not fixed window — so bursts at window boundaries don't double the effective limit.

## Enumerated Test Cases

### Happy path
1. Request under the limit proceeds normally.
2. Response includes `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers.
3. Different IPs have independent rate limit counters for auth endpoints.
4. Different sessions have independent rate limit counters for gateway.

### Edge / failure cases
5. 11th auth request within 1 minute from the same IP returns 429.
6. 429 response includes `Retry-After` header with seconds until reset.
7. After the window expires, requests succeed again.
8. If Upstash Redis is unreachable, requests are allowed (fail-open) with a warning log.

### Security
9. Rate limit bypass attempt via `X-Forwarded-For` header spoofing is mitigated — use Vercel's `x-real-ip` or `x-forwarded-for` first value only.
10. Rate limit events logged: `security.rate_limited` with IP, endpoint, current count.

## Acceptance Criteria

- [ ] `src/lib/rate-limit.ts` exports rate limiter factory
- [ ] Auth endpoints rate-limited at 10/min per IP
- [ ] Gateway rate-limited at 60/min per session
- [ ] 429 response with `Retry-After` header
- [ ] Fail-open if Redis unreachable
- [ ] All 10 test cases have passing tests
