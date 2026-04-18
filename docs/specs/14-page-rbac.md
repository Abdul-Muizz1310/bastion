# Spec 14 — Page-level RBAC

## Purpose

Lift RBAC from *declared but unenforced comments in middleware* (`_ADMIN_ONLY`, `_ADMIN_EDITOR`) to *actually enforced per-page with Next 16 error helpers*. `proxy.ts` already handles auth-level rejection (session missing → redirect `/login`). This spec handles **role-level** enforcement (session present but wrong role → render styled 403).

## Contract

### New helper in `src/lib/auth/rbac.ts`

```ts
export async function requireRole(
  requiredRoles: Role[],
  action: string,
): Promise<HydratedSession>;
```

- Reads the bastion session cookie via `cookies()` (async in Next 16).
- Calls `getSession()` to hydrate.
- If no valid session → calls Next 16's `unauthorized()` (throws special error → renders `unauthorized.tsx`).
- If role mismatch → writes audit event `security.denied` via `appendEvent()`, then calls `forbidden()` (throws special error → renders `forbidden.tsx`).
- On success → returns the `HydratedSession` so the caller can use `session.user.id`, `role`, etc.

Existing `withRole()` (takes a pre-hydrated user) stays — it remains the right tool for Server Action enforcement where the caller already has the session object. `requireRole()` is the page-layer convenience that wraps cookie reading + redirect behavior.

### New pages

- `src/app/(app)/unauthorized.tsx` — renders when `unauthorized()` is thrown. Shows "Session required" terminal-styled panel with a "Sign in" button linking to `/login?returnTo=<current-path>` (the path is provided via `headers()` reading the original URL).
- `src/app/(app)/forbidden.tsx` — renders when `forbidden()` is thrown. Shows "Access denied" terminal-styled panel with role info (required vs current) and a "Back to dashboard" link.

These must follow the existing terminal aesthetic: PageFrame + TerminalWindow, violet accent, monospace, grid+scanline backgrounds. No shadcn primitives that aren't already in use.

### Protected routes (applied in this block)

| Route | Required roles | Action audit string |
|---|---|---|
| `/time-travel` | `admin` only | `time-travel.view` |

Other pages (`/run`, `/audit`, `/dossiers/[id]`) are NOT gated in Block 3 — they're being replaced or heavily rewritten in Blocks 9 / 10 / 8 respectively, and those blocks will call `requireRole()` as part of their implementation. This block establishes the pattern + one canonical example.

## Test cases

### `requireRole()` unit tests (new — `tests/unit/lib/auth/rbac.test.ts` extension)

Pass:
1. valid session + matching role → returns `HydratedSession`
2. valid session + role in list of allowed roles → returns session (admin in `["admin","editor"]`)

Fail:
3. no session cookie → calls `unauthorized()` (a throw)
4. invalid session cookie → `unauthorized()`
5. expired session → `unauthorized()` (getSession returns null)
6. valid session but role not in allowed list → calls `appendEvent` with `security.denied` then `forbidden()`
7. valid viewer trying to access admin route → `appendEvent` logs denial, `forbidden()` is thrown

Defense-in-depth:
8. after a successful `requireRole`, the returned session is **live** — not cached (next call re-reads cookie)

### `/time-travel` page gating (update `tests/unit/app/(app)/time-travel/page.test.tsx`)

9. renders normally when session is admin
10. throws `forbidden()` when session is editor (test captures the call, doesn't render)
11. throws `forbidden()` when session is viewer
12. throws `unauthorized()` when no session cookie

### `forbidden.tsx` / `unauthorized.tsx` render tests

13. `forbidden.tsx` renders with "access denied" text, required role, back-to-dashboard link
14. `unauthorized.tsx` renders with "session required" text, sign-in link (includes returnTo)

## Non-goals in Block 3

- Gating `/run` (replaced in Block 9 by the dossier console, gated there).
- Gating `/audit` (rewritten in Block 10, gated there).
- Admin keys page (`/admin/keys`) doesn't exist yet.
- Viewer-sees-own-events logic for audit — Block 10.

## Sub-step ordering

1. **3.1** — spec (this doc). Done.
2. **3.2** — extend `rbac.ts` with `requireRole()` + red tests → impl → green.
3. **3.3** — create `forbidden.tsx` + `unauthorized.tsx` with render tests → green.
4. **3.4** — apply `requireRole()` to `/time-travel` + update its test → green.
5. **3.5** — full `pnpm test`, `pnpm lint`, `pnpm build`.
