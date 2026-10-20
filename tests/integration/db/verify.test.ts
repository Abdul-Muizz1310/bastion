import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * "Verify everything" composed, against Postgres (spec 21 §6.5, §10): a dossier's receipts are
 * written by the real adapters and the real envelope and record stages; then the real
 * `POST /api/dossiers/[id]/verify` route re-checks them through the real shell, adapters and audit
 * log, and the real `GET /api/dossiers/[id]/receipts` route serves the bundle. Only the downstream
 * HTTP answers are faked, at `callCapability`: inkprint answers that it still holds every
 * certificate, paper-trail serves a transcript its own code signed (fixture), inkthread serves the
 * graph, and the certificates and the envelope are signed by a stand-in for inkprint with a test key
 * (inkprint's own bytes are proven against its code in tests/unit/dossier/issuer-forms.test.ts). Commits audit events (append-only), so it runs only
 * against a local, disposable server.
 */

const m = vi.hoisted(() => ({ callCapability: vi.fn() }));
vi.mock("@/platform/gateway/call", () => ({ callCapability: m.callCapability }));

import { NextRequest } from "next/server";
import { GET as receiptsRoute } from "@/app/api/dossiers/[id]/receipts/route";
import { POST as verifyRoute } from "@/app/api/dossiers/[id]/verify/route";
import { inkprint } from "@/capabilities/inkprint";
import { inkthread } from "@/capabilities/inkthread";
import { paperTrail } from "@/capabilities/paper-trail";
import { listDocuments } from "@/dossier/documents";
import { listEvidence, saveSealed } from "@/dossier/evidence";
import { envelopeBundleJson, inkprintCanonicalText } from "@/dossier/issuer-forms";
import { type PerfReceipt, perfReceiptHash } from "@/dossier/receipt-math";
import {
  findReceipt,
  recordTranscript,
  saveEnvelopeReceipt,
  saveReceiptOnce,
} from "@/dossier/receipts";
import { initialSteps } from "@/dossier/stages";
import { envelopeStage } from "@/dossier/stages/envelope";
import { recordStage } from "@/dossier/stages/record";
import type { Check } from "@/dossier/verify";
import { getDb } from "@/lib/db/client";
import { dossierDocuments, dossierSteps, dossiers, events, receipts } from "@/lib/db/schema";
import { requestEvents } from "@/platform/audit/request-events";
import { appendEvent } from "@/platform/audit/write";
import type { Json } from "@/platform/canonical-json";
import { sha256Hex } from "@/platform/sha256";

const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const id = randomUUID();
const requestId = `it-verify-${id}`;
const DOC = randomUUID();
const CERTS = [randomUUID(), randomUUID()];

const fixtures = resolve(__dirname, "../../fixtures");
const json = (path: string): unknown => JSON.parse(readFileSync(resolve(fixtures, path), "utf8"));
const TRANSCRIPT = paperTrail.transcript.output.parse(
  json("receipts/paper-trail/transcript-a.json"),
);
const RECEIPT_KEY = paperTrail.receiptKey.output.parse(
  json("receipts/paper-trail/receipt-key.json"),
);
const GRAPH = inkthread.graph.output.parse(json("downstream/inkthread/graph.json"));

// A stand-in for inkprint's envelope signing (the bytes are proven against inkprint's own code in
// tests/unit/dossier/issuer-forms.test.ts): its key, its manifest shape, its isoformat time.
const inkprintKey = generateKeyPairSync("ed25519");
const INKPRINT_PEM = inkprintKey.publicKey.export({ type: "spki", format: "pem" }).toString();

type EnvelopeInput = {
  dossier_id: string;
  evidence_cert_ids: string[];
  debate_transcript_hash: string;
  perf_receipt_hash: string;
  metadata: Record<string, string>;
};

function inkprintEnvelope(input: EnvelopeInput) {
  const issuedAt = new Date().toISOString().replace("Z", "000+00:00");
  const bundle = envelopeBundleJson({ ...input, issued_at: issuedAt });
  const signature = sign(null, Buffer.from(bundle, "utf8"), inkprintKey.privateKey).toString(
    "base64",
  );
  const hash = (label: string, value: string) => ({ label, data: { alg: "sha256", hash: value } });
  const manifest = {
    "@context": "https://c2pa.org/statements/v1",
    version: "2.2",
    title: `Dossier envelope ${input.dossier_id}`,
    instance_id: `urn:uuid:${input.dossier_id}`,
    issued_at: issuedAt,
    assertions: [
      ...input.evidence_cert_ids.map((c) => ({
        label: "c2pa.ingredient.v2",
        data: {
          relationship: "inputTo",
          url: `/certificates/${c}/manifest`,
          instance_id: `urn:uuid:${c}`,
        },
      })),
      hash("bastion.debate_transcript_hash", input.debate_transcript_hash),
      hash("bastion.perf_receipt_hash", input.perf_receipt_hash),
      { label: "c2pa.hash.data", data: { alg: "sha256", hash: sha256Hex(bundle), pad: "" } },
    ],
    signature: { alg: "Ed25519", key_id: "test", value: signature },
  };
  return {
    ok: true as const,
    data: {
      envelope_id: input.dossier_id,
      envelope_manifest: manifest,
      envelope_signature: signature,
      created_at: issuedAt.replace("000+00:00", "Z"),
    },
    status: 200,
    requestId,
    ms: 1,
  };
}

/** A certificate as inkprint issues one: sha256 and Ed25519 over the canonical text. */
function inkprintCertificate(text: string) {
  const canonical = inkprintCanonicalText(text);
  return {
    inkprintHash: sha256Hex(canonical),
    signature: sign(null, Buffer.from(canonical, "utf8"), inkprintKey.privateKey).toString(
      "base64",
    ),
  };
}

/** What each issuer answers now. */
function downstream(cap: { id: string }, input: unknown) {
  const ok = (data: unknown) => ({ ok: true, data, status: 200, requestId: "r", ms: 1 });
  switch (cap.id) {
    case inkprint.verifyBatch.id: {
      const items = (input as { items: { certificate_id: string }[] }).items;
      return ok({
        results: items.map((i) => ({
          certificate_id: i.certificate_id,
          valid: true,
          checks: { signature: true, hash: true },
          reason: null,
        })),
      });
    }
    case paperTrail.transcript.id:
      return ok(structuredClone(TRANSCRIPT));
    case paperTrail.receiptKey.id:
      return ok(RECEIPT_KEY);
    case inkprint.publicKey.id:
      return ok({ contentType: "text/plain", bytes: new TextEncoder().encode(INKPRINT_PEM) });
    case inkthread.graph.id:
      return ok(GRAPH);
    default:
      throw new Error(`unexpected capability ${cap.id}`);
  }
}

const PERF: PerfReceipt = {
  dossier_id: id,
  request_id: requestId,
  services: [
    {
      service: "inkprint",
      queries: [
        {
          id: "q1",
          fingerprint: "select 1",
          calls: 2,
          total_ms: 4.5,
          max_ms: null,
          suggestions: [],
        },
      ],
    },
    { service: "magpie", queries: [], error: "asleep" },
  ],
};

async function seed(): Promise<void> {
  const db = getDb();
  await db.insert(dossiers).values({
    id,
    visitor: "v_kk6eooepno",
    claim: TRANSCRIPT.claim,
    sources: ["uspto"],
    mode: "rapid",
    status: "running",
    requestId,
  });
  // A v2 dossier: the runner's step rows exist (Ruling Z treats a dossier without them as legacy).
  await db.insert(dossierSteps).values(initialSteps(id, new Date()));
  await db.insert(dossierDocuments).values({
    dossierId: id,
    documentId: DOC,
    kind: "sample",
    sha256: GRAPH.document.sha256,
    graphHash: GRAPH.provenance.graph_hash,
    pageCount: GRAPH.document.page_count,
  });
  await saveSealed(
    id,
    CERTS.map((certificateId, i) => ({
      candidate: {
        key: `w-uspto-${i}`,
        kind: "web" as const,
        product: "magpie" as const,
        title: `fee ${i}`,
        url: `https://example.org/${i}`,
        text: `small entity fees are reduced ${i}`,
        locator: { kind: "url" as const, url: `https://example.org/${i}` },
        magpieHash: `m${i}`,
      },
      certificateId,
      contentHash: `m${i}`,
      ...inkprintCertificate(`small entity fees are reduced ${i}`),
      text: `small entity fees are reduced ${i}`,
    })),
  );
  const saved = await recordTranscript(id, {
    debateId: TRANSCRIPT.debate_id,
    transcriptHash: TRANSCRIPT.transcript_hash,
    signature: TRANSCRIPT.signature,
    payload: TRANSCRIPT,
    verdict: TRANSCRIPT.verdict,
    confidence: TRANSCRIPT.confidence,
  });
  if (!saved.ok) throw new Error(saved.error);
  for (const service of ["magpie", "inkprint", "paper-trail", "inkthread"]) {
    await appendEvent({
      actor: "bastion",
      action: "gateway.call",
      entityType: "capability",
      entityId: `fake.${service}`,
      service,
      requestId,
    });
  }
  await saveReceiptOnce(id, {
    kind: "perf",
    ref: requestId,
    hash: perfReceiptHash(PERF),
    signature: null,
    payload: PERF as unknown as Json,
  });

  const [row] = await db.select().from(dossiers).where(eq(dossiers.id, id));
  if (!row) throw new Error("no dossier");
  const auditUpTo = Math.max(...(await requestEvents(requestId)).map((e) => e.id));
  const ctx = {
    dossier: row,
    requestId,
    outputs: {
      debate: { debateId: TRANSCRIPT.debate_id, failedDebateIds: [] },
      measure: { perfReceiptHash: perfReceiptHash(PERF), auditUpTo },
    },
    now: new Date(),
    attempt: 1,
    startedAt: new Date(),
    signal: new AbortController().signal,
  };
  const envelope = await envelopeStage({
    envelope: (async (_ctx: unknown, input: EnvelopeInput) => inkprintEnvelope(input)) as never,
    evidence: listEvidence,
    documents: listDocuments,
    receipt: findReceipt,
    events: requestEvents,
    save: saveEnvelopeReceipt,
  })(ctx);
  if (envelope.kind !== "ok") throw new Error(JSON.stringify(envelope));
  await appendEvent({
    actor: "bastion",
    action: "dossier.stage.ok",
    entityType: "dossier",
    entityId: id,
    service: "bastion",
    requestId,
  });
  const recorded = await recordStage({
    events: requestEvents,
    stored: findReceipt,
    save: saveReceiptOnce,
  })(ctx);
  if (recorded.kind !== "ok") throw new Error(JSON.stringify(recorded));
  // The runner marks the dossier succeeded once record is ok.
  await db.update(dossiers).set({ status: "succeeded" }).where(eq(dossiers.id, id));
}

async function verify(): Promise<{ res: Response; checks: Check[] }> {
  const req = new NextRequest(`https://bastion.test/api/dossiers/${id}/verify`, {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.23" },
  });
  const res = await verifyRoute(req, { params: Promise.resolve({ id }) });
  const body = (await res.clone().json()) as { checks: Check[] };
  return { res, checks: body.checks };
}

const states = (checks: Check[]) => Object.fromEntries(checks.map((c) => [c.name, c.state]));
const ALL_PASS = {
  certificates: "pass",
  transcript: "pass",
  envelope: "pass",
  perf: "pass",
  audit: "pass",
  documents: "pass",
  steps: "pass",
};

beforeAll(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  m.callCapability.mockImplementation(async (cap: { id: string }, input: unknown) =>
    downstream(cap, input),
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (LOCAL) await getDb().delete(dossiers).where(eq(dossiers.id, id));
});

describe.skipIf(!LOCAL)("verify everything, composed, against Postgres", () => {
  it("re-checks every receipt the stages stored: six checks, all pass", async () => {
    await seed();
    const { res, checks } = await verify();
    expect(res.status).toBe(200);
    expect(states(checks)).toEqual(ALL_PASS);
  });

  it("asked each issuer as the system actor (Ruling W), under the verify run's own id", async () => {
    const before = m.callCapability.mock.calls.length;
    const { res } = await verify();
    const calls = m.callCapability.mock.calls.slice(before);
    expect(calls.map(([cap]) => cap.id).sort()).toEqual(
      [
        inkprint.verifyBatch.id,
        paperTrail.transcript.id,
        paperTrail.receiptKey.id,
        inkprint.publicKey.id,
        inkthread.graph.id,
      ].sort(),
    );
    for (const [, , ctx] of calls) {
      expect(ctx).toMatchObject({
        requestId: res.headers.get("x-request-id"),
        clientIp: "198.51.100.23",
      });
      expect(ctx.actor).toBe("bastion");
      expect(ctx.requestId).not.toBe(requestId);
    }
  });

  it("stored nothing but one dossier.verified audit event per verification, outside the dossier's slice", async () => {
    const { res } = await verify();
    const verifyId = res.headers.get("x-request-id") ?? "";
    const rows = await getDb()
      .select()
      .from(events)
      .where(and(eq(events.requestId, verifyId), eq(events.action, "dossier.verified")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: "dossier", entityId: id, service: "bastion" });
    expect(rows[0]?.actor).toMatch(/^v_/);
    expect(rows[0]?.metadata).toEqual({ checks: ALL_PASS });
    const kinds = await getDb()
      .select({ kind: receipts.kind })
      .from(receipts)
      .where(eq(receipts.dossierId, id));
    expect(kinds).toHaveLength(6);
  });

  it("still passes after more events are logged under the dossier's request id (excluded by id)", async () => {
    await appendEvent({
      actor: "bastion",
      action: "dossier.later",
      entityType: "dossier",
      entityId: id,
      service: "bastion",
      requestId,
    });
    expect(states((await verify()).checks)).toEqual(ALL_PASS);
  });

  it("serves the bundle a stranger re-checks: the same receipts, as a download", async () => {
    const res = await receiptsRoute(
      new Request(`https://bastion.test/api/dossiers/${id}/receipts`),
      {
        params: Promise.resolve({ id }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="dossier-${id}.receipts.json"`,
    );
    const bundle = (await res.json()) as {
      dossier: Record<string, unknown>;
      evidence: unknown[];
      documents: { graph_hash: string }[];
      receipts: { kind: string; hash: string; payload: Json }[];
    };
    expect(bundle.dossier).toMatchObject({ id, request_id: requestId, envelope_id: id });
    expect(bundle.dossier).not.toHaveProperty("visitor");
    expect(bundle.evidence).toHaveLength(2);
    expect(bundle.documents.map((d) => d.graph_hash)).toEqual([GRAPH.provenance.graph_hash]);
    expect(bundle.receipts.map((r) => r.kind).sort()).toEqual([
      "audit",
      "certificate",
      "certificate",
      "envelope",
      "perf",
      "transcript",
    ]);
    const perf = bundle.receipts.find((r) => r.kind === "perf");
    expect(perf?.hash).toBe(perfReceiptHash(perf?.payload as unknown as PerfReceipt));
  });

  it("a one-word edit of a certified text fails, though inkprint answers valid:true", async () => {
    const [first] = await getDb()
      .select()
      .from(receipts)
      .where(
        and(
          eq(receipts.dossierId, id),
          eq(receipts.kind, "certificate"),
          eq(receipts.ref, CERTS[0] ?? ""),
        ),
      );
    if (!first) throw new Error("no certificate receipt");
    await getDb().execute(sql`
      UPDATE receipts SET payload = jsonb_set(payload, '{text}', '"small entity fees are not reduced 0"')
      WHERE id = ${first.id}
    `);
    expect(states((await verify()).checks)).toEqual({ ...ALL_PASS, certificates: "fail" });
    await getDb().update(receipts).set({ payload: first.payload }).where(eq(receipts.id, first.id));
    expect(states((await verify()).checks)).toEqual(ALL_PASS);
  });

  it("a verdict edited on the dossier row fails the transcript check", async () => {
    await getDb().update(dossiers).set({ verdict: "FALSE" }).where(eq(dossiers.id, id));
    expect(states((await verify()).checks)).toEqual({ ...ALL_PASS, transcript: "fail" });
    await getDb().update(dossiers).set({ verdict: TRANSCRIPT.verdict }).where(eq(dossiers.id, id));
  });

  it("a transcript tampered in bastion's database fails, and the rest still pass", async () => {
    await getDb().execute(sql`
      UPDATE receipts SET payload = jsonb_set(payload, '{verdict}', '"FALSE"')
      WHERE dossier_id = ${id} AND kind = 'transcript'
    `);
    const { checks } = await verify();
    expect(states(checks)).toEqual({ ...ALL_PASS, transcript: "fail" });
  });

  it("a downstream outage is unavailable, never a pass", async () => {
    m.callCapability.mockImplementation(async (cap: { id: string }, input: unknown) =>
      cap.id === inkthread.graph.id
        ? { ok: false, error: "asleep", status: 504, requestId: "r" }
        : downstream(cap, input),
    );
    const { checks } = await verify();
    expect(states(checks).documents).toBe("unavailable");
  });

  it("deleting a v2 dossier's step rows does not make it legacy: steps fails (amended Ruling Z)", async () => {
    await getDb().delete(dossierSteps).where(eq(dossierSteps.dossierId, id));
    try {
      const { res, checks } = await verify();
      const body = (await res.json()) as { legacy: boolean };
      expect(body.legacy).toBe(false);
      expect(states(checks)).toMatchObject({
        steps: "fail",
        certificates: "pass",
        envelope: "pass",
      });
      expect(checks.find((c) => c.name === "steps")?.detail).toBe("receipts but no step rows");
    } finally {
      await getDb().insert(dossierSteps).values(initialSteps(id, new Date()));
    }
  });

  it("a v1 dossier (no step rows, no receipts, no visitor) answers legacy (amended Ruling Z)", async () => {
    const legacyId = randomUUID();
    await getDb()
      .insert(dossiers)
      .values({
        id: legacyId,
        claim: "a v1 dossier",
        sources: [],
        mode: "rapid",
        status: "succeeded",
        verdict: "TRUE",
        confidence: "0.90",
        requestId: `it-verify-legacy-${legacyId}`,
      });
    try {
      const res = await verifyRoute(
        new NextRequest(`https://bastion.test/api/dossiers/${legacyId}/verify`, { method: "POST" }),
        { params: Promise.resolve({ id: legacyId }) },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        dossierId: legacyId,
        legacy: true,
        note: "this dossier predates verifiable receipts",
        checks: [],
      });
    } finally {
      await getDb().delete(dossiers).where(eq(dossiers.id, legacyId));
    }
  });

  it("404 for a dossier that does not exist", async () => {
    const other = randomUUID();
    const res = await verifyRoute(
      new NextRequest(`https://bastion.test/api/dossiers/${other}/verify`, { method: "POST" }),
      { params: Promise.resolve({ id: other }) },
    );
    expect(res.status).toBe(404);
    const bundle = await receiptsRoute(new Request("https://bastion.test/x"), {
      params: Promise.resolve({ id: other }),
    });
    expect(bundle.status).toBe(404);
  });
});
