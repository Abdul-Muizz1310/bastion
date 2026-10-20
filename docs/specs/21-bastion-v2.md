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
| `/time-travel` | The v1 replay slider over entities (dossiers, certificates, debates, documents, gateway calls). |
| `/platform` | Registry of the 8 products / 15 repos: services, live commit SHAs, health, the token contract (JWKS, `kid`, the audience per service), today's remaining budgets. |

Removed: `/login`, `/auth/callback`, `/whoami`, `/run`, `/dashboard` (folded into `/platform`), the
forbidden/unauthorized interrupt pages, `/services/[id]` (folded into `/tools/[product]` and `/platform`).

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

**Visitors.** No cookie and no account: the actor is `v_` + the first 10 base32 characters of
`HMAC-SHA256(VISITOR_SALT, ip ‖ UTC date)`. It changes daily, cannot be reversed to an address, and is the
token `sub`, the rate-limit key and the audit actor. System work (the runner) acts as `bastion`.

**Budgets** default low and are configurable by env, because the account's free OpenRouter models are
limited to 50 requests a day across every product: debates 4/day, uploads 3/day, leak scans 10/day,
scrapes 30/day, certificates 200/day. `/platform` and each workbench show what is left today.

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

A check whose receipts the dossier lacks is omitted. Signatures are always checked against the key the
issuer publishes now, never one carried by the dossier.

| Check | What it does |
|---|---|
| certificates | `inkprint.verifyBatch` with each certificate id and the full certified text kept in its receipt. |
| transcript | Re-fetch `transcript.json`. The stored copy must hash to the receipt and equal the live copy. The receipt's Ed25519 signature must verify against `paper-trail.receiptKey`. |
| envelope | The manifest must hash to the receipt. The bundle must hash to the manifest's `c2pa.hash.data`. The signed bundle must name exactly the stored certificates, transcript (hash and signature), perf hash, request id and graph hashes. The signature must verify against `inkprint.publicKey`. |
| perf | The stored payload must parse strictly and recompute to its hash. |
| audit | The record receipt's digest over events ≤ `up_to_event_id` (with its count), and the envelope's signed digest over events ≤ `metadata.audit_up_to`, must both recompute. Later events never count. |
| documents | Re-fetch each read document's graph; `graph_hash` and `sha256` must be unchanged. An upload answering 404/410 is `expired`. A sample answering 404 fails. |

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
- **inkprint:** it signs `{dossier_id, evidence_cert_ids (in order), debate_transcript_hash,
  perf_receipt_hash, metadata, issued_at}`. `issued_at` is the manifest's `isoformat()` string
  (`+00:00`), not `created_at` (`Z`).

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
