# Architecture

Bastion is a control plane for five microservices. It is a full-stack Next.js 16 application using Server Actions as the backend layer — no separate API server.

## System overview

```mermaid
flowchart TD
    Browser[Browser] --> MW[Middleware<br>route-level auth gating]
    MW --> Pages[Pages / Server Components<br>login, dashboard, audit,<br>time-travel, run, whoami]
    MW --> SA[Server Actions<br>auth, RBAC, CSRF, mutations]
    MW --> GW[Gateway Proxy<br>/api/proxy/service/path]

    SA --> Session[iron-session<br>HMAC-sealed cookies]
    SA --> Audit[appendEvent]
    SA --> RBAC[withRole]

    Session --> Neon[(Neon Postgres<br>Drizzle ORM)]
    Audit --> Neon

    GW --> JWT[Ed25519 JWT Mint]
    GW --> RL[Upstash Redis<br>Rate Limit]

    GW --> PT[Paper Trail]
    GW --> IP[Inkprint]
    GW --> SQ[Slowquery]
    GW --> MG[Magpie]
    GW --> FT[Feathers<br>CLI only]

    style Browser fill:#0a0a0a,stroke:#2a2a3d,color:#fafafa
    style Neon fill:#12121a,stroke:#a78bfa,color:#fafafa
    style RL fill:#12121a,stroke:#a78bfa,color:#fafafa
```

## Component map

| Component | Purpose | Key files |
|---|---|---|
| Middleware | Route-level auth gating, public path allowlist | `src/middleware.ts` |
| Pages | UI rendering via React Server Components | `src/app/*/page.tsx` |
| Server Actions | Auth, RBAC, CSRF enforcement, all mutations | `src/lib/auth.ts`, `src/lib/rbac.ts`, `src/lib/csrf.ts` |
| Session | HMAC-sealed cookie with DB-backed validation | `src/lib/session.ts` |
| Auth | Magic link request/callback, demo-mode bypass | `src/lib/auth.ts` |
| RBAC | `withRole()` defense-in-depth wrapper | `src/lib/rbac.ts` |
| CSRF | Double-submit token generation and verification | `src/lib/csrf.ts` |
| Rate Limit | Upstash sliding window, fail-open on error | `src/lib/rate-limit.ts` |
| Audit | Append-only event log, `appendEvent()` | `src/lib/audit.ts` |
| Replay | Time-travel query over immutable events | `src/lib/replay.ts` |
| Gateway | JWT minting, request ID injection, service proxy | `src/lib/gateway.ts` |
| Registry | Service manifest, parallel health checks | `src/lib/registry.ts`, `src/lib/services.ts` |
| Demo | End-to-end cross-service workflow runner | `src/lib/demo.ts` |
| Schema | Drizzle ORM table definitions, append-only grant | `src/lib/schema.ts` |
| Validation | Shared Zod schemas for form inputs | `src/lib/validation.ts` |

## Database schema

4 tables on Neon Postgres (`shadow-admin` branch):

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--o{ events : "actor"

    users {
        uuid id PK
        text email
        text name
        enum role "admin | editor | viewer"
        timestamp deletedAt "soft delete"
    }

    sessions {
        uuid id PK
        uuid userId FK
        timestamp expiresAt
        text ip
        text userAgent
    }

    magic_links {
        text token PK
        text email
        timestamp expiresAt
        timestamp usedAt "single-use"
    }

    events {
        bigserial id PK
        uuid actorId FK
        text action
        text entityType
        text entityId
        text service
        uuid requestId
        jsonb before
        jsonb after
        jsonb metadata
        timestamp createdAt
    }
```

## Auth flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Server Action
    participant R as Resend
    participant DB as Neon Postgres

    B->>S: POST magic link request (email)
    S->>DB: INSERT magic_links (token, email, expiresAt)
    S->>R: Send email with callback URL
    R-->>B: Email with /auth/callback?token=xxx
    B->>S: GET /auth/callback?token=xxx
    S->>DB: SELECT magic_links WHERE token AND NOT used AND NOT expired
    S->>DB: UPDATE magic_links SET usedAt = now()
    S->>DB: UPSERT users, INSERT sessions
    S->>B: Set-Cookie (iron-session sealed {sid})
    B->>S: Subsequent requests carry cookie
    S->>DB: SELECT sessions WHERE id = sid AND expiresAt > now()
```

## Gateway proxy

```mermaid
flowchart LR
    A[Client Request<br>/api/proxy/paper-trail/health] --> B[Gateway]
    B --> C[Rate Limit Check<br>60/min sliding window]
    C --> D[Mint Ed25519 JWT<br>60s TTL, requestId]
    D --> E[Proxy to Downstream<br>Authorization: Bearer jwt]
    E --> F[Downstream Service<br>verifies Ed25519 public key]
    F --> G[Response]
    G --> H[Append Audit Event]
    H --> I[Return to Client]
```

## Security invariants

1. Cookie contains only `{sid}` — no PII, no role, no email
2. Middleware gates every non-public route before page rendering
3. `withRole()` enforces authorization inside Server Actions (defense in depth)
4. CSRF double-submit token required on all mutations
5. Rate limiting via Upstash sliding window (10/min auth, 60/min gateway)
6. `events` table has INSERT-only grant — no UPDATE, no DELETE at DB level
7. Gateway JWTs are Ed25519-signed with 60-second TTL
8. Every gateway call gets a unique `requestId` for distributed tracing
9. `httpOnly` + `secure` + `sameSite=lax` on session cookie
10. CSP header blocks inline scripts; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`
11. Magic links are single-use (usedAt timestamp) with 15-minute expiry

## Layering

Bastion enforces strict layering — each concern lives in one module and does not reach across boundaries:

```
Middleware (route gating)
  -> Pages (Server Components, read-only rendering)
    -> Server Actions (mutations, auth + RBAC + CSRF checks)
      -> Session (cookie seal/unseal, DB validation)
      -> Audit (append-only event writes)
      -> Gateway (JWT mint, proxy, rate limit)
        -> Schema (Drizzle ORM, table definitions)
          -> Neon Postgres
```

Controllers (Server Actions) never touch the database directly — they go through `session.ts`, `audit.ts`, or `gateway.ts`. Pages never mutate state. The schema module owns all table definitions and the append-only invariant. Rate limiting and JWT minting are gateway-internal concerns invisible to the rest of the app.
