/**
 * The e2e stand-in for every downstream service (spec 21 §10.1). One HTTPS server answers every
 * capability path of spec 21 §4 from the recorded fixtures (`tests/fixtures/downstream/`) and the
 * issuer-signed ones (`tests/fixtures/receipts/`), so the golden dossier verifies for real. It never
 * talks to anything else.
 *
 *   node tests/e2e/fixtures/upstream.ts      (Node ≥ 23.6 runs it as is: type stripping only)
 *
 * Environment: E2E_STUB_PORT, E2E_STUB_CERT, E2E_STUB_KEY (PEM paths). playwright.config.ts starts
 * it before the apps and points each app's `<SERVICE>_BACKEND_URL` at `/<tenant>/<service>`:
 *
 * - tenant `main`: every service live;
 * - tenant `limits`: the same, except feathers-demo's `/health` hangs (asleep) until a test calls
 *   `POST /__control/wake`, and `POST /__control/sleep` puts it back to sleep.
 *
 * `GET /__control/log?tenant=<t>` lists what a tenant called, so a test can prove a call was never
 * made. `GET /__ready` answers once the server listens.
 *
 * State is the little a flow needs: a debate, an upload's job and a leak scan each answer "running"
 * on their first read and finished after; feathers users are created, soft-deleted (404 after), and
 * listed. A batch scrape of the source `slow-wire` takes 12 s — longer than the runner's 10 s
 * handoff (spec 21 §10.1 case 5).
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { crc32, deflateSync } from "node:zlib";
// Node resolves only explicit extensions when it runs TypeScript directly.
import { SERVICE_IDS, SLOW_SOURCE, SLOW_STAGE_MS, TENANTS } from "./env.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const SERVICES: readonly string[] = SERVICE_IDS;
const TENANT_NAMES: readonly string[] = TENANTS;

// ---- configuration --------------------------------------------------------------------------

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`upstream stub: ${name} is not set`);
  return value;
}

const FIXTURES = new URL("../../fixtures/", import.meta.url);
const bytes = (path: string): Buffer => readFileSync(new URL(path, FIXTURES));
const fixture = (path: string): Json => JSON.parse(bytes(path).toString("utf8")) as Json;

function object(value: Json, what: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`upstream stub: ${what} is not a JSON object`);
  }
  return value;
}

function array(value: Json, what: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`upstream stub: ${what} is not a JSON array`);
  return value;
}

function text(value: Json, what: string): string {
  if (typeof value !== "string") throw new Error(`upstream stub: ${what} is not a string`);
  return value;
}

/** A deep copy with some top-level keys replaced. */
function withKeys(value: JsonObject, keys: JsonObject): JsonObject {
  return { ...(JSON.parse(JSON.stringify(value)) as JsonObject), ...keys };
}

// ---- the fixtures ---------------------------------------------------------------------------

const D = "downstream";
const MAGPIE_SOURCES = array(fixture(`${D}/magpie/sources.json`), "magpie sources");
const MAGPIE_ITEMS = fixture(`${D}/magpie/items.json`);
const MAGPIE_HEALS = array(fixture(`${D}/magpie/heals.json`), "magpie heals");
const SCRAPE_ONCE = object(fixture(`${D}/magpie/scrape-once.json`), "scrape once");
const SCRAPE_BATCH = object(fixture(`${D}/magpie/scrape-batch.json`), "scrape batch");
const BATCH_ITEMS = array(
  object(array(SCRAPE_BATCH.runs ?? null, "batch runs")[0] ?? null, "batch run").items ?? null,
  "batch items",
);

const CERT_CREATED = object(fixture(`${D}/inkprint/certificate-create.json`), "certificate");
const CERT_DETAIL = object(fixture(`${D}/inkprint/certificate.json`), "certificate detail");
const CERT_BATCH = object(fixture(`${D}/inkprint/certificates-batch.json`), "certificate batch");
const BATCH_RECORD = object(array(CERT_BATCH.certificates ?? null, "batch")[0] ?? null, "record");
const VERIFY = object(fixture(`${D}/inkprint/verify.json`), "verify");
const DIFF = fixture(`${D}/inkprint/diff.json`);
const LEAK_STARTED = object(fixture(`${D}/inkprint/leak-scan.json`), "leak scan");
const LEAK_STATUS = object(fixture(`${D}/inkprint/leak-scan-status.json`), "leak scan status");
const ENVELOPE = object(fixture(`${D}/inkprint/envelope.json`), "envelope");
// The key the golden dossier's certificates and envelope were really signed with.
const INKPRINT_KEY = bytes("receipts/inkprint/public-key.pem");

