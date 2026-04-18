# Spec 13 — returnTo-aware auth

## Purpose

When an unauthenticated user tries to open a protected page like `/dossiers/abc123`, they should get bounced to `/login`, then sent **back to the page they tried to open** after successful login. Today the redirect always goes to `/dashboard`, which is jarring and breaks deep-linked shares.

This spec wires a `returnTo` param through:

- `proxy.ts` (middleware) — when redirecting unauth'd users, append `?returnTo=<original-path>`.
- `/login` page — read `returnTo` from URL, thread through the form.
- `sendMagicLinkAction` — accept `returnTo`, pass it into `sendMagicLink`.
- `sendMagicLink` — when `returnTo` is provided, append to the generated magic-link URL.
- `/auth/callback` — if a **safe** `returnTo` is in the query, redirect there after the session is set; otherwise `/dashboard`.
- `demoSignInAction` (guest login shortcut) — accept `returnTo`, redirect there.

## Security (non-negotiable)

`returnTo` is the #1 open-redirect attack vector in apps that don't validate it. The `isSafeReturnTo` check MUST reject:

1. `null` / `undefined` / empty string
2. Strings longer than 512 chars
3. Anything not starting with `/`
4. Anything starting with `//` (protocol-relative — browser treats this as cross-origin)
5. Anything starting with `/\` (Windows-style UNC backslash variant)
6. Anything containing `://` (absolute URL)
7. Anything containing `\r`, `\n`, `\0` (header-injection)
8. Anything containing `@` (`/user@evil.com/foo` can be ambiguous)
9. After `decodeURIComponent` — rules 3–7 must still hold (prevents double-encoded bypasses)

Passing paths: `/`, `/dashboard`, `/dossiers/abc`, `/audit/abc?filter=ok`, `/services/paper-trail`.
Failing paths: `//evil.com`, `https://evil.com`, `//evil`, `/\evil`, `/foo%0d%0a/evil`, absolute URLs, anything with `@`.

## Contract

### New file: `src/lib/auth/return-to.ts`

```ts
export function isSafeReturnTo(raw: string | null | undefined): raw is string;
export function getSafeReturnTo(raw: string | null | undefined, fallback?: string): string;
```

- `isSafeReturnTo` is the type-narrowing predicate (returns `true` only for safe local paths).
- `getSafeReturnTo(raw, fallback = "/dashboard")` returns `raw` if safe, otherwise `fallback`.

### Signature changes (non-breaking — added optional params)

- `sendMagicLink(email: string, returnTo?: string)` — when `returnTo` present AND safe, the generated URL is `${SITE_URL}/auth/callback?token=X&returnTo=<url-encoded>`. Unsafe `returnTo` is silently dropped (not an error — returnTo is advisory).
- `sendMagicLinkAction(formData)` — reads optional `returnTo` from FormData, passes through.
- `demoSignInAction(role, returnTo?)` — after sign-in, redirects to `getSafeReturnTo(returnTo)`.

### Callback route behavior

`GET /auth/callback?token=X&returnTo=<path>`:

1. If `token` missing → redirect `/login` (unchanged).
2. If `consumeMagicLink(token)` returns null → redirect `/login?error=invalid_token` (unchanged).
3. On success: read `returnTo` from query, pass through `getSafeReturnTo(..., "/dashboard")`, redirect there instead of hardcoded `/dashboard`.

### Proxy (middleware) behavior

When redirecting unauth'd page requests:

