# Why Bastion

## The obvious version

A portfolio landing page with links to five projects. Maybe a grid of cards, each with a description and a "View Project" button. Static, no backend, deployed in an afternoon.

## Why I built it differently

Bastion is the control plane that proves the five services actually work together, not just independently. Instead of a static landing page, it's a full-stack Next.js application with its own auth system (iron-session signed cookies, magic links via Resend), RBAC with three roles, an append-only audit log with time-travel replay, and an API gateway that mints Ed25519-signed JWTs to call downstream services. The integrated demo runs a cross-service workflow through the gateway — scrape, sign, debate, analyze, audit — proving distributed tracing and failure isolation across the entire platform. I chose append-only events over mutable state because an audit log you can edit is not an audit log. I chose Server Actions over a separate API because splitting bastion into two repos would add deployment complexity without adding architectural signal.

## What I'd change if I did it again

The RBAC middleware and Server Action `withRole()` wrapper duplicate some authorization logic. In a production system with more roles, I'd extract a policy engine instead of inlining role arrays. The current approach is correct for three roles but would get brittle at ten.
