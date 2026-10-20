import { z } from "zod";
import type { VerifyBatchResult } from "@/capabilities/inkprint";
import type { Graph } from "@/capabilities/inkthread";
import { paperTrail, type ReceiptKey, type Transcript } from "@/capabilities/paper-trail";
import type { DossierDocument } from "@/lib/db/schema";
import { canonicalJson, type Json } from "@/platform/canonical-json";
import { verifyEd25519 } from "@/platform/ed25519";
import type { GatewayResult, RawBody } from "@/platform/gateway/result";
import { isServiceId, type ServiceId } from "@/platform/registry/products";
import { sha256Hex } from "@/platform/sha256";
import { envelopeBundleJson, transcriptRenderJson, transcriptSignedJson } from "./issuer-forms";
import {
  type AuditEventForDigest,
  auditDigest,
  lastEventId,
  type PerfReceipt,
  perfReceiptHash,
} from "./receipt-math";
import type { StoredReceipt } from "./receipts";

/**
 * "Verify everything" (spec 21 §6.5), the pure core: each check takes what bastion stored and what
 * the issuers answer now (fetched by the shell, `./verify-live`), and returns one `Check`. No I/O.
 *
 * - `pass` — recomputed, re-fetched and signature-checked, and everything agrees;
 * - `fail` — something was checked and does not hold (a tampered receipt, a changed source, a
 *   signature that does not verify, an issuer that no longer knows the receipt: 404);
 * - `unavailable` — it could not be checked now (an issuer asleep, out, rate-limited, answering in
 *   an unexpected shape). Never a pass. A proven `fail` wins over an outage elsewhere in the check;
 * - `expired` — an inkthread upload whose graph is gone by design (DR-0029: kept for an hour).
 *
 * Signatures are verified against the key the issuer publishes now (fetched live by the shell),
 * never a key the dossier carries. A check whose receipts the dossier does not have is not a check
 * (null): a dossier that never reached the envelope stage has no envelope to verify.
 */

export const CHECK_NAMES = [
  "certificates",
  "transcript",
  "envelope",
  "perf",
  "audit",
  "documents",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];
export type CheckState = "pass" | "fail" | "unavailable" | "expired";

/** One receipt within a check: a certificate id, a debate id or a document id. */
export type CheckItem = { ref: string; state: CheckState; detail: string };

export type Check = {
  name: CheckName;
  state: CheckState;
  detail: string;
  /** Per-receipt states, for the checks that cover several receipts. */
  items?: CheckItem[];
};

type Verdict = { state: CheckState; detail: string };
type Failure = Extract<GatewayResult<unknown>, { ok: false }>;

const PASS = (detail: string): Verdict => ({ state: "pass", detail });
const FAIL = (detail: string): Verdict => ({ state: "fail", detail });
const short = (hash: string) => `${hash.slice(0, 12)}…`;

/**
 * A downstream that did not answer usefully. A 404 or 410 is an answer — the issuer does not have
 * it — so the check fails; a request bastion cannot even form from the stored receipt fails too.
 * Everything else means "could not check now".
 */
function unreachable(who: string, f: Failure): Verdict {
  const said = f.detail === undefined ? "" : `: ${f.detail}`;
  switch (f.error) {
    case "downstream_error":
      if (f.status === 404 || f.status === 410) return FAIL(`${who} answered ${f.status}${said}`);
      return {
        state: "unavailable",
        detail:
          f.status < 500
            ? `${who} answered HTTP ${f.status}${said}`
            : `${who} is unavailable (${f.detail ?? `HTTP ${f.status}`})`,
      };
    case "asleep":
      return { state: "unavailable", detail: `${who} is asleep; it can take a minute to wake` };
    case "rate_limited":
      return {
        state: "unavailable",
        detail: `${who} could not be asked: rate limited, try again in ${f.retryAfterS ?? 60} s`,
      };
    case "budget_exhausted":
      return { state: "unavailable", detail: `${who} could not be asked: the budget is spent` };
    case "invalid_response":
      return { state: "unavailable", detail: `${who} answered in an unexpected shape${said}` };
    case "invalid_input":
      return FAIL(`the stored receipt cannot be sent to ${who}${said}`);
  }
}

