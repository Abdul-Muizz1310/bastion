# Why Bastion

## The obvious version

A portfolio landing page with links to five projects. Maybe a grid of cards, each with a description and a "View Project" button. Static, no backend, deployed in an afternoon. You could add thumbnails, maybe a dark theme, and call it done. Every developer portfolio looks like this because it works — but it proves nothing about how the projects relate to each other or whether they function as a system.

## Why I built it differently

Bastion is the control plane that proves the five services actually work together, not just independently. Instead of a static landing page, it is a full-stack Next.js 16 application with its own auth system (HMAC-sealed session cookies, magic links via Resend), RBAC with three roles, an append-only audit log with time-travel replay, and an API gateway that mints Ed25519-signed JWTs to call downstream services.

The integrated demo runs a cross-service workflow through the gateway — scrape, sign, debate, analyze, audit — proving distributed tracing and failure isolation across the entire platform. Every gateway call carries a unique `requestId` that threads through all five services and lands in the audit log, so you can trace a single request from browser click to downstream response.

I chose append-only events over mutable state because an audit log you can edit is not an audit log. The `events` table is append-only at the database level: `UPDATE`, `DELETE` and `TRUNCATE` are revoked from `PUBLIC` and blocked by `BEFORE`-triggers that raise `insufficient_privilege`, so even the table owner — which is the role the app connects as — cannot rewrite history. Time-travel replay uses `DISTINCT ON (entity_type, entity_id) WHERE created_at <= $T` to reconstruct state at any past moment. This is the same pattern production audit systems use, and it means the demo data is also the proof that the demo ran.

I chose Server Actions over a separate API because splitting bastion into two repos would add deployment complexity without adding architectural signal. The entire backend is Server Actions and route handlers, with middleware doing route-level authentication gating, which is how Next.js 16 is meant to be used.

## What I'd change if I did it again

Authorization is spread across three shapes: `requireRole()` at the page layer, `withRole()` inside Server Actions, and inline role comparisons where a query is *scoped* to the actor rather than blocked (a viewer only sees their own audit events). The middleware deliberately does none of it — it only authenticates. In a production system with more roles, I would extract a policy engine (something like Cedar or Open Policy Agent) instead of inlining role arrays. The current approach is correct for three roles but would get brittle at ten. I would also add WebSocket-based live tailing for the audit log instead of polling, so the time-travel view updates in real time during the demo.
