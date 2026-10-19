# Platform token contract v2

The single source for how every muizz-lab backend authenticates callers. Each backend implements it in
its own copy of the platform module (DR-0006); this file is what every copy must conform to. Design
context: `docs/specs/21-bastion-v2.md` §7. Decision: DR-0033 (supersedes DR-0009; extends DR-0008 and
DR-0030).

## 1. Token

Compact JWS, `alg = EdDSA` (Ed25519), carried in `X-Platform-Token` (bastion also sends the same token as
`Authorization: Bearer`; backends read `X-Platform-Token` first, then a Bearer token).

| Claim | Value |
|---|---|
| header `kid` | the issuer's key id (bastion: `BASTION_KEY_ID`, default `bastion-ed25519-2026-04`) |
| `iss` | `"bastion"`, or `"<product>-frontend"` for a DR-0030 frontend |
| `aud` | the receiving service's id (string, exactly one) |
| `service` | the same service id (kept for older readers) |
| `sub` | bastion: the visitor pseudonym `v_xxxxxxxxxx` or `"bastion"`; a frontend: `"<product>-frontend"` |
| `role` | bastion: the capability grant `viewer` / `editor` / `admin`; a frontend: `"frontend"` |
| `cap` | bastion only: the capability id, e.g. `inkprint.certify` (informational; never trusted for authz) |
| `iat`, `exp` | integers; `exp = iat + 60` |
| `jti` | UUID v4 |

Service ids: `paper-trail`, `magpie`, `inkprint`, `inkthread`, `slowquery` (slowquery-demo-backend),
`feathers-demo`. Each backend's own id is a constant in its code, not configuration.

## 2. Verification (every backend)

A request is **authenticated** iff the token:

1. parses as a compact JWS with `alg == "EdDSA"`;
2. verifies against one trusted key:
   - bastion's key (`BASTION_SIGNING_KEY_PUBLIC`, base64 SPKI DER; or fetched from
     `BASTION_PUBLIC_KEY_URL`, JSON field `publicKey`), with `iss == "bastion"`; or
   - the backend's own frontend key (`<PRODUCT>_FRONTEND_SIGNING_KEY_PUBLIC`), with
     `iss == "<product>-frontend"` and `role == "frontend"`;
3. has `aud == <own service id>` (a list `aud` is rejected);
4. has `exp` and `iat`, valid with **10 s leeway** (`exp + 10 > now`, `iat - 10 <= now`), and
   `exp - iat <= 300`.

A token signed by a frontend key but claiming `iss == "bastion"` (or the reverse) is rejected: the key
decides which `iss` is allowed, not the claim.

**Missing vs invalid.** A present token that fails any check ⇒ `401` with
`{"detail": "invalid_platform_token"}` and a WARNING log naming the failed check (never the token). A
missing token ⇒ `401` `{"detail": "missing_platform_token"}`, unless `DEMO_MODE=true`, in which case the
request proceeds as anonymous with a WARNING log. `DEMO_MODE` defaults to `false`. No trusted key configured
⇒ every non-public route answers `503 {"detail": "platform_auth_unconfigured"}` (fail closed), except
under the test settings.

**Public routes** (never require a token): `/health`, `/version`, `/docs`, `/redoc`, `/openapi.json`,
`/metrics` (keeps its own bearer), plus each backend's verification surfaces:
- inkprint: `GET /certificates/{id}`, `/certificates/{id}/manifest`, `/qr`, `/download`, `POST /verify`,
  `POST /verify/batch`, `GET /public-key.pem`;
- paper-trail: `GET /debates/{id}/transcript.json`, `GET /debates/{id}/transcript.md`,
  `GET /platform/receipt-public-key`;
- slowquery-demo: the read-only seeded commerce routes (`GET /users…`, `/products…`, `/orders…`,
  `/order_items`).

**Roles.** Only feathers-generated services gate on `role` (rank viewer < editor < admin; `frontend`
ranks as viewer). Other backends authenticate only.