const RANK: Readonly<Record<CheckState, number>> = {
  pass: 0,
  expired: 1,
  unavailable: 2,
  fail: 3,
};

function worst(states: readonly CheckState[]): CheckState {
  return states.reduce<CheckState>((w, s) => (RANK[s] > RANK[w] ? s : w), "pass");
}

/** A check over several receipts: the worst item's state, and why. */
function fromItems(name: CheckName, items: CheckItem[], passed: string): Check {
  const state = worst(items.map((i) => i.state));
  if (state === "pass") return { name, state, detail: passed, items };
  const bad = items.filter((i) => i.state === state);
  const first = bad[0] as CheckItem;
  const more = bad.length > 1 ? ` (and ${bad.length - 1} more)` : "";
  const label = state === "fail" ? "failed" : state;
  return {
    name,
    state,
    detail: `${bad.length} of ${items.length} ${label} — ${first.ref}: ${first.detail}${more}`,
    items,
  };
}

const record = z.record(z.string(), z.json());

function field(payload: Json | null, key: string): Json | undefined {
  const parsed = record.safeParse(payload);
  return parsed.success ? parsed.data[key] : undefined;
}

// ---- certificates -----------------------------------------------------------------------------

function storedText(r: StoredReceipt): string | null {
  const text = field(r.payload, "text");
  return typeof text === "string" ? text : null;
}

/** What `inkprint.verifyBatch` is asked: each certificate with its full certified text. */
export function sendableCertificates(
  receipts: readonly StoredReceipt[],
): { certificate_id: string; text: string }[] {
  return receipts.flatMap((r) => {
    const text = storedText(r);
    return r.ref === null || text === null ? [] : [{ certificate_id: r.ref, text }];
  });
}

function certificateItem(
  r: StoredReceipt,
  answer: GatewayResult<VerifyBatchResult> | null,
): CheckItem {
  const ref = r.ref ?? `receipt ${r.id}`;
  const item = (v: Verdict): CheckItem => ({ ref, ...v });
  if (r.ref === null) return item(FAIL("the receipt names no certificate"));
  if (storedText(r) === null) return item(FAIL("the receipt holds no certified text to verify"));
  if (answer === null) return item({ state: "unavailable", detail: "inkprint was not asked" });
  if (!answer.ok) return item(unreachable("inkprint", answer));
  const id = r.ref.toLowerCase();
  const result = answer.data.results.find((x) => x.certificate_id.toLowerCase() === id);
  if (result === undefined) return item(FAIL("inkprint returned no result for it"));
  const failed = Object.entries(result.checks).flatMap(([k, v]) => (v ? [] : [k]));
  const complete = result.checks.signature === true && result.checks.hash === true;
  if (result.valid && failed.length === 0 && complete) {
    return item(PASS("inkprint verifies its signature, its hash and the stored text"));
  }
  const why =
    result.reason ?? (failed.length > 0 ? `${failed.join(", ")} failed` : "checks missing");
  return item(FAIL(`inkprint does not verify it: ${why}`));
}

export function certificatesCheck(
  receipts: readonly StoredReceipt[],
  answer: GatewayResult<VerifyBatchResult> | null,
): Check | null {
  if (receipts.length === 0) return null;
  const items = receipts.map((r) => certificateItem(r, answer));
  return fromItems(
    "certificates",
    items,
    `${items.length} of ${items.length} certificates verify with inkprint against their stored text`,
  );
}

// ---- transcript -------------------------------------------------------------------------------

/**
 * An issuer's signed form, or null for a value Python could not have serialised (a lone surrogate,
 * an int beyond 2^53): nothing was ever signed over it, so it can only fail to verify.
 */
