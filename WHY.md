# Why bastion

## The obvious version

A portfolio landing page with a card per project: a description, a screenshot, a "view project"
link. It looks finished and proves nothing. A visitor cannot tell whether the products work, let
alone whether they work together, and a recruiter who wants to check a claim has nothing to check.

bastion v1 went one step further: a signed-in control plane that called four services through a
gateway and showed they answered. That proved the services were up. It did not let a stranger use
them, it hid two products (inkthread and inkgrid) entirely, and its demo dossier ran in one
unawaited promise, never sealed its envelope and could not be verified by anyone.

## Why I built it differently

Every product in the portfolio hands back a receipt: a signed certificate, a signed transcript, a
verification report, an exact `CREATE INDEX`. bastion v2 is built around that one idea. It is the
place where a visitor operates each product live and keeps its receipt, and where the products are
chained into a dossier whose receipt binds all the others — the receipt of receipts.

**No sign-in.** A sign-in wall is the first thing that stops a reviewer from trying anything, and
an account system is a liability I would have to defend. A visitor is a daily pseudonym — an HMAC of
their address and the UTC date, rotated every day and never reversible — which is enough to key
rate limits, budgets and the audit log without storing anyone. Capability grants replace user roles:
the token bastion mints says what one call may do, not who the caller is.

**Budgets instead of trust.** The products run on free tiers: Render services that sleep, and free
models limited to 50 requests a day across the whole portfolio. So everything that spends — a
debate, an upload, a scrape, a certificate — draws from a daily budget shared by every visitor, and
each visitor's calls to a service, spends and reads of the log are rate-limited. The interface says
"budget spent" or "asleep" for what they are, never as a product failing.

**A dossier is rows, not a promise.** Each of the eight stages is a Postgres row with a lease, an
attempt count and a time it may run again. A request drives it stage after stage in the
foreground — the visitor's page, or a token-gated sweep for runs nobody watches — so a run survives
a crash, a timeout and a closed tab, and two browsers nudging the same dossier cannot run a stage
twice.

**Verification without trusting bastion.** The issuers sign their receipts with their own keys.
"Verify everything" fetches those keys and re-checks each signature and hash live; bastion's own
receipts (the perf receipt, the audit digest) are recomputed from what it stored. Anything that
could not be checked reads as unavailable — never as a pass. The audit log is append-only in
Postgres itself, and each dossier's envelope signs the digest of its own slice of that log, so even
the table owner cannot quietly rewrite a dossier's history.

**One door to every service.** All 37 capabilities go through one gateway function driven by a typed
table: rate limit, budget, a token bound to one audience, the call, a schema parse of the answer, an
audit event. A new capability is a row in that table, not a new code path.

## What I'd change if I did it again

- **A queue under the runner.** The runner first chained itself with `after()`, and that broke on
  platform details three times: Next runs a function given to `after()` only when the response
  closes, an invocation whose caller has left loses its `after()` work, and on Vercel an invocation
  kept alive only by `after()` did not survive a long stage. Now no work outlives a request: the
  visitor's page drives the run, and a sweep every 30 minutes drives what nobody watches — so an
  abandoned run can wait half an hour. A durable queue (QStash, or Vercel's own) would pick it up
  in seconds.
- **Per-visitor quotas under the shared budgets.** Today one visitor can spend the day's debates
  for everyone. A small per-visitor share of each budget would keep the platform usable for the next
  person without raising the totals.
- **Published key history.** Signatures are checked against each issuer's current key, so rotating
  a key would turn every older dossier's checks to fail. Each issuer should publish its retired keys
  (a JWKS with `kid` history), and each receipt should carry the `kid` it was signed with.
- **A transparency log for the whole audit log.** Envelopes sign each dossier's slice, but a
  Merkle tree over all events, with its root published, would make tampering with any event —
  not just a dossier's — detectable by anyone.
- **Contract tests against the live schemas.** The stub's fixtures were recorded by hand from each
  backend's models and live answers. Generating them from each backend's OpenAPI document in CI
  would catch a renamed field before a release, not after.
- **A DOM test runner for the client islands.** The wake gates, the live dossier and the compose form
  are covered by their pure cores, by rendered markup and by Playwright; a component runner with
  real events would shorten the loop between a change and its proof.
