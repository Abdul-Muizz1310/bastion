# 01 — iron-session Signed Cookies

## Goal

Implement session management using iron-session. Sessions are stored in the database (`sessions` table) but the cookie itself contains only an opaque `{sid}` — never the user object. The cookie is encrypted and signed by iron-session using `IRON_SESSION_PASSWORD`. Session lookup hydrates the full user from the DB on every request.

## Inputs / Outputs / Invariants

- **Input:** `IRON_SESSION_PASSWORD` (≥32 chars), `SESSION_COOKIE_NAME` (default `bastion_session`), `SESSION_TTL_HOURS` (default 24).
- **Output:** `getSession(cookies)` → `{ sid: string } | null`, `createSession(userId, ip, userAgent)` → sets cookie + inserts DB row, `destroySession(sid)` → clears cookie + deletes DB row.
- **Invariants:**
  - Cookie payload is always `{ sid: string }` — never contains role, email, or user data.
  - Session is validated against DB on every request — deleting the DB row invalidates the session immediately.
  - Cookie has `httpOnly`, `secure` (in production), `sameSite: lax`, `path: /`.
  - Expired sessions (past `expiresAt`) are treated as invalid even if the cookie is still valid.

## Enumerated Test Cases

### Happy path
1. `createSession` inserts a row in `sessions` table and returns a sealed cookie.
2. `getSession` with a valid cookie returns `{ sid }` matching the DB row.
3. `getSession` hydrates the full user (id, email, role) from the DB via the session's `userId`.
4. `destroySession` removes the DB row and clears the cookie.
5. Cookie options include `httpOnly: true`, `sameSite: "lax"`, `path: "/"`.
6. In production (`NODE_ENV=production`), cookie has `secure: true`.

### Edge / failure cases
7. `getSession` with no cookie returns `null`.
8. `getSession` with a tampered/invalid cookie returns `null` (iron-session decryption fails).
9. `getSession` with a valid cookie but expired `expiresAt` returns `null` and deletes the stale DB row.
10. `getSession` with a valid cookie but no matching DB row returns `null` (session was destroyed server-side).
11. `createSession` with `IRON_SESSION_PASSWORD` shorter than 32 chars throws at startup.
12. Multiple concurrent sessions for the same user are allowed (different devices).

### Security
13. Cookie payload never contains `email`, `role`, `name`, or any PII — only `sid`.
14. Session cannot be forged without knowing `IRON_SESSION_PASSWORD`.

## Acceptance Criteria

- [ ] `src/lib/session.ts` exports `getSession`, `createSession`, `destroySession`
- [ ] Cookie contains only `{ sid }`, verified by test
- [ ] DB-backed validation on every request
- [ ] Expired sessions rejected
- [ ] All 14 test cases have passing tests
