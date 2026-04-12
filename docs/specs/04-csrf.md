# 04 — CSRF Protection (Double-Submit)

## Goal

Protect all state-mutating Server Actions and API routes with double-submit CSRF tokens. A CSRF token is minted per session via `/api/csrf`, stored in a cookie, and must be submitted as a header on every mutating request. Server Actions validate the token before executing.

## Inputs / Outputs / Invariants

- **Input:** Authenticated session, CSRF token from cookie + header.
- **Output:** Request proceeds if tokens match, 403 if mismatch or missing.
- **Invariants:**
  - CSRF token is bound to the session (derived from or associated with `sid`).
  - Token is cryptographically random (≥32 bytes).
  - Both cookie and header must be present and match for mutating operations.
  - GET/HEAD/OPTIONS requests are exempt.
  - `/api/health`, `/api/status`, `/api/csrf` are exempt.

## Enumerated Test Cases

### Happy path
1. `GET /api/csrf` returns a CSRF token and sets it in a cookie.
2. Server Action with matching CSRF cookie + header proceeds normally.
3. API route POST with matching CSRF cookie + header proceeds normally.
4. GET requests to API routes succeed without CSRF token.

### Edge / failure cases
5. Server Action without CSRF header returns 403.
6. Server Action with mismatched CSRF header vs cookie returns 403.
7. API POST without CSRF header returns 403.
8. API POST with expired/rotated CSRF token returns 403.
9. CSRF token from one session cannot be used in another session.

### Security
10. CSRF validation failure logged as `security.csrf_failed` event.
11. Token is not predictable — no sequential or time-based patterns.

## Acceptance Criteria

- [ ] `/api/csrf` endpoint mints tokens
- [ ] `validateCsrf()` helper used in all mutating Server Actions
- [ ] Double-submit pattern enforced (cookie + header match)
- [ ] All 11 test cases have passing tests
