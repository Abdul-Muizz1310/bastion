# bastion v2 — every product, operated live, chained into one receipt

Status: approved by the owner on 2026-10-20 (direction, scope, access and authority were settled in one
question round; the owner asked for a from-scratch redesign if needed, and for every product, inkthread
and inkgrid included, to be visibly usable). Decision records: DR-0031 to DR-0035.

## 1. Goal

bastion is what the portfolio becomes when its products are combined. A visitor, with no sign-in, can:

1. **Operate each product live** from one place — magpie, inkgrid, inkthread, inkprint, paper-trail,
   slowquery and feathers — and see the receipt each one hands back.
2. **Chain them into a dossier**: a claim checked against web sources and PDFs, where every piece of
   evidence is read exactly or scraped, signed, argued over, measured and bound into one signed envelope.
3. **Verify any dossier later** at a public URL, live, without trusting bastion: every signature and hash
   is re-checked against the service that issued it.

The brand spine holds: *tools that hand you a receipt*. bastion is the receipt of receipts.

## 2. What changes, at a glance

| Area | v1 | v2 |
|---|---|---|
| Access | Magic link, sessions, 3 roles, demo sign-in buttons | **No sign-in.** Visitors are pseudonymous; capability grants replace user roles (DR-0032) |
| Products in bastion | 4 called (magpie, inkprint, paper-trail, slowquery), feathers listed as CLI | **All 8**: each has a live workbench; feathers-demo registered |
| Dossier | 5 steps in one unawaited promise; synchronous 3-round debate without the signed evidence; envelope never called | Durable step machine (DR-0035); PDFs as evidence; debate grounded in the sealed evidence; inkprint envelope; public verification |
| Platform tokens | No `iss`/`aud`; any bastion token accepted by every backend; three backends open in demo mode | Contract v2: issuer- and audience-bound, 10 s leeway, enforced on all six backends (DR-0033) |
| slowquery | One demo backend | Installed in paper-trail, magpie, inkprint and inkthread; a dossier's perf receipt lists the queries it caused (DR-0034) |
| inkgrid | Invisible (inside inkthread) | inkthread exposes inkgrid's tables and verification report; bastion shows them |

Kept from v1: Next.js 16 App Router, Drizzle + Neon (`shadow-admin` branch), Upstash, `jose` Ed25519,
the append-only `events` table with its triggers (DR-0015, DR-0019), time-travel replay (DR-0017), the
truthful CSP (DR-0018), the dark terminal house style.

## 3. Information architecture

