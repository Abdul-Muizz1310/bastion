# Spec 20 — Site metadata, icons, manifest and share card

> **Amended by 21-bastion-v2 (2026-10-20): bastion has no sign-in.** Every page is public, so
> nothing below redirects to `/login` and `proxy.ts` only sets headers. What changed: robots.txt
> disallows `/api/` only; the sitemap lists the public pages (below); the share card reads
> `8 products · 1 signed receipt` over `tools that hand you a receipt.`; page titles follow the v2
> routes (`tests/unit/app/page-titles.test.ts`); the e2e case runs against the stub (spec 21 §10.1).

## Purpose

Give bastion what a browser tab, a search result, a home-screen install and a link preview see:
one validated config drives the `<head>`, the icons, `manifest.webmanifest`, `robots.txt`,
`sitemap.xml` and a 1200×630 share card. Until now the root layout carried a bare
`title: "Bastion"`, the favicon was the stock Next one, and a shared link had no preview.

bastion is session-gated: `proxy.ts` sends every anonymous page request to `/login`. Crawlers
and link-preview bots never carry a session, so the metadata files must be reachable without one,
or every preview would be the login redirect.

## Contract

### One config, parsed when it loads

`src/lib/site/config.ts` defines the site once: the brand name, the default title, the
description, the production origin (`https://bastion-six.vercel.app`), the accent (`#a78bfa`,
the nav's violet), keywords, the share card's copy, and which routes are listed in the sitemap
(`/login`) or disallowed in robots.txt (`/api/`, `/auth/`). Everything below is derived from it.

`defineSite` parses the config when the module loads and throws a `SiteConfigError` on:
- a `url` that is not a URL, is not `https:`, or is not a bare origin (a path or a trailing
  slash);
- a host on the never-use list (`knowledge/infrastructure/infra-never-use-hosts.md` in the
  workspace, which includes the bare `bastion.vercel.app`): strangers own those hosts, and a link
  preview must never point at one;
- a name longer than 12 characters (the manifest's `short_name`), a title longer than 70, or a
  description outside 50 to 160 characters (search results cut longer ones);
- an accent that is not `#rrggbb`;
- a highlight that does not occur in the headline;
- a route that does not start with `/`, or a sitemap route under a disallowed prefix.

A bad config fails the build. It never ships into every link preview.

### The head

The root layout exports `metadata` and `viewport` built from the config:
- `metadataBase` is the production origin, so every image URL is absolute;
- the title has a default and the template `%s — bastion`;
- description, application name, author, keywords, and `formatDetection` off (iOS must not
  turn numbers on a page into phone links);
- Open Graph: `type: website`, the site name and the locale. It has **no** title, description
  or url: Next fills `og:title` and `og:description` from each page's own, and a root `og:url`
  would claim that every page is the home page;
- `twitter:card` is `summary_large_image`. Next fills the Twitter title, description and image
  from Open Graph, so there is no separate `twitter-image`;
- no canonical at the root, for the same reason as `og:url`. The home page sets its own (`/`),
  even though it redirects anonymous visitors to `/login`;
- viewport: `theme-color` `#0a0a0a` and `color-scheme: dark`.

### Page titles

Every page sets a short lowercase title from its own h1 or nav label; the template adds
` — bastion`. Dynamic routes use `generateMetadata` with the id only and never fetch data for it.

| Route | Title |
|---|---|
| `/login` | `sign in` |
| `/dashboard` | `platform services` |
| `/audit` | `audit log` |
| `/audit/[requestId]` | `request <first 8 of requestId>` |
| `/run` | `end-to-end demo` |
| `/time-travel` | `time travel` |
| `/whoami` | `whoami` |
| `/services/[id]` | `service <id>` |
| `/dossiers/[id]` | `dossier <first 8 of id>` |

No page sets `openGraph`, `twitter` or a canonical of its own (a page-level `openGraph` replaces
the root one and drops the share image), and none needs `noindex`: every page but `/login`
redirects an anonymous crawler to `/login` before it sees any content.

### Icons

The icon is the nav's brand tile: the shield glyph in `--accent-violet` on the surface colour,
with a faint accent glow. `src/app/icon.svg` is the source. The rasters are rendered from it:
- `src/app/favicon.ico`: 16, 32 and 48 px (replaces the stock Next favicon);
- `src/app/apple-icon.png`: 180 px, full-bleed, because iOS rounds the corners itself;
- `public/icon-192.png` and `public/icon-512.png` for the manifest, plus
  `public/icon-maskable-512.png`, with the glyph inside the maskable safe zone.

### Manifest, robots, sitemap

- `manifest.webmanifest`: name, short name, description, `start_url` and `scope` `/`,
  `display: standalone`, dark background and theme colours, the three PNG icons.
- `robots.txt`: allow `/`, disallow only the machine endpoints `/api/` and `/auth/`, point at the
  sitemap. Link-preview bots such as Twitterbot obey robots.txt, so a page is never disallowed
  there.
- `sitemap.xml`: the absolute URL of every public page (spec 21 §3), once each: `/`, `/tools`,
  each `/tools/<product>` in the registry's order, `/dossier`, `/audit`, `/time-travel` and
  `/platform`. A page per id (`/d/<id>`, `/audit/<requestId>`) is reached from those, not listed.

### The share card

`opengraph-image` is a 1200×630 PNG rendered at build time with `next/og`: the brand tile, the
name, the `//` comment line (`control plane · identity · audit`), the headline
`one gateway, every call audited.` with `audited` in the accent and underlined, and the live
host. It is set in Geist Mono, vendored as subset TTFs under `src/lib/site/fonts/` with its OFL
licence, because `next/og` cannot read the fonts `next/font` loads.

The headline is set at the largest size, from 96 px down to 48 px in steps of 8, at which it
wraps to at most two lines across the card's 1056 px. Every Geist Mono glyph is 0.6 em wide, so
the wrap is computed exactly, not measured: bastion's headline fits at 96 px (18 columns,
`one gateway, every` / `call audited.`).

### `proxy.ts`: metadata files are public

`proxy.ts` gains an explicit set of **exact** paths that pass through without a session:
`/opengraph-image`, `/icon.svg`, `/apple-icon.png`, `/manifest.webmanifest`, `/robots.txt`,
`/sitemap.xml`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`. Next appends a
`?<hash>` query to icon and image URLs; the pathname, which is what the set matches, is
unchanged. `/favicon.ico` is already outside the matcher. Exact matching means nothing beneath
or beside those paths opens up: `/dashboard` still redirects, and an unknown `/api/*` path still
answers 401.

## Test cases

### `defineSite` (`tests/unit/lib/site/define.test.ts`)

1. Accepts the real config and derives its origin; accepts a valid example config.
2. Rejects each case in "One config, parsed when it loads", naming the reason: a non-URL, an
   `http:` origin, a path, a trailing slash, every never-use host, an empty or over-12 name, an
   over-70 title, an under-50 or over-160 description, a non-`#rrggbb` accent, an empty highlight,
   a highlight missing from the headline, a route without a leading slash, a sitemap route that
   robots.txt disallows.

### Root metadata (`tests/unit/lib/site/metadata.test.ts`, `tests/unit/app/layout.test.tsx`)

3. The root metadata: `metadataBase`, the title template, description, application name,
   author, keywords, Open Graph with no title, description or url, the Twitter card, no
   `alternates`, the Apple web-app title, `formatDetection` off; the root layout exports exactly
   this metadata and viewport.
4. The viewport colours.

### Manifest, robots, sitemap (`tests/unit/lib/site/routes.test.ts`)

5. The manifest's fields, and every icon it lists exists in `public/` at its declared size.
6. robots.txt allows `/`, disallows `/api/`, and names the sitemap on the origin; a site with
   nothing to disallow gets a bare allow rule; the sitemap lists every public page above as an
   absolute URL, once, and no page per id or machine endpoint.

### Icons (`tests/unit/lib/site/icons.test.ts`)

7. `icon.svg` uses the accent, `favicon.ico` holds 16, 32 and 48, `apple-icon.png` is 180×180.

### Share card (`tests/unit/lib/site/share-card.test.tsx`)

8. The headline layout: highlight segments, the greedy wrap, the size chosen at each boundary,
   the real headline at 96 px, the alt text, the rendered card (name, comment, highlight in the
   accent, host) and the two font weights it loads.

### Proxy (`tests/unit/proxy.test.ts`)

9. Without a session, each metadata path above passes through (`NextResponse.next()`),
   including an icon URL carrying Next's `?<hash>` query.
10. The set is exact: without a session `/dashboard` still redirects to `/login`, an unknown
    `/api/x` still answers 401, and a path beneath a metadata path (`/robots.txt/x`) still
    redirects.

### Page titles (`tests/unit/app/page-titles.test.ts`)

11. Each page exports the title in the table above; the dynamic routes derive theirs from the id
    without touching the database; the home page sets only the canonical `/`; no page sets
    `openGraph`, `twitter` or `robots`.

### E2E (`tests/e2e/metadata.spec.ts`, built app, CI only: it needs a real Postgres)

12. Anonymous, `/login` carries the head tags: the title `sign in — bastion`, the description,
    `og:title` `sign in — bastion` (the page's own title flowing into Open Graph), `og:image` and
    `twitter:image` on the production origin, the Twitter card, the theme colour, the SVG and
    Apple icons and the manifest link, and no robots meta; every metadata route answers 200 with
    its content type without a session.

## Non-goals

- Per-page share cards: every page previews with the one card.
- A public landing page: `/` stays a session-gated console that redirects anonymous visitors.
- `noindex` on gated pages: the redirect already keeps their content out of search.
