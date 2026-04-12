<p align="center">
  <img src="assets/demo.gif" alt="demo" width="720"/>
</p>

<h1 align="center">Bastion</h1>
<p align="center">
  <em>Control plane + identity + audit + integrated demo runner for the muizz-lab portfolio</em>
</p>

<p align="center">
  <a href="https://bastion-six.vercel.app">Live Demo</a> •
  <a href="WHY.md">Why</a> •
  <a href="docs/ARCHITECTURE.md">Architecture</a> •
  <a href="docs/DEMO.md">Demo Script</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/Abdul-Muizz1310/bastion/ci.yml" alt="ci"/>
  <img src="https://img.shields.io/github/license/Abdul-Muizz1310/bastion" alt="license"/>
</p>

---

## What it does

Bastion is the single entry point to a portfolio of 5 microservices. It provides a service registry with live health checks, an integrated demo that runs a cross-service workflow through an API gateway, an append-only audit log with time-travel replay, and a full auth system with RBAC.

## The unique angle

- **Not a landing page** — a full-stack control plane that proves services work *together*, not just independently
- **Append-only audit at DB level** — `INSERT` only grant on the events table; no `UPDATE` or `DELETE` even if app code is compromised
- **Time travel** — `DISTINCT ON` replay reconstructs entity state at any past timestamp
- **Ed25519 JWT gateway** — bastion mints short-lived tokens; each downstream backend verifies independently
- **11-item security checklist** — RBAC, CSRF double-submit, rate limiting, CSP, httpOnly cookies, no PII in cookie payload

## Quick start

```bash
git clone https://github.com/Abdul-Muizz1310/bastion.git
cd bastion
pnpm install
cp .env.example .env.local
# Fill in DATABASE_URL, IRON_SESSION_PASSWORD, etc.
pnpm dev
```

## Architecture

```
Browser → Next.js App Router
  ├── Middleware (route-level auth)
  ├── Pages (login, dashboard, audit, time-travel, run, whoami)
  ├── Server Actions (auth, RBAC, CSRF)
  ├── API Gateway (/api/proxy → downstream services)
  └── Drizzle ORM → Neon Postgres (4 tables, append-only events)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full Mermaid diagram.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions) |
| Auth | iron-session HMAC-sealed cookies, magic link via Resend |
| RBAC | 3 roles (admin/editor/viewer), middleware + withRole() |
| DB | Neon Postgres via Drizzle ORM |
| Rate limit | Upstash Redis sliding window |
| JWT | Ed25519 via jose |
| Lint/Format | Biome |
| Tests | Vitest (68 unit, 96 integration deferred) |
| Deploy | Vercel |

## Deployment

Deployed on Vercel at [bastion-six.vercel.app](https://bastion-six.vercel.app).

## License

MIT
