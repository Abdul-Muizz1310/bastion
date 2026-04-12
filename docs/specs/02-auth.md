# 02 — Authentication (Magic Link + Demo Mode)

## Goal

Implement two authentication flows: (1) magic link via Resend for real email-based auth, and (2) demo-mode bypass buttons that instantly sign in as admin/editor/viewer without email. Demo mode is the primary auth path for portfolio demos; magic links prove the real implementation works.

## Inputs / Outputs / Invariants

- **Input:** Email address (magic link) or role selection (demo mode). `RESEND_API_KEY`, `RESEND_FROM`, `MAGIC_LINK_TTL_MIN`, `DEMO_MODE` env vars.
- **Output:** Authenticated session with signed cookie.
- **Invariants:**
  - Magic link tokens are single-use (consumed on first callback).
  - Magic link tokens expire after `MAGIC_LINK_TTL_MIN` (default 10 minutes).
  - Demo mode buttons only appear when `DEMO_MODE=true`.
  - Demo mode creates/reuses a user with a deterministic email pattern (`demo-{role}@bastion.local`).
  - Both flows end at the same session creation path — no separate session logic.

## Enumerated Test Cases

### Happy path — magic link
1. `POST /login` with valid email sends a magic link via Resend and inserts a `magic_links` row.
2. Magic link URL format: `{SITE_URL}/auth/callback?token={token}`.
3. `GET /auth/callback?token={valid_token}` consumes the token, creates/finds the user, creates a session, redirects to `/dashboard`.
4. After callback, the `magic_links.usedAt` is set to the current timestamp.
5. If the user doesn't exist, callback creates a new user with role `viewer` (default role for magic link signups).

### Happy path — demo mode
6. When `DEMO_MODE=true`, `/login` page renders 3 buttons: "Sign in as Admin", "Sign in as Editor", "Sign in as Viewer".
7. Clicking a demo button creates/reuses a user (`demo-admin@bastion.local`, etc.) and creates a session immediately — no email sent.
8. Demo users have the correct role assigned.

### Edge / failure cases
9. `GET /auth/callback?token={expired_token}` returns 401, does not create a session.
10. `GET /auth/callback?token={already_used_token}` returns 401.
11. `GET /auth/callback?token={nonexistent_token}` returns 401.
12. `GET /auth/callback` with no token parameter returns 400.
13. `POST /login` with invalid email format returns 400 (Zod validation).
14. `POST /login` with empty email returns 400.
15. When `DEMO_MODE=false` (or unset), demo buttons do not render and the demo sign-in Server Action rejects with 403.

### Security
16. Magic link token is cryptographically random (≥32 bytes, URL-safe base64).
17. Rate limit on `POST /login` prevents email spam (handled by spec 05, but auth must respect it).
18. Auth events logged: `auth.magic_link_sent`, `auth.login`, `auth.login_demo`, `auth.logout`.

## Acceptance Criteria

- [ ] `/login` page with email form and conditional demo buttons
- [ ] `/auth/callback` consumes token and creates session
- [ ] Magic link sent via Resend
- [ ] Demo mode bypass works for all 3 roles
- [ ] Single-use, expiring tokens
- [ ] All 18 test cases have passing tests