const DEBATE = object(fixture(`${D}/paper-trail/debate.json`), "debate");
const DEBATE_LIST = fixture(`${D}/paper-trail/list.json`);
// A transcript paper-trail's own code signed (receipts/generate/pt_fixture.py). Its hash and
// signature cover {claim, verdict, confidence, rounds}, never the debate id, so it can be served
// as any debate's transcript and still verify.
const TRANSCRIPT = object(fixture("receipts/paper-trail/transcript-a.json"), "transcript");
const RECEIPT_KEY = fixture("receipts/paper-trail/receipt-key.json");

const SAMPLES = fixture(`${D}/inkthread/samples.json`);
const DOCUMENT = object(fixture(`${D}/inkthread/document.json`), "document");
const GRAPH = fixture(`${D}/inkthread/graph.json`);
const READING = fixture(`${D}/inkthread/reading.json`);
const WHY_NODE = object(fixture(`${D}/inkthread/why-node.json`), "why node");
const WHY_ROLE = object(fixture(`${D}/inkthread/why-role.json`), "why role");
const JOB = object(fixture(`${D}/inkthread/job.json`), "job");
const UPLOAD = object(fixture(`${D}/inkthread/upload.json`), "upload");

const QUERIES = fixture(`${D}/slowquery/queries.json`);
const QUERIES_DEMO = fixture(`${D}/slowquery/queries-demo.json`);
const QUERY = fixture(`${D}/slowquery/query.json`);
const QUERY_DEMO = fixture(`${D}/slowquery/query-demo.json`);
const BRANCH = object(fixture(`${D}/slowquery/branch.json`), "branch");
const SWITCHED = object(fixture(`${D}/slowquery/switch.json`), "switch");

const USERS = array(fixture(`${D}/feathers-demo/users.json`), "users");
const USER_CREATED = object(fixture(`${D}/feathers-demo/user-created.json`), "user created");

/** magpie's sources, plus the stub-only slow one (it exists only here). */
const SOURCES: Json[] = [
  ...MAGPIE_SOURCES,
  {
    name: SLOW_SOURCE,
    description: "A stub source whose batch scrape takes 12 s (e2e only)",
    last_run_at: "2026-10-20T09:00:00.000000Z",
    last_status: "ok",
    item_count: BATCH_ITEMS.length,
    config_sha: "0".repeat(64),
  },
];
const SOURCE_NAMES = new Set(SOURCES.map((s) => text(object(s, "source").name ?? null, "name")));

// ---- a PNG of a blank page, the size of a US Letter page in points ---------------------------

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function blankPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(0, 9); // greyscale
  const row = Buffer.alloc(width + 1, 0xff);
  row[0] = 0; // filter: none
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PAGE_PNG = blankPng(612, 792);
const QR_PNG = blankPng(64, 64);

// ---- state ----------------------------------------------------------------------------------

type Call = { tenant: string; service: string; method: string; path: string; at: string };
const calls: Call[] = [];
const MAX_CALLS = 5_000;

const debates = new Map<string, { claim: string; reads: number }>();
const jobs = new Map<string, number>();
const scans = new Map<string, { certificateId: string; reads: number }>();
const certificates = new Map<string, string>();
/** Dossiers citing the slow source whose first seal already ran long and failed. */
const slowSeals = new Set<string>();
const users = new Map<string, JsonObject>(
  USERS.map((u) => {
    const user = object(u, "user");
    return [text(user.id ?? null, "user id"), user];
  }),
);
let limitsAwake = false;
const hanging = new Set<ServerResponse>();

// ---- HTTP plumbing --------------------------------------------------------------------------

function send(res: ServerResponse, status: number, body: Json | Buffer, type?: string): void {
  if (res.writableEnded) return;
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": type ?? "application/json",
    "content-length": String(payload.length),
  });
  res.end(payload);
}

const notFound = (res: ServerResponse) => send(res, 404, { detail: "not found" });

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