function form<T>(build: () => T): T | null {
  try {
    return build();
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
}

type TranscriptForms = { signed: string; hashes: string[] };

/** The bytes paper-trail signs, and the hashes it may have stored: render node's or route's. */
function transcriptForms(t: Transcript): TranscriptForms | null {
  return form(() => {
    const signed = transcriptSignedJson(t);
    return { signed, hashes: [sha256Hex(transcriptRenderJson(t)), sha256Hex(signed)] };
  });
}

function transcriptItem(
  r: StoredReceipt,
  live: GatewayResult<Transcript> | null,
  key: GatewayResult<ReceiptKey> | null,
): CheckItem {
  const ref = r.ref ?? `receipt ${r.id}`;
  const item = (v: Verdict): CheckItem => ({ ref, ...v });
  if (r.ref === null) return item(FAIL("the receipt names no debate"));
  if (r.hash === null) return item(FAIL("the receipt has no hash"));
  const parsed = paperTrail.transcript.output.safeParse(r.payload);
  if (!parsed.success) return item(FAIL("the stored transcript is not a paper-trail transcript"));
  const stored = parsed.data;
  if (stored.debate_id !== r.ref) return item(FAIL("the stored transcript is another debate's"));
  const forms = transcriptForms(stored);
  if (forms === null) return item(FAIL("the stored transcript has no form paper-trail could sign"));
  if (!forms.hashes.includes(r.hash)) {
    return item(FAIL(`the stored transcript does not hash to its receipt (${short(r.hash)})`));
  }
  if (r.signature === null) {
    return item(FAIL("the transcript is unsigned, so its origin cannot be proven"));
  }

  const later: string[] = [];
  if (key === null || !key.ok) {
    const v: Verdict =
      key === null
        ? { state: "unavailable", detail: "paper-trail's key was not fetched" }
        : unreachable("paper-trail (receipt key)", key);
    if (v.state === "fail") return item(v);
    later.push(v.detail);
  } else {
    if (key.data.alg !== "Ed25519") {
      return item(FAIL(`paper-trail's receipt key is ${key.data.alg}, not Ed25519`));
    }
    const message = {
      publicKeyPem: key.data.public_key,
      message: forms.signed,
      signature: r.signature,
    };
    if (!verifyEd25519(message)) {
      return item(FAIL("the signature does not verify against paper-trail's published key"));
    }
  }

  if (live === null) {
    later.push("the transcript was not re-fetched");
  } else if (!live.ok) {
    const v = unreachable("paper-trail", live);
    if (v.state === "fail") return item(v);
    later.push(v.detail);
  } else {
    if (live.data.debate_id !== r.ref) return item(FAIL("paper-trail answered for another debate"));
    if (transcriptForms(live.data)?.signed !== forms.signed) {
      return item(FAIL("paper-trail now serves a different transcript than the one stored"));
    }
    if (live.data.transcript_hash !== r.hash) {
      return item(FAIL(`paper-trail now reports hash ${short(live.data.transcript_hash)}`));
    }
  }

  if (later.length > 0) return item({ state: "unavailable", detail: later.join("; ") });
  return item(
    PASS(
      `re-fetched from paper-trail, hash ${short(r.hash)} recomputed, Ed25519 signature ` +
        "verified with paper-trail's published key",
    ),
  );
}

export function transcriptCheck(
  items: readonly { receipt: StoredReceipt; live: GatewayResult<Transcript> | null }[],
  key: GatewayResult<ReceiptKey> | null,
): Check | null {
  if (items.length === 0) return null;
  const checked = items.map((i) => transcriptItem(i.receipt, i.live, key));
  const only = checked.length === 1 ? checked[0] : undefined;
  if (only !== undefined)
    return { name: "transcript", state: only.state, detail: only.detail, items: checked };
  return fromItems("transcript", checked, `${checked.length} transcripts verify`);
}

// ---- envelope ---------------------------------------------------------------------------------

const INGREDIENT = "c2pa.ingredient.v2";
const DEBATE_HASH = "bastion.debate_transcript_hash";
const PERF_HASH = "bastion.perf_receipt_hash";
const BUNDLE_HASH = "c2pa.hash.data";

const envelopePayload = z.object({
  envelope_id: z.string(),
  envelope_manifest: z.object({
    issued_at: z.string().min(1),
    assertions: z.array(z.object({ label: z.string(), data: record })),
    signature: z.object({ value: z.string() }),
  }),
  envelope_signature: z.string(),
  request: z.object({
    dossier_id: z.string(),
    evidence_cert_ids: z.array(z.string()),
    debate_transcript_hash: z.string(),
    perf_receipt_hash: z.string(),
    metadata: z.record(z.string(), z.string()),
  }),
});
type EnvelopePayload = z.infer<typeof envelopePayload>;

export type DossierRef = { id: string; requestId: string };

export type EnvelopeInputs = {
  dossier: DossierRef;
  envelope: StoredReceipt | null;
  certificates: readonly StoredReceipt[];
  transcripts: readonly StoredReceipt[];
  perf: StoredReceipt | null;
  documents: readonly DossierDocument[];
  /** inkprint's `/public-key.pem`, fetched now. */
  key: GatewayResult<RawBody> | null;
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function assertionHash(p: EnvelopePayload, label: string): Json | undefined {
  return p.envelope_manifest.assertions.find((a) => a.label === label)?.data.hash;
}

/** What the stored envelope receipt says about itself, checked without any key. */
function envelopeSelf(r: StoredReceipt, p: EnvelopePayload, bundle: string): Verdict | null {
  const manifest = field(r.payload, "envelope_manifest") ?? null;
  if (r.hash !== sha256Hex(canonicalJson(manifest))) {
    return FAIL("the stored manifest does not hash to its receipt");
  }
  const signature = p.envelope_signature;
  if (r.signature !== signature || p.envelope_manifest.signature.value !== signature) {
    return FAIL("the receipt, the payload and the manifest name different signatures");
  }
  if (r.ref !== p.envelope_id) return FAIL("the receipt names another envelope");
  if (assertionHash(p, BUNDLE_HASH) !== sha256Hex(bundle)) {
    return FAIL("the manifest's bundle hash is not the hash of the signed fields");
  }
  const ingredients = p.envelope_manifest.assertions
    .filter((a) => a.label === INGREDIENT)
    .map((a) => a.data.instance_id);
  const certs = p.request.evidence_cert_ids.map((id) => `urn:uuid:${id}`);
  if (ingredients.length !== certs.length || ingredients.some((u, i) => u !== certs[i])) {
    return FAIL("the manifest's ingredients are not the signed certificates");
  }
  if (assertionHash(p, DEBATE_HASH) !== p.request.debate_transcript_hash) {
    return FAIL("the manifest's transcript hash is not the signed one");
  }
  if (assertionHash(p, PERF_HASH) !== p.request.perf_receipt_hash) {
    return FAIL("the manifest's perf hash is not the signed one");
  }
  return null;
}

/** Whether the signed bundle names exactly this dossier's stored receipts. */
function envelopeBinds(i: EnvelopeInputs, p: EnvelopePayload): Verdict | null {
  const { request } = p;
  const meta = request.metadata;
  if (p.envelope_id !== i.dossier.id || request.dossier_id !== i.dossier.id) {
    return FAIL("the envelope is another dossier's");
  }
  if (meta.request_id !== i.dossier.requestId) return FAIL("the envelope names another request");
  const certIds = i.certificates.flatMap((c) => (c.ref === null ? [] : [c.ref]));
  if (!sameSet(request.evidence_cert_ids, certIds)) {
    return FAIL("the signed certificates are not the dossier's stored certificates");
  }
  const transcript = i.transcripts.find((t) => t.ref === meta.debate_id);
  if (transcript === undefined || transcript.hash !== request.debate_transcript_hash) {
    return FAIL("the signed transcript hash is not the stored transcript's");
  }
  if ((transcript.signature ?? "") !== meta.transcript_signature) {
    return FAIL("the signed transcript signature is not the stored one");
  }
  if (i.perf === null || i.perf.hash !== request.perf_receipt_hash) {
    return FAIL("the signed perf hash is not the stored perf receipt's");
  }
  const graphHashes = i.documents
    .flatMap((d) => (d.graphHash === null ? [] : [d.graphHash]))
    .sort()
    .join(",");
  if (graphHashes !== meta.graph_hashes) {
    return FAIL("the signed graph hashes are not the stored documents'");
  }
  return null;
}

export function envelopeCheck(i: EnvelopeInputs): Check | null {
  const r = i.envelope;
  if (r === null) return null;
  const done = (v: Verdict): Check => ({ name: "envelope", ...v });
  const parsed = envelopePayload.safeParse(r.payload);
  if (!parsed.success) return done(FAIL("the stored envelope is not an inkprint envelope"));
  const p = parsed.data;
  const bundle = form(() =>
    envelopeBundleJson({ ...p.request, issued_at: p.envelope_manifest.issued_at }),
  );
  if (bundle === null) return done(FAIL("the stored envelope has no form inkprint could sign"));
  const local = envelopeSelf(r, p, bundle) ?? envelopeBinds(i, p);
  if (local !== null) return done(local);

  if (i.key === null)
    return done({ state: "unavailable", detail: "inkprint's key was not fetched" });
  if (!i.key.ok) return done(unreachable("inkprint (public key)", i.key));
  const publicKeyPem = new TextDecoder().decode(i.key.data.bytes);
  if (!verifyEd25519({ publicKeyPem, message: bundle, signature: p.envelope_signature })) {
    return done(FAIL("the signature does not verify against inkprint's published key"));
  }
  return done(
    PASS(
      `inkprint's Ed25519 signature verifies with its published key; it binds the dossier's ` +
        `${p.request.evidence_cert_ids.length} certificates, transcript, perf receipt and ` +
        "documents as stored",
    ),
  );
}

// ---- perf -------------------------------------------------------------------------------------

const serviceId = z.custom<ServiceId>((v) => typeof v === "string" && isServiceId(v), {
  message: "not a service",
});
const perfQuery = z.strictObject({
  id: z.string(),
  fingerprint: z.string(),
  calls: z.number(),
  total_ms: z.number(),
  max_ms: z.number().nullable(),
  suggestions: z.array(z.strictObject({ kind: z.string(), sql: z.string().nullable() })),
});
const perfPayload = z.strictObject({
  dossier_id: z.string(),
  request_id: z.string(),
  services: z.array(
    z.union([
      z.strictObject({ service: serviceId, queries: z.array(perfQuery) }),
      z.strictObject({ service: serviceId, queries: z.tuple([]), error: z.string() }),
    ]),
  ),
});

export function perfCheck(dossier: DossierRef, r: StoredReceipt | null): Check | null {
  if (r === null) return null;
  const done = (v: Verdict): Check => ({ name: "perf", ...v });
  const parsed = perfPayload.safeParse(r.payload);
  if (!parsed.success)
    return done(FAIL("the stored perf receipt is not one (undeclared or missing fields)"));
  const receipt: PerfReceipt = parsed.data;
  if (receipt.dossier_id !== dossier.id || receipt.request_id !== dossier.requestId) {
    return done(FAIL("the perf receipt is another dossier's"));
  }
  if (r.hash === null) return done(FAIL("the perf receipt has no hash"));
  const hash = perfReceiptHash(receipt);
  if (hash !== r.hash) {
    return done(FAIL(`the perf receipt recomputes to ${short(hash)}, not ${short(r.hash)}`));
  }
  const queries = receipt.services.reduce((n, s) => n + s.queries.length, 0);
  return done(
    PASS(`${receipt.services.length} services and ${queries} queries recompute to ${short(hash)}`),
  );
}

// ---- audit ------------------------------------------------------------------------------------

const auditPayload = z.object({
  request_id: z.string(),
  up_to_event_id: z.number().int().nonnegative(),
  event_count: z.number().int().nonnegative(),
});
const bound = z
  .string()
  .regex(/^(0|[1-9]\d{0,15})$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const envelopeAudit = z.object({
  request: z.object({
    metadata: z.object({
      request_id: z.string(),
      audit_digest_at_envelope: z.string(),
      audit_up_to: bound,
    }),
  }),
});

/** The event-id bound the record stage's digest covers, or null when the receipt has none. */
export function auditBound(r: StoredReceipt): number | null {
  const parsed = auditPayload.safeParse(r.payload);
  return parsed.success ? parsed.data.up_to_event_id : null;
}

/** The bound inkprint signed into the envelope (`metadata.audit_up_to`), or null. */
export function envelopeAuditBound(r: StoredReceipt): number | null {
  const parsed = envelopeAudit.safeParse(r.payload);
  return parsed.success ? parsed.data.request.metadata.audit_up_to : null;
}

type Covered = { receipt: StoredReceipt; events: readonly AuditEventForDigest[] };

export type AuditInputs = {
  requestId: string;
  /** The record stage's receipt, with the request's events up to its bound. */
  audit: Covered | null;
  /** The envelope receipt, with the request's events up to its signed bound. */
  envelope: Covered | null;
};

function recordDigest(requestId: string, { receipt, events }: Covered): Verdict {
  const parsed = auditPayload.safeParse(receipt.payload);
  if (!parsed.success || receipt.hash === null) return FAIL("the stored audit receipt is not one");
  const p = parsed.data;
  if (p.request_id !== requestId || receipt.ref !== requestId) {
    return FAIL("the audit receipt names another request");
  }
  if (events.length !== p.event_count || lastEventId(events) !== p.up_to_event_id) {
    return FAIL(
      `the log holds ${events.length} events up to #${p.up_to_event_id}; ` +
        `the receipt counted ${p.event_count}`,
    );
  }
  const digest = auditDigest(events);
  if (digest !== receipt.hash) {
    return FAIL(
      `the events up to #${p.up_to_event_id} digest to ${short(digest)}, not the receipt's`,
    );
  }
  return PASS(`${events.length} events up to #${p.up_to_event_id} recompute to the record receipt`);
}

function envelopeDigest(requestId: string, { receipt, events }: Covered): Verdict {
  const parsed = envelopeAudit.safeParse(receipt.payload);
  if (!parsed.success) return FAIL("the envelope carries no signed audit digest");
  const meta = parsed.data.request.metadata;
  if (meta.request_id !== requestId) return FAIL("the envelope's digest is another request's");
  if (auditDigest(events) !== meta.audit_digest_at_envelope) {
    return FAIL(`the events up to #${meta.audit_up_to} do not recompute to the envelope's digest`);
  }
  return PASS(`the envelope's signed digest over events up to #${meta.audit_up_to} recomputes`);
}

export function auditCheck(i: AuditInputs): Check | null {
  const verdicts = [
    ...(i.audit === null ? [] : [recordDigest(i.requestId, i.audit)]),
    ...(i.envelope === null ? [] : [envelopeDigest(i.requestId, i.envelope)]),
  ];
  if (verdicts.length === 0) return null;
  const failed = verdicts.find((v) => v.state === "fail");
  if (failed !== undefined) return { name: "audit", ...failed };
  return { name: "audit", state: "pass", detail: verdicts.map((v) => v.detail).join("; ") };
}

// ---- documents --------------------------------------------------------------------------------

function documentItem(d: DossierDocument, answer: GatewayResult<Graph> | undefined): CheckItem {
  const item = (v: Verdict): CheckItem => ({ ref: d.documentId, ...v });
  if (answer === undefined)
    return item({ state: "unavailable", detail: "inkthread was not asked" });
  if (!answer.ok) {
    const gone =
      answer.error === "downstream_error" && (answer.status === 404 || answer.status === 410);
    if (gone && d.kind === "upload") {
      return item({
        state: "expired",
        detail:
          "inkthread no longer keeps this upload (uploads are kept for an hour, DR-0029), " +
          "so its graph hash cannot be re-fetched",
      });
    }
    return item(unreachable("inkthread", answer));
  }
  const live = answer.data;
  if (live.provenance.graph_hash !== d.graphHash) {
    return item(FAIL(`inkthread now serves graph hash ${short(live.provenance.graph_hash)}`));
  }
  if (d.sha256 !== null && live.document.sha256 !== d.sha256) {
    return item(FAIL("inkthread now serves the graph of another file"));
  }
  return item(PASS(`inkthread re-serves graph hash ${short(live.provenance.graph_hash)}`));
}

export function documentsCheck(
  documents: readonly DossierDocument[],
  graphs: ReadonlyMap<string, GatewayResult<Graph>>,
): Check | null {
  const read = documents.filter((d) => d.graphHash !== null);
  if (read.length === 0) return null;
  const items = read.map((d) => documentItem(d, graphs.get(d.documentId)));
  return fromItems(
    "documents",
    items,
    `${items.length} of ${items.length} document graphs re-fetched with the stored hash`,
  );
}
