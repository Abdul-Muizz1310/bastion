# 11 — Security E2E Checklist (Playwright)

## Goal

Verify the 11-item security checklist from §9.6 acceptance criteria using Playwright end-to-end tests. Each item is a concrete attack scenario that must be defended against, tested with a real browser.

## Security Checklist

Each item below becomes one or more Playwright test cases.

### 1. Tampered cookie → 401
Manually modify the `bastion_session` cookie value in the browser and attempt to access `/dashboard`. Expect redirect to `/login`.

### 2. Stale CSRF token → 403
Capture a CSRF token, invalidate the session, then submit a Server Action with the stale token. Expect 403.

### 3. Auth rate limit
Send 11 login requests within 1 minute from the same IP. The 11th should return 429 with `Retry-After` header.

### 4. Role violation logging
Sign in as viewer, attempt to access `/time-travel`. Verify a `security.denied` event appears in the audit log (sign in as admin to check).

### 5. CSP header
Verify `Content-Security-Policy` header is present on every page response with at least `default-src 'self'`.

### 6. X-Frame-Options: DENY
Verify `X-Frame-Options: DENY` header on every page response.

### 7. HttpOnly cookies
Verify `bastion_session` cookie has `HttpOnly` flag — `document.cookie` in browser JS must not include it.

### 8. No PII in cookie
Decode the cookie value (base64) — verify it does not contain email, name, or role in plaintext.

### 9. CSRF on Server Actions
Submit a Server Action (e.g., demo run) without the CSRF header. Expect 403.

### 10. Gateway rejects unauthenticated
`fetch('/api/proxy/paper-trail/health')` without a session cookie. Expect 401.

### 11. Unknown service in gateway
`fetch('/api/proxy/evil-service/hack')` while authenticated. Expect 404.

## Enumerated Test Cases

1. Tampered cookie → redirected to `/login` (no crash, no data leak).
2. Stale CSRF token on Server Action → 403 response.
3. 11th auth request in 1 minute → 429 with `Retry-After`.
4. Viewer accessing `/time-travel` → redirected + `security.denied` event logged.
5. Response headers include `Content-Security-Policy` with `default-src`.
6. Response headers include `X-Frame-Options: DENY`.
7. `document.cookie` does not contain `bastion_session`.
8. Raw cookie bytes do not contain email/name/role in plaintext.
9. Server Action without CSRF header → 403.
10. `/api/proxy/*` without auth → 401.
11. `/api/proxy/evil-service/hack` with auth → 404.

## Acceptance Criteria

- [ ] All 11 Playwright tests pass
- [ ] Tests run in CI (Playwright job in ci.yml)
- [ ] Each test maps to one checklist item
- [ ] No false positives (tests actually exercise the security boundary, not a mock)