async function jsonBody(req: IncomingMessage): Promise<JsonObject> {
  const raw = (await readBody(req)).toString("utf8");
  return raw === "" ? {} : object(JSON.parse(raw) as Json, "request body");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const now = () => new Date().toISOString();

/** inkprint's canonical text (NFC, whitespace runs collapsed, trimmed), close enough for ASCII. */
const canonical = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

// ---- per-service handlers -------------------------------------------------------------------

type Ctx = { req: IncomingMessage; res: ServerResponse; path: string; url: URL; method: string };

async function magpie({ req, res, path, url, method }: Ctx): Promise<void> {
  if (method === "GET" && path === "/sources") return send(res, 200, SOURCES);
  if (method === "GET" && /^\/sources\/[^/]+\/items$/.test(path))
    return send(res, 200, MAGPIE_ITEMS);
  if (method === "GET" && path === "/heals") {
    const source = url.searchParams.get("source");
    return send(
      res,
      200,
      MAGPIE_HEALS.filter((h) => source === null || object(h, "heal").source === source),
    );
  }
  const once = /^\/api\/scrape\/([^/]+)\/once$/.exec(path);
  if (method === "POST" && once) {
    const source = decodeURIComponent(once[1] ?? "");
    if (!SOURCE_NAMES.has(source)) return send(res, 404, { detail: `Unknown source: ${source}` });
    return send(
      res,
      200,
      withKeys(SCRAPE_ONCE, { source, run_id: randomUUID(), scraped_at: now() }),
    );
  }
  if (method === "POST" && path === "/api/scrape/batch") {
    const body = await jsonBody(req);
    const sources = array(body.sources ?? null, "sources").map((s) => text(s, "source"));
    if (sources.includes(SLOW_SOURCE)) await sleep(SLOW_STAGE_MS);
    const known = sources.filter((s) => SOURCE_NAMES.has(s));
    return send(res, 200, {
      runs: known.map((source) => ({
        source,
        scraped_at: now(),
        run_id: randomUUID(),
        items: BATCH_ITEMS.map((raw, i) => {
          const item = object(raw, "item");
          return withKeys(item, {
            stable_id: `${source}-${i}`,
            url: `https://example.com/${source}/${i}`,
            title: `Item ${i} from ${source}`,
            content_text: `Item ${i} from ${source}: the fee schedule lists 350 dollars.`,
          });
        }),
      })),
      failed: sources
        .filter((s) => !SOURCE_NAMES.has(s))
        .map((source) => ({ source, error: `Unknown source: ${source}` })),
    });
  }
  return notFound(res);
}

/** A certificate's C2PA manifest names it: `instance_id` is how /verify finds the certified text. */
function manifestOf(source: JsonObject, id: string): JsonObject {
  return withKeys(object(source.manifest ?? null, "manifest"), {
    title: `Content Credential for ${id}`,
    instance_id: `urn:uuid:${id}`,
  });
}

function certificateDetail(id: string): JsonObject {
  const certified = certificates.get(id) ?? text(CERT_DETAIL.text ?? null, "certificate text");
  return withKeys(CERT_DETAIL, {
    id,
    text: certified,
    content_len: certified.length,
    manifest: manifestOf(CERT_DETAIL, id),
  });
}

async function inkprint({ req, res, path, method }: Ctx): Promise<void> {
  if (method === "GET" && path === "/public-key.pem") {
    return send(res, 200, INKPRINT_KEY, "text/plain; charset=utf-8");
  }
  if (method === "POST" && path === "/certificates") {
    const body = await jsonBody(req);
    const id = randomUUID();
    const certified = text(body.text ?? null, "text");
    certificates.set(id, certified);
    return send(
      res,
      201,
      withKeys(CERT_CREATED, {
        id,
        manifest: manifestOf(CERT_CREATED, id),
        author: text(body.author ?? null, "author"),
        content_hash: sha256(canonical(certified)),
        content_len: certified.length,
        issued_at: now(),
      }),
    );
  }
  if (method === "POST" && path === "/certificates/batch") {
    const body = await jsonBody(req);
    const items = array(body.items ?? null, "items").map((i) => object(i, "item"));
    // The first live smoke's failure: a seal that runs past the old 10 s hand-off and then answers a
    // retryable 503 (inkprint behind a rate-limited embedding provider). Once per dossier.
    const meta = items.map((i) => object(i.metadata ?? null, "metadata"));
    const slow = meta.find((m) => text(m.url ?? null, "url").includes(`/${SLOW_SOURCE}/`));
    // The retry then succeeds the way inkprint now answers a failed embedding call (its PR #16):
    // every item certified, embedding_id null.
    let unembedded = false;
    if (slow !== undefined) {
      const dossierId = text(slow.dossier_id ?? null, "dossier_id");
      if (!slowSeals.has(dossierId)) {
        slowSeals.add(dossierId);
        await sleep(SLOW_STAGE_MS);
        return send(res, 503, { detail: "embedding provider rate limited (stub)" });
      }
      unembedded = true;
    }
    return send(res, 201, {
      certificates: items.map((item) => {
        const id = randomUUID();
        const certified = text(item.text ?? null, "item text");
        certificates.set(id, certified);
        // The fingerprint is honest; the signature is the fixture's placeholder, so a dossier
        // run against this stub fails its certificate check — the stub cannot sign as inkprint.
        return withKeys(BATCH_RECORD, {
          certificate_id: id,
          manifest: manifestOf(BATCH_RECORD, id),
          fingerprints: {
            ...object(BATCH_RECORD.fingerprints ?? null, "fingerprints"),
            sha256: sha256(canonical(certified)),
            embedding_id: unembedded ? null : randomUUID(),
          },
        });
      }),
    });
  }
  const qr = /^\/certificates\/([^/]+)\/qr$/.exec(path);
  if (method === "GET" && qr) return send(res, 200, QR_PNG, "image/png");
  const one = /^\/certificates\/([^/]+)$/.exec(path);
  if (method === "GET" && one) return send(res, 200, certificateDetail(one[1] ?? ""));
  if (method === "POST" && path === "/verify") {
    const body = await jsonBody(req);
    const manifest = object(body.manifest ?? null, "manifest");
    const id = text(manifest.instance_id ?? null, "instance id").replace(/^urn:uuid:/, "");
    const same =
      canonical(text(body.text ?? null, "text")) ===
      canonical(text(certificateDetail(id).text ?? null, "certificate text"));
    return send(
      res,
      200,
      same
        ? VERIFY
        : withKeys(VERIFY, {
            valid: false,
            checks: { hash: false, signature: true },
            warnings: [],
          }),
    );
  }
  if (method === "POST" && path === "/verify/batch") {
    const body = await jsonBody(req);
    const items = array(body.items ?? null, "items").map((i) => object(i, "item"));
    return send(res, 200, {
      results: items.map((item) => ({
        certificate_id: text(item.certificate_id ?? null, "certificate id"),
        valid: true,
        checks: { signature: true, hash: true },
        reason: null,
      })),
    });
  }
  if (method === "POST" && path === "/diff") return send(res, 200, DIFF);
  if (method === "POST" && path === "/leak-scan") {
    const body = await jsonBody(req);
    const scanId = randomUUID();
    scans.set(scanId, {
      certificateId: text(body.certificate_id ?? null, "certificate"),
      reads: 0,
    });
    return send(res, 202, withKeys(LEAK_STARTED, { scan_id: scanId }));
  }
  const scan = /^\/leak-scan\/([^/]+)$/.exec(path);
  if (method === "GET" && scan) {
    const id = scan[1] ?? "";
    const known = scans.get(id);
    if (known === undefined) return notFound(res);
    known.reads += 1;
    return send(
      res,
      200,
      withKeys(LEAK_STATUS, {
        scan_id: id,
        certificate_id: known.certificateId,
        ...(known.reads === 1
          ? { status: "running", hit_count: 0, confidence: null, results: [] }
          : {}),
      }),
    );
  }
  if (method === "POST" && path === "/dossiers/envelope") {
    await readBody(req);
    return send(res, 201, withKeys(ENVELOPE, { envelope_id: randomUUID(), created_at: now() }));
  }
  return notFound(res);
}

/** paper-trail's DebateOut rounds, written from the signed transcript's rounds. */
function debateRounds(): Json[] {
  return array(TRANSCRIPT.rounds ?? null, "rounds").map((raw) => {
    const round = object(raw, "round");
    return {
      side: round.side ?? null,
      round: round.round ?? null,
      argument: round.argument_md ?? null,
      evidence: [],
      citations: round.citations ?? [],
    };
  });
}

async function paperTrail({ req, res, path, url, method }: Ctx): Promise<void> {
  if (method === "GET" && path === "/platform/receipt-public-key")
    return send(res, 200, RECEIPT_KEY);
  if (method === "POST" && path === "/debates") {
    const body = await jsonBody(req);
    const id = randomUUID();
    debates.set(id, { claim: text(body.claim ?? null, "claim"), reads: 0 });
    return send(res, 202, { debate_id: id, stream_url: `/debates/${id}/stream` });
  }
  if (method === "GET" && path === "/debates") {
    if (url.searchParams.has("cursor")) return send(res, 200, { items: [], next_cursor: null });
    return send(res, 200, DEBATE_LIST);
  }
  const transcript = /^\/debates\/([^/]+)\/transcript\.json$/.exec(path);
  if (method === "GET" && transcript) {
    return send(res, 200, withKeys(TRANSCRIPT, { debate_id: transcript[1] ?? "" }));
  }
  const one = /^\/debates\/([^/]+)$/.exec(path);
  if (method === "GET" && one) {
    const id = one[1] ?? "";
    const known = debates.get(id);
    if (known !== undefined) known.reads += 1;
    const rounds = debateRounds();
    // A debate this stub started is running on its first read: the rounds arrive as they finish.
    const running = known !== undefined && known.reads === 1;
    return send(
      res,
      200,
      withKeys(DEBATE, {
        id,
        claim: known?.claim ?? text(TRANSCRIPT.claim ?? null, "claim"),
        status: running ? "running" : "done",
        verdict: running ? null : (TRANSCRIPT.verdict ?? null),
        confidence: running ? null : (TRANSCRIPT.confidence ?? null),
        rounds: running ? rounds.slice(0, 1) : rounds,
      }),
    );
  }
  return notFound(res);
}

async function inkthread({ req, res, path, method }: Ctx): Promise<void> {
  if (method === "GET" && path === "/samples") return send(res, 200, SAMPLES);
  if (method === "POST" && path === "/documents") {
    await readBody(req);
    const documentId = randomUUID();
    const jobId = randomUUID();
    jobs.set(jobId, 0);
    const job = withKeys(object(UPLOAD.job ?? null, "upload job"), {
      id: jobId,
      document_id: documentId,
    });
    return send(
      res,
      201,
      withKeys(UPLOAD, {
        document: withKeys(object(UPLOAD.document ?? null, "upload document"), {
          id: documentId,
          latest_job: job,
        }),
        job,
      }),
    );
  }
  const job = /^\/jobs\/([^/]+)$/.exec(path);
  if (method === "GET" && job) {
    const id = job[1] ?? "";
    const reads = (jobs.get(id) ?? 1) + 1;
    jobs.set(id, reads);
    return send(
      res,
      200,
      withKeys(JOB, {
        id,
        ...(reads === 1
          ? { status: "running", stage: "read", finished_at: null }
          : { status: "succeeded" }),
      }),
    );
  }
  const page = /^\/documents\/([^/]+)\/pages\/(\d+)\.png$/.exec(path);
  if (method === "GET" && page) return send(res, 200, PAGE_PNG, "image/png");
  const why = /^\/documents\/([^/]+)\/why\/(.+)$/.exec(path);
  if (method === "GET" && why) {
    const element = decodeURIComponent(why[2] ?? "");
    return send(res, 200, withKeys(element.includes("#") ? WHY_ROLE : WHY_NODE, { element }));
  }
  const doc = /^\/documents\/([^/]+)(\/graph|\/reading)?$/.exec(path);
  if (method === "GET" && doc) {
    if (doc[2] === "/graph") return send(res, 200, GRAPH);
    if (doc[2] === "/reading") return send(res, 200, READING);
    return send(res, 200, withKeys(DOCUMENT, { id: doc[1] ?? "" }));
  }
  return notFound(res);
}

/** `/_slowquery` on any of the five hosts (slowquery-detective 0.2.0; the demo's own shapes). */
function slowqueryLog({ res, path, method }: Ctx, service: string): boolean {
  if (method !== "GET") return false;
  const demo = service === "slowquery";
  if (path === "/_slowquery/queries") {
    send(res, 200, demo ? QUERIES_DEMO : QUERIES);
    return true;
  }
  if (/^\/_slowquery\/queries\/[^/]+$/.test(path)) {
    send(res, 200, demo ? QUERY_DEMO : QUERY);
    return true;
  }
  return false;
}

async function slowquery({ req, res, path, method }: Ctx): Promise<void> {
  if (method === "GET" && path === "/branches/current") return send(res, 200, BRANCH);
  if (method === "POST" && path === "/branches/switch") {
    const body = await jsonBody(req);
    return send(
      res,
      200,
      withKeys(SWITCHED, { active: body.target ?? "fast", switched_at: now() }),
    );
  }
  return notFound(res);
}

async function feathersDemo({ req, res, path, method }: Ctx): Promise<void> {
  if (method === "GET" && path === "/users") {
    return send(
      res,
      200,
      [...users.values()].filter((u) => u.deleted_at === null),
    );
  }
  if (method === "POST" && path === "/users") {
    const body = await jsonBody(req);
    const user = withKeys(USER_CREATED, {
      id: randomUUID(),
      email: body.email ?? null,
      full_name: body.full_name ?? null,
      role: body.role ?? "viewer",
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
    });
    users.set(text(user.id ?? null, "id"), user);
    return send(res, 201, user);
  }
  const one = /^\/users\/([^/]+)$/.exec(path);
  if (one) {
    const user = users.get(one[1] ?? "");
    // Soft delete honoured: a deleted user reads as absent and cannot be deleted twice.
    if (user === undefined || user.deleted_at !== null) {
      return send(res, 404, { detail: "User not found" });
    }
    if (method === "GET") return send(res, 200, user);
    if (method === "DELETE") {
      user.deleted_at = now();
      res.writeHead(204);
      res.end();
      return;
    }
  }
  return notFound(res);
}

const HANDLERS: Record<string, (ctx: Ctx) => Promise<void>> = {
  magpie,
  inkprint,
  "paper-trail": paperTrail,
  inkthread,
  slowquery,
  "feathers-demo": feathersDemo,
};

// ---- the router -----------------------------------------------------------------------------

async function control(ctx: Ctx): Promise<void> {
  const { res, path, url, method } = ctx;
  if (path === "/__ready") return send(res, 200, { ok: true });
  if (method === "GET" && path === "/__control/log") {
    const tenant = url.searchParams.get("tenant");
    return send(res, 200, { calls: calls.filter((c) => tenant === null || c.tenant === tenant) });
  }
  if (method === "POST" && (path === "/__control/wake" || path === "/__control/sleep")) {
    limitsAwake = path === "/__control/wake";
    if (limitsAwake) for (const held of hanging) send(held, 200, { status: "ok" });
    hanging.clear();
    return send(res, 200, { awake: limitsAwake });
  }
  return notFound(res);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "https://localhost");
  const method = req.method ?? "GET";
  if (url.pathname.startsWith("/__")) {
    return control({ req, res, path: url.pathname, url, method });
  }
  const [, tenant = "", service = "", ...rest] = url.pathname.split("/");
  if (!TENANT_NAMES.includes(tenant) || !SERVICES.includes(service)) return notFound(res);
  const path = `/${rest.join("/")}`;
  const ctx: Ctx = { req, res, path, url, method };
  calls.push({ tenant, service, method, path, at: now() });
  if (calls.length > MAX_CALLS) calls.splice(0, calls.length - MAX_CALLS);

  if (path === "/health") {
    if (tenant === "limits" && service === "feathers-demo" && !limitsAwake) {
      // Asleep: the request is held until the caller gives up (or a test wakes the service).
      hanging.add(res);
      res.on("close", () => hanging.delete(res));
      return;
    }
    return send(res, 200, { status: "ok", service });
  }
  if (path === "/version") {
    return send(res, 200, {
      version: "e2e-stub",
      commit_sha: "e2e5tub0000000000000000000000000000000",
    });
  }
  if (service !== "feathers-demo" && slowqueryLog(ctx, service)) return;
  const handler = HANDLERS[service];
  if (handler === undefined) return notFound(res);
  return handler(ctx);
}

const server = createServer(
  { key: readFileSync(required("E2E_STUB_KEY")), cert: readFileSync(required("E2E_STUB_CERT")) },
  (req, res) => {
    route(req, res).catch((err: unknown) => {
      console.error("upstream stub:", req.method, req.url, err);
      send(res, 500, { detail: "stub error" });
    });
  },
);

const port = Number(required("E2E_STUB_PORT"));
server.listen(port, "127.0.0.1", () => {
  console.log(`upstream stub on https://localhost:${port}`);
});
