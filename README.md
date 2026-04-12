<p align="center">
  <img src="assets/demo.gif" alt="demo" width="720"/>
</p>

<h1 align="center">Bastion</h1>
<p align="center">
  <em>Control plane + identity + audit + integrated demo runner for the muizz-lab portfolio</em>
</p>

<p align="center">
  <a href="https://bastion.vercel.app">Live Demo</a> •
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

TODO

## The unique angle

TODO

## Quick start

```bash
pnpm install
cp .env.example .env.local
# Fill in env vars
pnpm dev
```

## Architecture

TODO

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions) |
| Auth | iron-session signed cookies, magic link via Resend |
| DB | Neon Postgres via Drizzle ORM |
| Rate limit | Upstash Redis sliding window |
| Lint/Format | Biome |
| Tests | Vitest |
| Deploy | Vercel |

## Deployment

Deployed on Vercel at `bastion.vercel.app`.

## License

MIT