**Rate limiting.** A request authenticated with **bastion's** key keys its bucket on `"bastion:{sub}"`
(`sub` is the visitor pseudonym). A request authenticated with a **frontend** key keys on
`"{iss}:{leftmost X-Forwarded-For}"` — a frontend's `sub` is constant, so keying on it would put every
visitor of that site in one bucket; its proxy forwards exactly one client address, which it sets itself.
An unauthenticated request keys on the leftmost `X-Forwarded-For` address (uvicorn runs with
`--proxy-headers --forwarded-allow-ips='*'` behind Render). *(Amended 2026-10-20: the first draft keyed
every authenticated request on `iss:sub`.)*

**CORS.** Allowed request headers include `x-platform-token`, `x-request-id`, `content-type`.

## 3. Conformance tests (each backend copies these)

1. valid bastion token, `aud` = own id ⇒ authenticated
2. `aud` = another service's id ⇒ 401 invalid
3. `aud` missing ⇒ 401 invalid; `aud` as a list ⇒ 401 invalid
4. `iss` = `"bastion"` but signed with the frontend key ⇒ 401 invalid
5. frontend-key token with `role != "frontend"` ⇒ 401 invalid
6. expired 5 s ago ⇒ authenticated (leeway); expired 15 s ago ⇒ 401 invalid
7. `iat` 5 s in the future ⇒ authenticated; 15 s in the future ⇒ 401 invalid
8. `alg` = `none` or `HS256` ⇒ 401 invalid
9. tampered payload ⇒ 401 invalid
10. no token, `DEMO_MODE=false` ⇒ 401 missing; no token, `DEMO_MODE=true` ⇒ proceeds, WARNING logged
11. present-but-invalid token with `DEMO_MODE=true` ⇒ still 401 invalid
12. no trusted key configured (non-test settings) ⇒ 503 on a protected route, 200 on `/health`
13. every public route answers without a token
14. rate-limit key is `bastion:{sub}` for a bastion token and `{iss}:{forwarded address}` for a frontend
    token (two visitors through the same frontend land in different buckets)

## 4. Minters

bastion (`src/platform/gateway/token.ts` in v2) and each DR-0030 frontend mint exactly §1. A frontend's
token: `iss "<product>-frontend"`, `aud` = its backend's id, `sub "<product>-frontend"`,
`role "frontend"`, `service` = its backend's id.

Frontend signing keys (Ed25519, PKCS#8 DER base64, server-only env on Vercel; the public half as SPKI
DER base64 on the backend's Render env):

| Frontend | Private (Vercel) | Public (Render) |
|---|---|---|
| magpie-frontend | `MAGPIE_FRONTEND_SIGNING_KEY_PRIVATE` | `MAGPIE_FRONTEND_SIGNING_KEY_PUBLIC` |
| paper-trail-frontend | `PAPER_TRAIL_FRONTEND_SIGNING_KEY_PRIVATE` | `PAPER_TRAIL_FRONTEND_SIGNING_KEY_PUBLIC` |
| inkprint-frontend | `INKPRINT_FRONTEND_SIGNING_KEY_PRIVATE` | `INKPRINT_FRONTEND_SIGNING_KEY_PUBLIC` |
| slowquery-dashboard-frontend | `SLOWQUERY_FRONTEND_SIGNING_KEY_PRIVATE` | `SLOWQUERY_FRONTEND_SIGNING_KEY_PUBLIC` |
| inkthread-frontend | `INKTHREAD_FRONTEND_SIGNING_KEY_PRIVATE` | `INKTHREAD_FRONTEND_SIGNING_KEY_PUBLIC` |

Frontends proxy browser calls through a server route (`/api/backend/[...path]`) that mints a fresh
token per upstream call and forwards `X-Forwarded-For`; streaming responses (SSE) are piped through
unbuffered; binary responses (page PNGs, QR codes, zips) keep their content type.

## 5. Rollout (orchestrated; implementers do not deploy contract-v2 work themselves)

Contract-v2 commits go to a `contract-v2` branch in each repo, pushed so CI runs, **not merged**. The
orchestrator merges in this order: (a) backends (PyJWT rejects an `aud` claim when no audience is
configured, so backends must expect `aud` before minters send it); (b) minters — bastion and the five
frontends; (c) smoke; (d) `DEMO_MODE=false` on every backend; (e) smoke again.