| Route | Purpose |
|---|---|
| `/` | Platform map: one line of spine, a live system map (the 8 products as nodes, health as asleep / waking / live, the dossier's data flows as edges), three entry points (run a dossier · open a workbench · read the audit log), and a gallery of finished dossiers. |
| `/tools/[product]` | One workbench per product (§5). Every action goes through the gateway, is rate-limited and budgeted, and lands in the audit log. |
| `/dossier` | Compose: a claim, web sources (magpie source slugs), documents (inkthread samples or an upload ≤ 4 MB), a mode. |
| `/d/[id]` | The dossier: live progress while it runs, then the permanent public receipt (§6.5) with "verify everything". |
| `/audit`, `/audit/[requestId]` | The append-only log of every gateway call, filterable by service and request id; the trace view of one request across services. |
| `/time-travel` | The v1 replay slider over entities (dossiers, capabilities — the gateway calls — and v1's types); §3.2. |
| `/platform` | Registry of the 8 products / 15 repos: services, live commit SHAs, health, the token contract (JWKS, `kid`, the audience per service), today's remaining budgets. |

Removed: `/login`, `/auth/callback`, `/whoami`, `/run`, `/dashboard` (folded into `/platform`), the
forbidden/unauthorized interrupt pages, `/services/[id]` (folded into `/tools/[product]` and `/platform`).

### 3.1 The shell and the home page

**Shell.** Every page has a skip link to `#main`, one primary nav (map · tools · dossier · audit ·
time-travel · platform → `/`, `/tools`, `/dossier`, `/audit`, `/time-travel`, `/platform`) with
`aria-current="page"` on the active entry, and nothing sign-in related (no login, whoami or role).

**System map.** An inline SVG drawn on the server: 8 product nodes with bastion at the centre and
feathers-demo as feathers' generated service. Edges are exactly the dossier's flows: magpie → inkprint,
inkthread → inkprint, inkgrid → inkthread, inkprint → paper-trail, {magpie, inkthread, inkprint,
paper-trail} → slowquery (the services slowquery-detective instruments, §8), feathers → feathers-demo.
Every node is a link to `/tools/<id>` whose accessible name is its name, its health state in words and
its role. Health comes from one client island that polls `GET /api/platform/status` every 30 s.

Invariants and cases:
1. A product's state is the worst of its services' (down > unknown > asleep > live); a product with no
   service (bastion) is live, because bastion is serving the page. Before the first answer every node
   says "checking"; a failed request makes every service-backed node "unknown", never a guess.
2. The state is always written in text beside a glyph; colour is never the only signal.
3. Polls never overlap: the next one is scheduled 30 s after the previous one ends. A hidden tab does
   not poll (each probe can wake a Render service) and catches up once when shown. Leaving the page
   aborts the request in flight.
4. The status body is parsed, not cast; a malformed body or a non-2xx answer counts as a failed request.
5. No edge passes through a node, every edge starts on its source's border and ends on its target's.
6. Reduced motion: no pulsing glyphs and no moving packets on the edges. Motion that starts by itself
   stops within 5 s (WCAG 2.2.2).
7. One shared probe round (Ruling AE): `GET /api/platform/status` reuses a round for 30 s for every
   visitor — Upstash when configured, in-process otherwise — and answers `cache-control: public,
   s-maxage=30`. Requests that arrive while a round runs share it; a failed round is never cached; a
   broken shared store only costs a probe.
8. Legibility: node text and flow labels render at 12 px or more on the narrowest lg screen; every
   text colour token reaches 4.5:1 on background, surface and surface-hover.

**Gallery.** The 6 most recent `succeeded` dossiers, filtered in SQL (`GET /api/dossiers?status=succeeded`,
Ruling AF; an unknown or repeated `status` is a 422), so the gallery fills whenever 6 exist. Each is a
receipt: verdict and confidence, evidence count, documents, products used, a link to `/d/<id>`. No
finished dossier ⇒ an empty state that links to `/dossier`. The database unreachable ⇒ the page still
renders, with the gallery marked unavailable.

**Entry points.** Run a dossier (`/dossier`, with today's remaining debates when the budget store
answers; nothing when it does not) · open a workbench (`/tools`) · read the audit log (`/audit`).

### 3.2 The audit log, time-travel and the platform registry (Task 14)

All three are public and rendered per request. Nothing is scoped to the visitor: everyone reads the
same log (DR-0015's append-only `events`, the receipt behind every other receipt).

**The actor** is written as the event's pseudonym: a visitor id (`v_` + 10 base32) as it is, system
work as `bastion`. A v1 row (no `actor`, an `actor_id`) reads "v1 user" — the uuid is never shown; a
row with neither reads "no actor"; an `actor` of any other shape reads "unrecognised actor" and is
never echoed.

**What an event shows**: its id, time (UTC), actor, service, action, entity and request id, plus
the few *known* fields read from its metadata and checked for shape — the HTTP `status` (an integer
100–599), the duration (`ms`, or v1's `latencyMs`: finite, ≥ 0), a dossier `stage` (one of the
eight) and its `attempt` (a whole number ≥ 1), and an `error` (or v1's `reason`) that is a code
(`^[a-z][a-z0-9_]{0,63}$`; any other error reads "error, detail withheld"). The metadata, `before`
and `after` are never rendered and never sent to the browser whole: they could carry what a
downstream answered (§6.6, Task 13).

**`/audit`.** Newest first, 50 a page, a cursor by id: `?before=<id>` lists the events with smaller
ids, the "older" link carries the smallest id shown, and a "newest" link drops the cursor. One extra
row is read only to know whether anything older exists. Filters, in a GET form that works without
script: `service` (`bastion` or one of the six service ids), `action` (a prefix,
`^[a-z0-9][a-z0-9._-]{0,63}$`, matched literally — `_` and `%` are not wildcards) and `request` (an
exact request id, `^[A-Za-z0-9._:-]{1,128}$`). An empty value is no filter. An unknown parameter, a
repeated one or a malformed value is refused before anything is read: the page names each and why,
and offers "clear filters". Each row links its request id to `/audit/<requestId>` and a dossier
entity to `/d/<id>`. Nothing matches ⇒ "no events match" with the filters named; the database
unreachable ⇒ the page still renders, with the log marked unavailable. The guarantee is stated with
its proof: triggers (`drizzle/0001_append_only_events.sql`, DR-0019) reject UPDATE, DELETE and
TRUNCATE for every role, the owner bastion connects as included; an owner could still drop a
trigger, which is why each dossier's envelope also signs a digest of that dossier's slice of the log
(§6.5) — a later edit to the slice no longer verifies.

**`/audit/[requestId]`** is one request's waterfall across services. A malformed id, or one with no
events, is a 404; the title comes from the id alone. Each event *starts* at `created_at − ms` when it
carries a duration (the gateway logs a call when it ends) and at `created_at` otherwise; rows are
ordered by start, ties by id. Each row shows its start's offset from the request's first start, the
service, the action, the entity (a dossier links to `/d/<id>`), the status and duration when known,
and a bar from start to end on one shared scale (an instant event is a tick). The span runs from the
earliest start to the latest end; a span of 0 puts every tick at 0. More than 500 events ⇒ the first
500, and the page says so. The header names the services touched, the span, the count and — when
the request is a dossier's — a link to that dossier.

**`/time-travel`** is spec 07's slider over the DISTINCT ON replay, over every entity type the log
holds: dossiers, capabilities (one entity per gateway capability: its latest call) and v1's types.
Each entity shows its type, id (a dossier links to `/d/<id>`), service, last action with its known
fields, when, its actor and its request id (linked to the trail); the `after` state is no longer
read. The list narrows by type in the browser, without a query. Empty states say what is true: an
empty log disables the slider ("No audit data yet."), a moment before the first event reads "No
events before this time", a type with nothing at that moment says so. More than 1000 entities ⇒ the
first 1000, said so. Nothing animates.

**`/platform`** is the registry in one place: the 8 products with their 15 repos (GitHub), packages
(PyPI) and live frontends, each linked to its workbench; the 6 services with their live health (the
shared 30 s status, §3.1 invariant 7), version, commit SHA and audience, and bastion's own commit
(`VERCEL_GIT_COMMIT_SHA`) when it is deployed. A SHA links to its commit only when it is 7–40 hex
digits; otherwise it is plain text, and none reads "not reported". Today's budgets come from
`budgetsLeft()`; unavailable ⇒ said, never guessed. The token contract (§7): alg EdDSA, the `kid`
(`keyId()`; a malformed `BASTION_KEY_ID` reads "unreadable", never its value), the JWKS link, issuer
`bastion`, the audience per service (its id), the 60 s TTL and 10 s leeway, the fail-closed rule and
a link to spec 22. The page shows no secret: no private key, salt, token or connection string.

**Redirects.** `/dashboard` → `/platform` and `/services/<product id>` → `/tools/<product id>`, both
permanent (308), so v1 links keep working; any other `/services/<x>` is a 404.

**Read limit (Ruling AL).** The open log's reads are limited per visitor, keyed on the daily
pseudonym, through the shared limiter (fail-open without Upstash, like the other read limits):
`/audit` and `/audit/[requestId]` share an `audit` bucket of 60 a minute, and the time-travel page's
first replay and every Server Action call share a `replay` bucket of 60 a minute. A malformed
request (a refused filter, a malformed request id or timestamp) is turned away before it spends a
read. A spent bucket reads nothing: the pages say "too many reads — try again in N s" and name the
limit; the Server Action answers `{ok: false, error: "rate_limited", retryAfterS, limit}`, which the
slider shows. Every read stays bounded by its own page limit (51, 501, 1001 rows).

Invariants and cases:
1. No query on these pages is scoped by actor; every visitor reads the same rows.
2. Actor display: visitor ⇒ its id; `bastion` ⇒ bastion; v1 ⇒ "v1 user"; neither ⇒ "no actor";
   anything else ⇒ "unrecognised actor".
3. Filters: an unknown, repeated or malformed parameter is refused before any read; `%`, `_` and
   `\` in the action prefix match themselves.
4. Pagination: consecutive pages neither overlap nor skip; "older" appears only when an older event
   exists.
5. Waterfall: rows ordered by start (ties by id); offsets ≥ 0; every bar inside [0 %, 100 %].
6. No page here renders or sends to the browser an event's raw metadata, `before` or `after`.
7. `/platform` renders when the status poll fails (every service "unknown") and when the budget
   store fails; it never contains a secret's value.
8. Past 60 reads a minute a visitor's audit or replay read touches no table, and is said as a
   limit with its wait, never as the log failing.

## 4. The capability layer (bastion)

One module per product under `src/capabilities/<product>/`, each with:

- **Request builders and response schemas** (Zod) — pure; every downstream response is parsed, never cast.
- **A capability table**: `id`, service, method + path, the **grant** minted into the token
  (`viewer` · `editor` · `admin`), a cost class (`free` · `quota` · `llm`), a per-visitor rate limit, and a
  daily budget. The table is data; one gateway function enforces it.

The gateway call (`src/platform/gateway/`) does, in order: resolve capability → check per-visitor rate
limit (Upstash sliding window) → reserve daily budget (Upstash counter, released on a downstream 4xx that
spent nothing) → mint a contract-v2 token (§7) → call with `X-Request-Id` and the visitor's address in
`X-Forwarded-For` → parse the response with the capability's schema → append an audit event
(`gateway.call`, with service, capability, status, latency; never the body) → return a typed result union
(`ok` · `asleep` · `rate_limited` · `budget_exhausted` · `downstream_error` · `invalid_response`).
A visitor has two rate-limit buckets (Ruling AG): free GETs 120 a minute, every other call 30; both
are audited the same way.

**Visitors.** No cookie and no account: the actor is `v_` + the first 10 base32 characters of
`HMAC-SHA256(VISITOR_SALT, ip ‖ UTC date)`. It changes daily, cannot be reversed to an address, and is the
token `sub`, the rate-limit key and the audit actor. System work (the runner) acts as `bastion`.

**Budgets** default low and are configurable by env, because the account's free OpenRouter models are
limited to 50 requests a day across every product: debates 4/day, uploads 3/day, leak scans 10/day,
scrapes 30/day, certificates 200/day. `/platform` and each workbench show what is left today.

A dossier spends exactly one `debate` unit, reserved when it is composed (§6.6; a refused or failed
compose spends none). Its debate stage calls the gateway with a prepaid context
(`CallContext.prepaid: true`): that one call skips the reservation and every release — budgets
only; the rate limits still apply — so the last unit of the day, once composed, still runs its
debate. Only a restart after a failed debate (Ruling T: `failedDebateIds` is not empty) reserves
again, through the gateway as any call does. A prepaid call to a capability with no budget is a
programming error, refused before any side effect.

**Cold starts.** Render's free services sleep after ~15 minutes and take 50–70 s to wake. Health checks
time out at 8 s and report **asleep**, not down; connection refusal or 5xx reports **down**. Workbenches
and the dossier's first stage call `POST /api/platform/wake/[service]` (rate-limited), which holds a
health request open for up to 90 s and reports **waking → live**.

## 5. Workbenches — what each product shows

| Product | Operate | Receipt shown |
|---|---|---|
| magpie | Pick a source, scrape once; browse items; heal history | Item content hashes; self-heal PR links |
| inkgrid | Pick a sample PDF (or an upload): exact tables as cell grids, text, findings | inkgrid's verification report (second-engine agreement) |
| inkthread | The same document as a graph (2D, colour by role), the "why" of any element, the page with the element's box drawn | `graph_hash`; the rule or model behind each element |
| inkprint | Certify text, verify a certificate, diff against a parent, run a leak scan | Certificate (signature, C2PA manifest), verify checks |
| paper-trail | Debate a claim (budgeted), rounds appear as they finish | Transcript hash and Ed25519 signature, checked live |
| slowquery | Fleet view: slowest fingerprints across the four services and the demo; the demo's slow/fast branch switch | EXPLAIN plan and the exact `CREATE INDEX` |
| feathers | The YAML schema that generated feathers-demo; live CRUD on it (create, list, soft-delete, then a 404) | The generated contract: role-gated endpoints, soft delete honoured |
| bastion | Token inspector (the decoded claims of the last call, never the token), JWKS | The audit event for the call |

### 5.1 How a workbench behaves

`/tools` lists the eight workbenches (each with its live health from the shared status poll, what it
operates and the receipt it hands back) and links each to `/tools/<id>`. Each `/tools/<id>` is its
own route module that imports only its own workbench, so a page ships one workbench's code (Ruling
AH); `/tools/[product]` answers any other id with a 404. A page is rendered per request: the
product's name, tagline, the §5 row, then the workbench. Every action is a call to `/api/tools/<capability>` (or `/api/uploads`), so it is
rate-limited, budgeted and audited by the gateway; the browser parses every answer with the
capability's own output schema (`src/capabilities/*`), never a copy of it.

Three capabilities are not tools: `/api/tools/<id>` answers them 404 `not_a_tool`, naming who
calls them, before anything is parsed or called. `inkthread.upload` goes through `/api/uploads`
(its size and type checks); `feathers.deleteUser` only through the soft-delete proof (review fix 1);
`inkprint.envelope` only through the dossier runner (final review): inkprint keeps one envelope per
`dossier_id` and answers 409 to any other bundle for it, so a visitor who sealed first would fail
that dossier's envelope stage for good. Every other capability is safe in a visitor's hands — a
read, or a write that spends the visitor's own budget and binds nothing a dossier owns
(`inkprint.certifyBatch` is `inkprint.certify` N times, one `certify` unit each).

**Wake gate** (Ruling F). On load the gate calls `POST /api/platform/wake/<service>` for each of the
product's services, in parallel. Each service reads *checking* until its wake request starts, then
*waking* with the elapsed seconds counting up, then the wake route's own answer — *live*, *asleep*
(it did not wake within 90 s) or *down*. The 30 s shared status is never used here. A wake request
that fails (no answer, a non-2xx, a body that does not parse) makes the service *unknown*, never a
guessed state; a 429 says when to retry. Actions stay disabled until every service is live; any
other end offers a retry. bastion has no service of its own: its gate is live at once. Only phase
changes are announced to assistive tech, not every second. A call that later meets an asleep
service closes the gate again: every service goes back to waking and the actions stay disabled
until the wake route says live (review fix 2). Ruling AI: the notice names what is being woken —
the gate's own services ("again above"), a routed host woken in the background (a slowquery read
of magpie; a call made from bastion's own page wakes the called service), or nothing at all; two
asleep answers in parallel start one re-wake; a first load that failed runs again once the gate
reopens — at most once per failure (a load the gateway keeps timing out must not loop), after
which its panel shows the failure with a manual retry. A background wake's own answer is kept: when
the wake route refuses it (5 a minute) or it fails, the notice says bastion could not wake the host,
never that it is waking it; slowquery's fleet badges word a routed host the same way, and only the
gate's own host reads as being woken again (review round 4). Every action is held until the gate is
live, a manual retry, a why, a page image and the upload picker's answer included: a control that
can be disabled is, and says why ("This unlocks once the wake above answers live"); one that cannot
(a graph node, a file chosen in an OS dialog that outlived the gate) does nothing but announce why.
A retry reloads only the read that failed and never
clears another result — a retry of magpie's items or heal history keeps the visitor's scrape.

**Budgets.** The page renders with today's budgets (`budgetsLeft()`; unavailable ⇒ none shown) and
re-reads `GET /api/platform/budgets` after every budgeted action. A budgeted action shows its meter
and is disabled when fewer units are left than it spends (feathers' soft-delete proof spends 2);
when the budgets cannot be read the action stays enabled and says so, because the gateway still
enforces them.

**Results and receipts.** Every action's result shows the data and its receipt (`ReceiptCard`) with a
copy button (the receipt as plain text) and the request id linking to `/audit/<requestId>`; list
reads (sources, items, users, recent debates) link their request id to the audit trail. A
failure is said for what it is: *asleep*, *rate limited* (with the wait), *budget spent* (resets
00:00 UTC) are never shown as the product failing; a downstream 4xx shows the product's own status
and reason; an answer in an unexpected shape says so; bastion unreachable says so.

**Per product.**
- *magpie*: sources (`magpie.sources`); for the chosen source, items with their content hashes
  (`magpie.items`), scrape once (budget `scrape`), heal history with each PR link (`magpie.heals`).
- *inkgrid*: a sample (`inkthread.samples`) or an upload (`/api/uploads`, budget `upload`, then
  `inkthread.job` every 3 s until it ends); the reading (`inkthread.reading`): every table as a cell
  grid with its header rows marked, its exact text as Markdown, the findings, and the verification
  report as the receipt. inkgrid has no HTTP surface of its own; the page says in one line that the
  reading is inkthread's, which runs inkgrid on every document.
- *inkthread*: the same document (the inkgrid page links here with `?doc=<id>`) as a graph
  (`inkthread.graph`), laid out with `d3-force` for a fixed number of ticks (deterministic, no
  running animation; at most 400 nodes drawn, with a note when there are more), nodes coloured by
  role group with a text legend, edges by thread family; click or Enter on a node ⇒ its why
  (`inkthread.why`), the why of each of its roles and threads, and the page (`inkthread.page`) with
  the node's regions drawn as boxes. Boxes are PDF points with a top-left origin on the unrotated
  page (inkthread spec 01, 11), drawn in an SVG whose viewBox is the page size, so they scale with the
  image. Receipt: `graph_hash` and provenance; each why names the rule or model behind it.
- *inkprint*: certify (budget `certify`), verify a certificate (its manifest and text, which the
  visitor may alter to watch a check fail), diff against a parent (budget `certify`, Ruling M), leak
  scan (budget `leakscan`, then `inkprint.leakScanStatus` every 3 s until it ends), and the public key.
- *paper-trail*: debate a claim (budget `debate`, 1–3 rounds), then `paper-trail.debateGet` every
  2 s until the debate is done or failed, the rounds shown as they arrive (a 429 waits as long as it
  is told, an asleep answer waits and asks again); or open a recent debate (`paper-trail.list`). The
  receipt is checked live by `GET /api/platform/transcript-check?id=` — one request id for the
  transcript and paper-trail's key — which recomputes `transcript_hash` and verifies the Ed25519
  signature with the published key.
- *slowquery*: the fleet — `slowquery.queries` on each of the five hosts in parallel, merged and
  ranked by p95 (else max, else mean), each host's own state shown — a fingerprint's EXPLAIN plan
  and its exact `CREATE INDEX` (`slowquery.query`), and the demo's branch (`slowquery.branch`,
  `slowquery.switch`).
- *feathers*: `feathers.yaml` as feathers-demo's contract-v2 branch holds it (embedded at build
  time), the contract read from it (each endpoint and its role gate), the users (`feathers.users`),
  create (budget `feathers.write`), and the soft-delete proof: create a user → delete it → read it,
  which must answer 404. The proof runs on the server (`POST /api/platform/feathers-proof`), which
  makes up its own user and deletes only that one; `feathers.deleteUser` is not a tool (review fix 1).
- *bastion*: the token inspector — `GET /api/platform/token-preview?capability=<id>` returns the
  header and the claims bastion would mint for that capability as this visitor, never a signed
  token — with the JWKS; and a free call whose receipt is its audit trail.

**Routes added.**
- `GET /api/platform/budgets` — `{<key>: {limit, left}}` for every budget; dynamic, `no-store`,
  60 a minute per visitor (429 + `retry-after`); the budget store unreachable ⇒ 503
  `budgets_unavailable`.
- `GET /api/platform/token-preview?capability=<id>` — `{header: {alg, kid}, claims, jwks,
  capability}`; a missing or repeated parameter ⇒ 422, an unknown id ⇒ 404, a bad key id ⇒ 503;
  60 a minute per visitor; never signs anything.
- `GET /api/platform/transcript-check?id=<uuid>` — `{debateId, transcriptHash, hash: {state, form},
  signature: {state, detail}}` under one `x-request-id`; the transcript unavailable ⇒ its gateway
  error; the key unavailable ⇒ the signature reads `unavailable`, never a pass; a transcript of
  another debate than the one asked fails both.
- `POST /api/platform/feathers-proof` — JSON only (415 otherwise), 3 a minute per visitor, refused
  (429 `budget_exhausted`) before any call when fewer than 2 `feathers.write` units are left; creates
  `proof-<hex>@example.com`, deletes that id, reads it back, all as the visitor under one request
  id; answers `{verdict: honoured | leaked | incomplete, user, steps: [{step, ok, status, kind,
  detail}], requestId}`.

Invariants and cases:
1. No action — a manual retry included — is enabled before its gate is live, nor a budgeted one
   with too few units left.
2. A failed wake request never crashes the page and never shows a guessed state.
3. Every action result shows a receipt with a copy button and a link to `/audit/<requestId>`; list
   reads link their request id to the audit trail.
4. asleep, rate_limited and budget_exhausted are named as such, never as the product failing.
5. A poll stops at its terminal state, its deadline, or when the visitor leaves; it never overlaps.
6. The graph layout is the same for the same graph; with reduced motion nothing moves at all.
7. A box outside its page is clamped to it; an inverted or non-finite box is not drawn; when the
   page's render is not the page's shape (more than 2 % off — a rotated page) no box is drawn and
   the page says why.
8. The token preview carries no signature, and its iat, exp and jti are labelled illustrative; the
   transcript check never passes what it could not check.
9. No visitor can delete a feathers user other than the one their own proof created, nor seal a
   dossier's envelope.
10. A reading whose table claims more header rows than rows is refused (`invalid_response`); an
    error while rendering a page shows bastion's own error page, never the error's message.

## 6. Dossier v2

### 6.1 Stages

`wake → gather → read → seal → debate → measure → envelope → record`

| Stage | Calls | Output |
|---|---|---|
| wake | `GET /health` on every service the dossier needs, in parallel, up to 90 s | Which services are live |
| gather | magpie `POST /api/scrape/batch` (skipped with no sources) | Web evidence candidates |
| read | inkthread: uploads were started at compose time; poll `GET /jobs/{id}` until done; fetch graph + reading (skipped with no documents) | Passages and tables, with locators |
| seal | inkprint `POST /certificates/batch` over the selected evidence (≤ 12 items) | A certificate per evidence item |
| debate | paper-trail `POST /debates` with `evidence_pool` = the sealed items; poll until done; fetch `transcript.json` | Verdict, confidence, transcript hash + signature |
| measure | `GET /_slowquery/queries?request_id=` on every service the dossier called | Perf receipt (canonical JSON) and its SHA-256 |
| envelope | inkprint `POST /dossiers/envelope` with the cert ids, transcript hash, perf hash and metadata (graph hashes, audit digest) | Envelope id + signature |
| record | Compute the audit digest of the dossier's request id; mark the dossier done | Final status |

**Evidence selection is a pure function** (`selectEvidence(claim, candidates, limit)`): lexical overlap
with the claim (BM25 over word stems), document nodes weighted by role (obligation, condition, quantitative,
definition first) and tables kept whole. Items with an empty URL or title are dropped before the debate,
because paper-trail requires both. Each document item's URL is its bastion permalink
(`/d/[id]#e-<evidence id>`), since inkthread has no per-node link.

### 6.2 The durable runner (DR-0035)

A dossier is rows, not a promise. `dossier_steps` holds one row per stage with `status`
(`pending · running · waiting · ok · error · skipped`), `attempt`, `lease_until`, `not_before`, `output`.

- `POST /api/dossiers/[id]/advance` claims the next runnable stage atomically
  (`UPDATE … WHERE lease_until < now() AND not_before <= now() … RETURNING`), runs **one** stage within a
  240 s budget, records the result and returns. It is idempotent: a second caller finds nothing to claim.
- Stages that wait on a long downstream job (read, debate) start the job once, store its id, and on each
  advance poll it once; if not done they return `waiting` with `not_before = now() + 3 s`.
- Chaining: after a stage finishes, `after()` calls `advance` again with an internal HMAC header. The
  dossier page also calls `advance` whenever the stage it shows has an expired lease, so a run never stalls
  for good, and a crashed invocation is retried when its lease expires (max 3 attempts per stage).
- The chain is registered **before** the stage runs, as a promise handed to `after()` that settles once
  the stage is recorded (Task 15). Each handoff lets go of the next invocation after 10 s, so a stage
  longer than that runs with its caller already gone; Next runs a *function* given to `after()` only when
  the response closes, and a close that already happened never fires again — a chain registered after
  such a stage would be dropped and the dossier would wait for a page to nudge it. A promise is kept alive
  with `waitUntil` and needs no close. Every path settles it, in a `finally`: with the next delay, or
  with nothing to chain (finished, failed, unknown dossier, an error — deciding the delay included).
  Compose and "retry from this stage" hand their first advance to `after()` as a promise too, so a
  client that leaves before the answer is written cannot leave a run unstarted.
- Progress reaches the page through the existing SSE route (polling `dossier_events`, `maxDuration` 300).

### 6.3 Data model (migration on the `shadow-admin` branch)

- `dossiers`: `user_id` becomes nullable; add `visitor` (text). Old rows are untouched.
- `dossier_steps` (new): `(dossier_id, stage)` unique; the state machine above.
- `dossier_documents` (new): dossier id, inkthread document id, sha256, title, kind (sample/upload),
  `graph_hash`, page count.
- `evidence_items`: add `kind` (`web` · `passage` · `table`), `product`, `locator` (jsonb: URL, or
  document id + page + bbox + node id), `excerpt`, `inkprint_hash`; `stable_id` stays the per-dossier key.
- `receipts` (new): dossier id, kind (`certificate` · `transcript` · `perf` · `envelope` · `audit`),
  reference, hash, signature, payload (jsonb). The receipts bundle is a `SELECT` of these.
- `events`: add `actor` (text). `actor_id` stays for history. Sessions and magic-link tables are dropped;
  `users` stays read-only because historic events and dossiers reference it.

### 6.4 Failure behaviour

A stage error is recorded with its downstream status and message, the dossier becomes `failed` at that
stage, and the page offers "retry from this stage" (a new attempt on the same row; earlier receipts are
reused). `budget_exhausted` and `rate_limited` are shown as such, never as a failure of the product.
An asleep service at the wake stage is not an error until 90 s have passed.

### 6.5 The public receipt and verification

`/d/[id]` shows: the claim, verdict and confidence; the evidence table (product, locator, excerpt,
certificate, verify state); the transcript with citations linked to evidence; document excerpts drawn on
their pages; the perf receipt per service with any index suggestion; the envelope; the audit trail.

"Verify everything" (`POST /api/dossiers/[id]/verify`, rate-limited) re-checks live:
1. inkprint `POST /verify/batch` for every certificate with its text;
2. the transcript: fetch `transcript.json`, recompute its hash, check the Ed25519 signature against
   paper-trail's `/platform/receipt-public-key`;
3. the envelope signature against inkprint's `/public-key.pem`;
4. the perf receipt hash and the audit digest, recomputed from bastion's append-only log;
5. each document's `graph_hash`, re-fetched from inkthread (an expired upload is reported as expired,
   honestly, per DR-0029).

Each check is ✓ / ✗ / unavailable with the reason. The bundle downloads as `dossier-<id>.receipts.json`.

**Verification (Task 9).** `POST /api/dossiers/[id]/verify` is public, limited to 5 a minute per visitor,
spends no budget (every capability it calls is free) and runs for at most 120 s. Its calls go through the
gateway as the system actor `bastion`, outside the per-visitor gateway limit (Ruling W). Each run uses its
own request id, never the dossier's, because verification is not part of the dossier's trace. It stores
no result; it appends one `dossier.verified` audit event, as the visitor, with each check's state. It answers `{dossierId, checks}`,
where each check is `{name, state, detail, items?}` and `state` is one of:

- `pass`: recomputed, re-fetched, signature verified, and everything agrees;
- `fail`: something was checked and does not hold, or the issuer answered 404/410 for it;
- `unavailable`: the issuer could not be asked or answered unusably (asleep, 5xx, rate-limited, unexpected
  body). Never a pass. A proven failure elsewhere in the same check still wins;
- `expired`: an inkthread upload whose graph is gone by design (DR-0029).

Signatures are always checked against the key the issuer publishes now, never one carried by the
dossier. What the page shows is bound to what is verified: the dossier's claim, verdict and confidence,
and each evidence row's certificate and excerpt. A receipt the dossier row implies but does not hold is a
`fail` (Rulings Y and AA):

- an `envelope_id` with no envelope receipt;
- certified evidence with no envelope receipt, whatever `envelope_id` says. It is `unavailable` while
  the dossier is still pending or running. For a failed dossier it is `fail` only if its envelope step is
  ok; otherwise `unavailable`, "the dossier failed before sealing" (Ruling AB);
- a succeeded dossier with no perf, audit or transcript receipt;
- a verdict with no transcript;
- a certified evidence row with no certificate receipt.

A check with nothing to verify and nothing implied is omitted.

The row's `status` is parsed at the boundary, because the column is plain text. A status outside
`pending · running · succeeded · failed` is `unknown`. With an unknown status, every rule that asks
whether a receipt is owed fails with "unknown dossier status".

A dossier predates the v2 runner and its receipts only if it has no `dossier_steps` rows, no receipts
**and** no visitor (amended Ruling Z). That is a v1 row, which belongs to a user. It answers
`200 {dossierId, legacy: true, note: "this dossier predates verifiable receipts", checks: []}` and runs
no rule. Every other dossier answers `legacy: false` with every check, including `steps`. So deleting a v2
dossier's step rows cannot pass it off as legacy: `steps` fails with "receipts but no step rows".

| Check | What it does |
|---|---|
| certificates | Driven by the evidence rows. Each certified row needs its receipt, and no two rows may name one certificate. The excerpt the page shows must **equal** what seal stored: the text's first 400 UTF-16 code units after the UTF-8 round trip Postgres applies, so an astral character cut at 400 reads U+FFFD. A shorter prefix, which could drop a qualifier, fails. The text, canonicalised exactly as inkprint does (`canonicalize`), must hash to the receipt's fingerprint, and inkprint's Ed25519 signature over it must verify against `inkprint.publicKey`. `inkprint.verifyBatch` is asked **by id only**: no text, so nothing is re-embedded. It only confirms inkprint still holds the certificate intact. Its own text comparison is fuzzy (simhash, embedding) and is never relied on. |
| transcript | Re-fetch `transcript.json`. The stored copy must hash to the receipt and equal the live copy. The receipt's Ed25519 signature must verify against `paper-trail.receiptKey`. The transcript the page shows must carry the dossier's claim, verdict and confidence (`toFixed(2)`): the one the envelope names, else the latest. |
| envelope | The manifest must hash to the receipt. The bundle must hash to the manifest's `c2pa.hash.data`. The signed bundle must name exactly the stored certificates, transcript (hash and signature), perf hash, request id and graph hashes. `dossiers.envelope_id` must name it. The signature must verify against `inkprint.publicKey`. |
| perf | The stored payload must parse strictly and recompute to its hash. A succeeded dossier must hold one. |
| audit | The record receipt's digest over events ≤ `up_to_event_id` (at least one event; with its count) must recompute, and a succeeded dossier must hold one. The envelope's digest over events ≤ `metadata.audit_up_to` must recompute too, but it counts as signed only once the envelope check passed: if that check failed, this part fails; if it was unavailable, this part is unavailable. Later events never count. |
| documents | Re-fetch each read document's graph; `graph_hash` and `sha256` must be unchanged. An upload answering 404/410 is `expired`. A sample answering 404 fails. |
| steps | The runner's rows are present: exactly one per stage (8). No rows, a missing stage or a doubled stage fails. |

**What the issuers sign.** Both issuers sign the UTF-8 bytes of Python
`json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`. This is not JCS: floats are
written as Python `repr` (`1.0`, `5e-05`) and keys sort by code point. bastion rebuilds those bytes
(`src/platform/python-json.ts`, `src/dossier/issuer-forms.ts`). Fixtures produced by the issuers' own code
prove the rebuild (`tests/fixtures/receipts/`).

- **paper-trail:** it signs `{claim, verdict, confidence: float, rounds}`, where each round is
  `{side, round: int, argument_md, citations[{type, ref, title}], confidence: float|null}`. The
  `transcript_hash` it serves is its render node's SHA-256 of the same object with each round's
  `confidence` key absent. A debate from before that node stored a hash gets the route's hash of the
  signed form instead.
- **inkprint (envelope):** it signs `{dossier_id, evidence_cert_ids (in order), debate_transcript_hash,
  perf_receipt_hash, metadata, issued_at}`. `issued_at` is the manifest's `isoformat()` string
  (`+00:00`), not `created_at` (`Z`).
- **inkprint (certificates):** the fingerprint (SHA-256) and the Ed25519 signature are over
  `canonicalize(text)`, as UTF-8. That is NFC first. Then every run of Python `\s` becomes one space;
  that set is `str.isspace`, which adds U+001C–U+001F and U+0085 and lacks JavaScript's U+FEFF. Then
  `strip()`.

**Bundle.** `GET /api/dossiers/[id]/receipts` is public and limited to 30 a minute per visitor (429 with
`retry-after`). It answers 404 for an unknown dossier. Otherwise
it serves the canonical JSON of `{dossier, evidence, documents, receipts}` with
`content-disposition: attachment`.

- `dossier` holds the public fields only: no `visitor`, no `user_id`.
- `documents` carries the graph hashes the documents check re-fetches.

**Canonical form.** bastion's own receipts (the perf receipt, the audit digest, the envelope receipt's
hash) are hashed over `canonicalJson`, whose output is **RFC 8785 (JCS)** for any I-JSON value: keys
sorted by UTF-16 code units, no whitespace, numbers and strings exactly as ECMAScript's
`JSON.stringify` writes them. Any JCS library reproduces it byte for byte; Python's
`json.dumps(sort_keys=True)` does not (it writes `1.0` and `1e-05`, and sorts by code point). Every
digest is the lower-case hex SHA-256 of the UTF-8 bytes.

- **Perf receipt:** the digest of the stored payload, which holds exactly the hashed fields.
- **Audit digest:** the `events` rows with the dossier's `request_id` and `id` ≤ the bound (the audit
  receipt's `payload.up_to_event_id`, or the envelope's signed `metadata.audit_up_to`), ordered by `id`,
  each as `[id, action, service, created_at]`; `service` may be null; `created_at` is **truncated (not
  rounded) to milliseconds**, UTC, `YYYY-MM-DDTHH:MM:SS.mmmZ` — in SQL,
  `to_char(date_trunc('milliseconds', created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.
  The digest is over the JCS form of that array of arrays.

### 6.6 The dossier pages: compose, follow, verify (Task 13)

**Compose (`/dossier`).** Rendered per request with today's budgets. The form has a claim, web
sources, documents and a mode, and posts `POST /api/dossiers`; a 202 navigates to its `url`
(`/d/<id>`).

- *Claim*: 1–1024 characters after trimming, with a running count.
- *Web sources*: magpie's sources (`magpie.sources`), at most 5, behind a wake gate on magpie (§5.1:
  the list loads once the gate is live, and a manual retry is held until then).
- *Documents*: inkthread's samples (`inkthread.samples`) or an upload (`POST /api/uploads`, budget
  `upload`), at most 3 together, behind a wake gate on inkthread. **Ruling X**: before any upload
  control, the form says that a dossier is public and that the passages it quotes from a PDF —
  an uploaded one included — become part of it, while inkthread never keeps the PDF's bytes.
- *Mode*: rapid (1 round), standard (2, the default), adversarial (3).
- *Budget*: the debates left today. At 0 the submit is disabled and says why (budgets reset 00:00
  UTC); unreadable budgets leave it enabled and say so, because the server still reserves one.

Invariants:
1. The fields are checked when the visitor submits, never by pre-disabling the submit: an empty
   claim, a claim over 1024 characters, or nothing picked (no source and no document) is refused
   inline, the first bad field takes focus, and nothing is sent.
2. Only the budget (or a submit already in flight) disables the submit.
3. A refusal is said for what it is: `budget_exhausted` and `rate_limited` as limits, a 422 with its
   detail, a 503 `catalog_unavailable` as the list being unreachable — never as the product failing.

**The dossier (`/d/[id]`).** Public and rendered per request; an unknown or malformed id is a 404;
its title comes from the id alone. A **succeeded** dossier is the permanent receipt, rendered on
the server so it is crawlable. A **pending or running** one is a client island that follows the run
and, once it is done, re-renders the page as its receipt. A **failed** one shows its timeline with
"retry from this stage" and every receipt it already holds. A dossier with no step rows (v1) is
shown as it is, statically: nothing follows or nudges it (Ruling AK).

*The live card* (review round 1). While the island follows a run, the verdict slip beside the claim
is fed by the same stream: its status, verdict stamp and confidence change with each `status`
event. Counts the stream does not carry are never shown as stale zeros: the evidence line reads
seal's "certified N of M" once seal is ok, else "after seal"; the envelope line reads "after the
run" until the envelope stage is ok.

*The live run.* The island reads `GET /api/dossiers/[id]/stream` (SSE) and shows the eight stages
(`StageTimeline`). The route polls the dossier and its `dossier_steps` every 2 s (reading the dossier
first, so a terminal status is never seen before the step that ended it). It reads only what the
events carry — each row's scalar columns and a few small projections of its output (an array's
length, `certified`, `total`, `debateId`, `verdict`, `confidence`, `reason`, the woken services, the
receipt ids) — never a stage's whole output, which for gather holds whole web pages. It sends:

- `step` — `{stage, status, attempt, error, nextAt, leaseUntil, startedAt, finishedAt, note}` for every
  row on the first tick and for each row whose status, attempt, error, `nextAt`, `leaseUntil` or
  note changed since. `nextAt` is `not_before` while the row is pending or waiting, otherwise null;
  `leaseUntil` is the lease while one is held, otherwise null; `note` is a one-line summary of the
  row's output (why it was skipped, what it waits for, what it produced), never the output itself.
- `status` — `{status, verdict, confidence}` on the first tick and whenever one of them changes;
- `done` — `{status, verdict, confidence}` once the status is succeeded or failed, then the stream
  ends (a deleted dossier ends with `{status: "failed", reason: "dossier_deleted"}`; a dossier with
  no step rows ends at once with `reason: "no_steps"`: nothing will ever move it);
- `heartbeat` every 15 s, and `timeout` once 270 s of wall-clock time have passed since the stream
  opened (however slow the reads were), so a stream ends within `maxDuration` (300 s); the island
  reconnects. A client that disconnects stops the polling.

Each open stream holds a function for up to 300 s and reads Postgres every 2 s, so opening one is
limited to 10 a minute per visitor (key `stream:<visitor>`, checked before the dossier is read;
final review). Over the limit the route answers 429 `{error: "rate_limited", retryAfterS,
requestId}` with `retry-after`, the shape of every other refusal; an unknown dossier is 404
`{error: "unknown_dossier", requestId}`.

The island's end of it (Ruling AK, review round 1): every event is parsed and a malformed one
dropped — except `done`, which ends the stream even when its body does not parse (the page then
renders again from the server's truth). A stream that fails to open five times in a row without
once opening (a 404, a 500) stops reconnecting and says so, with a reload. A hidden tab closes the
stream and pauses the nudge; when the tab is shown again the stream reopens (its first tick sends
every row again) and the nudge plans afresh.

*The nudge* (carry from Task 5: after a `stage_timeout` nothing advances by itself). The frontier
stage — the first one that is not ok or skipped — is **due** when it is running and its lease has
expired, or it is pending or waiting and its `nextAt` has passed (and no lease is held). The island
calls `POST /api/dossiers/[id]/advance` when the frontier stage has been due for 5 s (the runner's
own chain arrives exactly on time, so it normally wins), at most one call at a time; a 429 waits the
`retryAfterS` it was given, any other failure backs off 15 s, doubling to 2 min; an error stage,
a finished dossier or a 404 stops it.

*The timeline.* The eight stages in stage order (Postgres returns the rows in no particular
order), each status written in words beside a glyph (pending · running · waiting · ok · error ·
skipped), with the attempt when it is past the first, the note, and the time
(UTC) a waiting stage is asked again. An error says what failed; `budget_exhausted`,
`rate_limited` and an asleep service are named as limits, never as the product failing. The error
stage carries "retry from this stage" (`POST /api/dossiers/[id]/retry`), disabled while that call
is in flight; its refusal (409, 429) is said, and its success re-renders the page. Step rows that are not
one per stage (only tampering does that; the `steps` check fails them) are shown as they are, with
a note, and the page neither follows nor nudges that dossier. An internal error of bastion's own
(`stage_threw`, `invalid_outcome`) is published as its bare code — never the exception's message —
and shown as "bastion hit an internal error running this stage", with the retry.

*The receipt* (§6.5), from what bastion stored:
- the claim, the verdict and its confidence;
- the evidence table: one row per evidence item with the anchor `e-<key>` — product, locator (the
  URL, or the document and page), the excerpt, the certificate id linking to inkprint's public
  page (`https://inkprint-frontend.vercel.app/certificates/<id>`), and its state once verified;
- the transcript (the one the envelope names, else the latest), each round in order; every
  `[cert:<id>]` in an argument links to the evidence row holding that certificate (`#e-<key>`); a
  certificate no row holds is said, unlinked. URL citations link out only when http(s);
- every outbound link taken from scraped or model-written content (a web evidence row's URL, a
  transcript's URL citation) carries `rel="nofollow ugc noreferrer"` (Ruling AK);
- each document's quoted pages, each anchored `doc-<id>-p<N>` whatever happens next (the evidence
  table's locators link there), listing the excerpts on it. Ruling AJ: nothing wakes inkthread
  for a visitor who only reads; "show on its pages" wakes it (a wake gate, opened on demand), reads
  the page sizes from `inkthread.graph` and draws each excerpt as a box (`PageWithBoxes`). An upload
  whose graph answers 404 or 410 says its pages are gone (DR-0029) and that the quoted passages
  remain in the dossier;
- the perf receipt per service: each query's fingerprint, calls and times, and its suggestions'
  exact SQL; a service that did not answer says why;
- the envelope: its id, signature, manifest hash and the metadata inkprint signed;
- the audit digest and a link to the trail (`/audit/<requestId>`);
- "verify everything" (`POST /api/dossiers/[id]/verify`, held while in flight) shows every check it
  returns — `steps` included — each with its state in words (pass · fail · unavailable · expired),
  its detail and its items; a legacy dossier shows its note and no checks; and "download receipts"
  (`GET /api/dossiers/[id]/receipts`).

## 7. Platform token contract v2 (DR-0033)

Minted by bastion (and, for their own backend, by the standalone frontends of DR-0030):

```
header  { alg: "EdDSA", kid: <BASTION_KEY_ID> }
claims  { iss: "bastion" | "<product>-frontend", aud: "<service id>", sub, role, service: "<service id>",
          cap: "<capability id>" (bastion only), iat, exp: iat + 60, jti }
```

Every backend verifies: signature against the issuer's configured key; `exp` and `iat` with 10 s leeway;
`aud == own service id`; for bastion's key `iss == "bastion"`; for its frontend's key
`iss == "<product>-frontend"`, `role == "frontend"`. Missing key ⇒ fail closed outside tests. A token that
is present is always fully verified. `DEMO_MODE` survives only as a default-off transition switch that
tolerates a *missing* token (logged); production sets it to `false` on every service once that service's
callers send tokens (supersedes DR-0009). Rate limits key on `sub` when a valid token is present, else on
the forwarded client address. bastion serves `/.well-known/jwks.json`.

**Public by design** (no token, on every deployment): `/health`, `/version`, `/docs`, `/openapi.json`, and
the *verification* surfaces, because anyone must be able to check a receipt without asking us —
inkprint `GET /certificates/{id}` (+ `/manifest`, `/qr`, `/download`), `POST /verify`, `POST /verify/batch`,
`GET /public-key.pem`; paper-trail `GET /debates/{id}/transcript.json` and `.md`,
`GET /platform/receipt-public-key`; slowquery-demo's read-only seeded commerce routes (they exist to be
queried). Everything that issues, spends quota or reads private data needs a token.

Service ids: `paper-trail`, `magpie`, `inkprint`, `inkthread`, `slowquery`, `feathers-demo`.

Rollout without an outage: (1) bastion v1 and the two DR-0030 frontends start minting `iss`/`aud`;
(2) the three newly closed products (inkprint, slowquery dashboard, inkthread) get DR-0030 proxies and keys;
(3) backends ship contract v2 with `DEMO_MODE` still honoured; (4) `DEMO_MODE=false` is flipped per
service after its frontend's proxy is live and smoke-tested. The feathers template ships the same contract,
and feathers-demo is regenerated from it.

## 8. Fleet observability — slowquery-detective 0.2.0 (DR-0034)

- A Postgres store (`slowquery` schema, created idempotently at startup) upstreamed from the demo
  backend's shims: fingerprints, samples (with `request_id`), suggestions with a unique
  `(fingerprint, kind, sql)` key, retention (default 7 days).
- Request tagging: an ASGI middleware copies `X-Request-Id` into a context variable that the hooks record.
- The router gains `?request_id=` and `?since=` and takes an `authorize(request) -> bool` hook, so the
  host's contract-v2 verifier guards `/_slowquery` (replacing the static shared secret).
- Installed in paper-trail, magpie, inkprint and inkthread; the demo backend moves onto the library store.

## 9. inkthread and inkgrid

- inkthread moves to `inkgrid>=0.2,<0.3`.
- It keeps, per document, inkgrid's tables (cells, header rows, page, bbox, Markdown) and the verification
  report summary, and serves them at `GET /documents/{id}/reading`. These are derived data, kept with the
  graph; uploads' bytes are still not kept (DR-0029).
- It accepts contract-v2 tokens (CORS adds `x-platform-token`), and inkthread-frontend proxies through its
  own key (DR-0030). Samples stay readable to the proxy; uploads are budgeted on bastion's side and
  rate-limited per `sub` on inkthread's.

## 10. Testing

Spec-TDD in every repo (`.claude/rules/spec-tdd.md`). In bastion: unit tests for every pure core
(capability policy, visitor id, evidence selection, canonical JSON + hashes, receipt verification, the
runner's state transitions, the health classifier); integration tests against a Neon branch for stage
claiming and leases (two concurrent advancers, one wins) and the migration; adapter contract tests with
recorded downstream fixtures parsed by the capability schemas; Playwright for compose → progress → receipt
with the gateway stubbed, and for each workbench; an env-gated live smoke that runs one budgeted dossier.
Each backend gets contract-v2 conformance tests (wrong `aud`, wrong `iss`, expired beyond leeway, within
leeway, frontend key with the wrong role, no key configured ⇒ fail closed).

### 10.1 End to end (Task 15)

Playwright drives a real Chrome against `next build && next start`, never a dev server, with every
downstream replaced by **one local stub** (`tests/e2e/fixtures/upstream.ts`). No test reaches a
production host or database.

**The harness.**
- The stub is an HTTPS server (bastion refuses a non-https `<SERVICE>_BACKEND_URL`) with a certificate
  made for the run; the app trusts it through `NODE_EXTRA_CA_CERTS`. It answers every capability path
  of §4 from the recorded fixtures (`tests/fixtures/downstream/`) and the issuer-signed ones
  (`tests/fixtures/receipts/`). It keeps the little state a flow needs: a debate is running on its
  first read and done after; an upload's job, a leak scan the same; feathers users are created,
  soft-deleted and then answer 404.
- Two apps share one build: **main** (generous budgets, every service live) and **limits**
  (`BUDGET_DEBATE=0`; feathers-demo's `/health` hangs until a test wakes it). Each reaches the stub
  under its own prefix, so a test can ask the stub what one app called.
- The run gets its own throwaway Ed25519 key, `IRON_SESSION_PASSWORD` and blank Upstash settings, so
  budgets and limits are in-process. `DATABASE_URL` must name a local, migrated Postgres; the
  configuration refuses any other host.
- Before any test, the golden dossier — signed by inkprint's and paper-trail's own code — is written to
  the database with its audit events at their exact ids. A database whose ids are taken by other events
  is refused, never silently mis-seeded.

**Cases.**
1. Home: the map draws 8 product nodes, each a link to `/tools/<id>` whose name holds its state in
   words; once the poll answers every service reads live. Keyboard: Tab reaches a node, Enter opens its
   workbench.
2. Each of the 8 workbenches: its main action, clicked in the browser, hands back its receipt with a
   copy button and an audit link — magpie's scrape, inkgrid's reading of an uploaded PDF, inkthread's
   why (reached by keyboard: Tab into the graph, an arrow key, Enter) with the element boxed on its page,
   inkprint's certificate and its verification (and a failed one once the text is altered), paper-trail's
   debate with its transcript hash recomputed and its Ed25519 signature verified, slowquery's plan and
   `CREATE INDEX`, feathers' soft-delete proof ending in a 404, bastion's token preview and audited call.
3. A dossier composed in the browser runs to its receipt; "verify everything" shows all 7 checks in
   words. Against the stub the signature checks fail (the stub cannot sign as inkprint) while bastion's
   own receipts pass — verification never passes what it could not prove.
4. The golden dossier: "verify everything" answers 7 of 7 pass; the receipts bundle downloads.
5. The handoff: a dossier composed through the API, with no page open to nudge it, crosses a stage
   that takes 12 s — longer than the runner's 10 s handoff — and still reaches `succeeded` by its own
   `after()` chain.
6. Budget spent (limits): the compose page says no debates are left and holds the submit; the API
   answers 429 `budget_exhausted`, and the stub never sees a debate from that app.
7. Asleep (limits): the map shows feathers asleep; its workbench gate reads asleep after the 90 s wake
   and offers "wake again", which, once the service answers, reaches live and loads the users.
8. The open log: `/audit`, a request's trail, `/time-travel` and `/platform` render from the real
   database and the stub's health.

**Live smoke** (`tests/e2e/live/`, skipped unless `BASTION_LIVE_SMOKE=1` and `PLAYWRIGHT_BASE_URL` are
set; never in CI): one rapid dossier against the deployment named by `PLAYWRIGHT_BASE_URL`, followed
over SSE without opening its page (nothing nudges it), which must succeed through a single-invocation
stage longer than 10 s and then pass every verification check in the browser. It spends one debate.

## 11. Sub-projects and order

0. **Known gaps** (parallel, per repo): live models for paper-trail and magpie, the hidden nightly failure,
   loud heal failures, slowquery-detective 0.1.1, feathers-cli with the current generator and the
   generator-level gaps, feathers-demo's soft-delete leak, slowquery-demo's duplicate suggestions and
   entrypoint migrations, inkprint's silent R2 failures and proxy headers, inkgrid's Dependabot pin,
   inkthread's Dependabot and smoke settings, a scheduled liveness check, Dependabot PRs that pass CI,
   and the stale docs.
1. **Contract v2** across the six backends, the feathers template and the five frontends.
2. **slowquery-detective 0.2.0**, then its install in four backends.
3. **inkthread**: inkgrid 0.2 and the reading endpoint.
4. **bastion v2**.
5. **Live**: deploy, flip `DEMO_MODE`, seed the gallery with a few dossiers, verify one end to end, update
   the knowledge graph and REMAINING-WORK.

## 12. Out of scope

The feathers forge (not chosen). Nonce CSP (DR-0018 stands). Owner-only items: demo GIFs, rotating the
R2 token, OpenRouter credit, the idle-host benchmark rerun.
