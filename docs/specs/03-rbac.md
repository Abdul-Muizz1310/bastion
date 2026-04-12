# 03 — RBAC (Role-Based Access Control)

## Goal

Enforce the role matrix from §9.6 at two layers: Next.js middleware (coarse route-level gating) and a `withRole()` Server Action wrapper (fine-grained defense in depth). Violations are logged as `security.denied` audit events.

## Inputs / Outputs / Invariants

- **Input:** Authenticated user's role (`admin | editor | viewer`), requested route or action.
- **Output:** Access granted (proceed) or denied (redirect to `/login` or return 403).
- **Invariants:**
  - Middleware blocks unauthenticated access to all routes except `/`, `/login`, `/auth/callback`, `/api/health`, `/api/status`.
  - `withRole(["admin", "editor"])` in a Server Action rejects `viewer` and unauthenticated.
  - Every denial is logged as a `security.denied` event with actor, attempted action, and required role.
  - Role checks are always against the DB-hydrated user, never the cookie payload.

## Role Matrix

| Action | admin | editor | viewer |
|---|---|---|---|
| View service registry (`/dashboard`) | yes | yes | yes |
| View service drill-down (`/services/[id]`) | yes | yes | yes |
| Run integrated demo (`/run`) | yes | yes | no |
| View audit log (`/audit`) | yes | yes | no |
| Time travel (`/time-travel`) | yes | no | no |
| View `/whoami` | yes | yes | yes |
| Change user roles | yes | no | no |
| Restore deleted | yes | no | no |

## Enumerated Test Cases

### Happy path
1. Admin can access all routes and actions.
2. Editor can access `/dashboard`, `/services/[id]`, `/run`, `/audit`, `/whoami`.
3. Viewer can access `/dashboard`, `/services/[id]`, `/whoami`.
4. `withRole(["admin"])` allows admin, rejects editor and viewer.
5. `withRole(["admin", "editor"])` allows both, rejects viewer.
6. `withRole(["admin", "editor", "viewer"])` allows all authenticated users.

### Edge / failure cases
7. Unauthenticated user accessing `/dashboard` is redirected to `/login`.
8. Unauthenticated user accessing `/api/proxy/*` gets 401 JSON response.
9. Viewer accessing `/run` is redirected to `/dashboard` (or shown 403 page).
10. Viewer accessing `/time-travel` is redirected to `/dashboard`.
11. Editor accessing `/time-travel` is redirected to `/dashboard`.
12. `withRole` called with empty roles array rejects everyone (defensive).

### Security
13. Every denial logs a `security.denied` event with: `actorId`, `action` (the attempted route/action), `metadata: { requiredRoles, actualRole }`.
14. Role is always re-read from DB via session lookup — changing a user's role in DB takes effect on next request without re-login.
15. Middleware cannot be bypassed by direct Server Action calls — `withRole` provides defense in depth.

## Acceptance Criteria

- [ ] `src/middleware.ts` enforces route-level auth
- [ ] `src/lib/rbac.ts` exports `withRole` wrapper
- [ ] Role matrix enforced at both layers
- [ ] Denials logged as `security.denied` events
- [ ] All 15 test cases have passing tests