- Current URL is `/dossiers/abc?x=1` → redirect to `/login?returnTo=%2Fdossiers%2Fabc%3Fx%3D1` (URL-encoded).
- The `returnTo` value included is the request's `pathname + search`. No hash (not sent to server anyway).
- **Ignore unsafe values**: if for some reason the pathname itself is unsafe (shouldn't happen — middleware only sees paths that already routed through Next), just redirect to `/login` without a returnTo.

## Enumerated test cases

### `isSafeReturnTo` / `getSafeReturnTo` (new — `tests/unit/lib/auth/return-to.test.ts`)

Pass (safe):
1. `/` → safe
2. `/dashboard` → safe
3. `/dossiers/abc-123` → safe
4. `/audit?filter=service%3Dmagpie` → safe (encoded = and & OK)
5. `/services/paper-trail` → safe
6. `/a/b/c/d/e` → safe
7. `/path?q=1&r=2` → safe
8. `/path#fragment` → safe (fragment never sent to server)

Fail (unsafe):
9. `null`, `undefined`, `""` → unsafe
10. `//evil.com` → unsafe (protocol-relative)
11. `//evil.com/path` → unsafe
12. `/\\evil.com` (backslash slash) → unsafe
13. `https://evil.com` → unsafe (absolute)
14. `http://evil.com` → unsafe
15. `ftp://evil.com` → unsafe
16. `javascript:alert(1)` → unsafe (no leading `/`)
17. `evil-no-slash` → unsafe (no leading `/`)
18. `/foo@evil.com/bar` → unsafe (`@` ambiguity)
19. `/foo\r\nX-Injected: yes` → unsafe (CRLF)
20. `/foo\nbar` → unsafe
21. `/foo\0null` → unsafe
22. `%2F%2Fevil.com` → unsafe (URL-encoded `//`)
23. `/%2F%2Fevil.com` → unsafe — after decode, becomes `//evil.com` under the leading `/` → reject
24. String of length 513 → unsafe
25. `getSafeReturnTo(unsafeValue)` returns fallback `"/dashboard"`
26. `getSafeReturnTo(safeValue)` returns that value unchanged
27. `getSafeReturnTo(unsafe, "/custom-fallback")` returns `/custom-fallback`

### `sendMagicLink` additions (update `tests/unit/lib/auth/magic-link.test.ts`)

28. `sendMagicLink(email, "/dossiers/abc")` — the URL passed to Resend includes `&returnTo=%2Fdossiers%2Fabc`
29. `sendMagicLink(email, "//evil.com")` — URL does NOT include returnTo (silently dropped)
30. `sendMagicLink(email)` without returnTo — URL is unchanged (backward compat)

### Callback route additions (update `tests/unit/app/(public)/auth/callback/route.test.ts`)

31. Valid token + safe returnTo `?token=X&returnTo=/dossiers/abc` → redirect to `/dossiers/abc`
32. Valid token + unsafe returnTo `?token=X&returnTo=//evil.com` → redirect to `/dashboard`
33. Valid token + no returnTo → redirect to `/dashboard` (backward compat — existing test unchanged)

### Proxy (middleware) additions (update `tests/unit/proxy.test.ts`)

34. Unauth'd request to `/dashboard` → `NextResponse.redirect` with URL containing `?returnTo=%2Fdashboard`
35. Unauth'd request to `/dossiers/abc?x=1` → redirect with `?returnTo=%2Fdossiers%2Fabc%3Fx%3D1`
36. Unauth'd API request (e.g., `/api/proxy/magpie/x`) → 401 JSON (no returnTo needed for API)

### Login form / page additions

37. `/login?returnTo=/dossiers/abc` page renders with a hidden `returnTo` input in the form
38. `sendMagicLinkAction(formData)` with `returnTo` field passes it through to `sendMagicLink`
39. `demoSignInAction("editor", "/dossiers/abc")` redirects to `/dossiers/abc`
40. `demoSignInAction("editor", "//evil.com")` redirects to `/dashboard` (unsafe dropped)

## Sub-step ordering

1. **2.1** — spec (this doc). Done.
2. **2.2** — `return-to.ts` + red tests → impl → green. Self-contained.
3. **2.3** — update `magic-link.ts` signature + red test → impl → green. Uses `isSafeReturnTo`.
4. **2.4** — update callback route + red test → impl → green.
5. **2.5** — update `proxy.ts` + red test → impl → green.
6. **2.6** — update login page, login form, actions.ts + red tests → impl → green.
7. **2.7** — full `pnpm test`, `pnpm lint`, `pnpm build` clean.

## Non-goals

- `lib/env.ts` Zod-validated env (deferred to a separate block — orthogonal cleanup).
- Rate-limit exemption for login + returnTo (existing `authLimiter` already covers this — no change).
- Persisting `returnTo` through multi-tab flows (accepted: if user opens magic link in a different browser, returnTo is lost — that's fine).
