import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { inkprint } from "@/capabilities/inkprint";
import { slowquery } from "@/capabilities/slowquery";
import { listDocuments } from "@/dossier/documents";
import { listEvidence, saveSealed } from "@/dossier/evidence";
import { auditDigest } from "@/dossier/receipt-math";
import {
  findReceipt,
  recordTranscript,
  saveEnvelopeReceipt,
  saveReceiptOnce,
} from "@/dossier/receipts";
import { advance } from "@/dossier/runner";
import { initialSteps, type Stage, type StageHandler } from "@/dossier/stages";
import { envelopeStage } from "@/dossier/stages/envelope";
import { measureStage } from "@/dossier/stages/measure";
import { recordStage } from "@/dossier/stages/record";
import { getDb } from "@/lib/db/client";
import { dossierDocuments, dossierSteps, dossiers, receipts } from "@/lib/db/schema";
import { requestEvents } from "@/platform/audit/request-events";
import { appendEvent } from "@/platform/audit/write";
import { canonicalJson, type Json } from "@/platform/canonical-json";
import { sha256Hex } from "@/platform/sha256";

/**
 * The composed flow (spec 21 §6.1, §6.5, §10): the real runner advances a dossier whose debate is
 * done through measure → envelope → record, against Postgres, with only the downstream HTTP calls
 * faked (each fake appends the audit row the gateway would). Afterwards every hash is recomputed
 * from what was stored — the check a stranger's "verify everything" makes. Commits audit events
 * (append-only), so it runs only against a local, disposable server.
 */

const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const id = randomUUID();
const requestId = `it-flow-${id}`;
const DEBATE_ID = randomUUID();
const CERTS = [randomUUID(), randomUUID()];

const fixture = (service: string, name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/downstream", service, name), "utf8"));

async function audited(service: string): Promise<void> {
  await appendEvent({
    actor: "bastion",
    action: "gateway.call",
    entityType: "capability",
    entityId: `fake.${service}`,
    service,
    requestId,
  });
}

const queries = vi.fn(async (_ctx: unknown, input: { service: string }) => {
  await audited(input.service);
  if (input.service === "magpie") {
    return { ok: false as const, error: "downstream_error" as const, status: 404, requestId };
  }
  return {
    ok: true as const,
    data: slowquery.queries.output.parse(fixture("slowquery", "queries.json")),
    status: 200,
    requestId,
    ms: 1,
  };
});

type EnvelopeBody = {
  dossier_id: string;
  evidence_cert_ids: string[];
  debate_transcript_hash: string;
  perf_receipt_hash: string;
  metadata: Record<string, string>;
};
const envelope = vi.fn(async (_ctx: unknown, _input: EnvelopeBody) => {
  await audited("inkprint");
  const data = inkprint.envelope.output.parse(fixture("inkprint", "envelope.json"));
  return { ok: true as const, data: { ...data, envelope_id: id }, status: 201, requestId, ms: 1 };
});

const never: StageHandler = async () => {
  throw new Error("an earlier stage must not run again");
};
const handlers: Record<Stage, StageHandler> = {
  wake: never,
  gather: never,
  read: never,
  seal: never,
  debate: never,
  measure: measureStage({
    events: requestEvents,
    queries: queries as never,
    stored: findReceipt,
    save: saveReceiptOnce,
  }),
  envelope: envelopeStage({
    envelope: envelope as never,
    evidence: listEvidence,
    documents: listDocuments,
    receipt: findReceipt,
    events: requestEvents,
    save: saveEnvelopeReceipt,
  }),
  record: recordStage({ events: requestEvents, stored: findReceipt, save: saveReceiptOnce }),
};

async function seed(): Promise<void> {
  const db = getDb();
  await db.insert(dossiers).values({
    id,
    visitor: "v_kk6eooepno",
    claim: "small entity fees are reduced",
    sources: ["uspto"],
    mode: "rapid",
    status: "running",
    requestId,
  });
  await db.insert(dossierSteps).values(initialSteps(id, new Date(Date.now() - 60_000)));
  const done: Partial<Record<Stage, Json>> = {
    wake: { live: [], asleep: [] },
    gather: [],
    read: [],
    seal: { certified: 2, total: 2 },
    debate: { debateId: DEBATE_ID, verdict: "TRUE", confidence: 0.82, failedDebateIds: [] },
  };
  for (const [stage, output] of Object.entries(done)) {
    await db
      .update(dossierSteps)
      .set({ status: "ok", attempt: 1, output, finishedAt: new Date() })
      .where(and(eq(dossierSteps.dossierId, id), eq(dossierSteps.stage, stage as Stage)));
  }
  await db.insert(dossierDocuments).values([
    { dossierId: id, documentId: "doc-b", kind: "sample", graphHash: "b".repeat(64) },
    { dossierId: id, documentId: "doc-a", kind: "upload", graphHash: "a".repeat(64) },
  ]);
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
      inkprintHash: String(i).repeat(64),
      signature: "csig",
      text: `small entity fees are reduced ${i}`,
    })),
  );
  const saved = await recordTranscript(id, {
    debateId: DEBATE_ID,
    transcriptHash: "5".repeat(64),
    signature: "tsig==",
    payload: { debate_id: DEBATE_ID },
    verdict: "TRUE",
    confidence: 0.82,
  });
  if (!saved.ok) throw new Error(saved.error);
  // What the earlier stages logged under the request id: calls to five services, one without slowquery.
  for (const service of ["magpie", "inkthread", "inkprint", "paper-trail", "feathers-demo"]) {
    await audited(service);
  }
}

const payloadOf = async (kind: "perf" | "envelope" | "audit") => {
  const r = await findReceipt(id, kind);
  if (r === null) throw new Error(`no ${kind} receipt`);
  return { receipt: r, payload: r.payload as { [key: string]: Json } };
};

afterAll(async () => {
  if (LOCAL) await getDb().delete(dossiers).where(eq(dossiers.id, id));
});

describe.skipIf(!LOCAL)("measure → envelope → record, composed, against Postgres", () => {
  it("runs the three stages through the runner and the dossier succeeds", async () => {
    await seed();
    const ran = [];
    for (let i = 0; i < 3; i++) ran.push(await advance(id, handlers));
    expect(ran.map((r) => [r.ran, r.status])).toEqual([
      ["measure", "ok"],
      ["envelope", "ok"],
      ["record", "ok"],
    ]);
    expect(ran[2]?.dossier).toBe("succeeded");
    const [d] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    expect(d).toMatchObject({ status: "succeeded", error: null, envelopeId: id });
    expect((await advance(id, handlers)).ran).toBeNull();
  });

  it("measured every called service with slowquery, recording the one that did not answer", async () => {
    expect(queries.mock.calls.map((c) => c[1])).toEqual(
      ["inkprint", "inkthread", "magpie", "paper-trail"].map((service) => ({ service, requestId })),
    );
    const { receipt, payload } = await payloadOf("perf");
    const services = payload.services as Array<{
      service: string;
      error?: string;
      queries: unknown[];
    }>;
    expect(services.map((s) => [s.service, s.error ?? null, s.queries.length])).toEqual([
      ["inkprint", null, 2],
      ["inkthread", null, 2],
      ["magpie", "404", 0],
      ["paper-trail", null, 2],
    ]);
    // The stored payload, read back from jsonb, still hashes to the stored hash.
    expect(receipt.hash).toBe(sha256Hex(canonicalJson(receipt.payload as Json)));
  });

  it("enveloped exactly the stored certificates and receipts, and its audit digest recomputes", async () => {
    expect(envelope).toHaveBeenCalledOnce();
    const body = envelope.mock.calls[0]?.[1] as EnvelopeBody;
    const perf = await payloadOf("perf");
    const stored = (await listEvidence(id)).map((r) => r.certificateId);
    expect(body.evidence_cert_ids).toEqual(stored);
    expect([...body.evidence_cert_ids].sort()).toEqual([...CERTS].sort());
    expect(body.perf_receipt_hash).toBe(perf.receipt.hash);
    expect(body.debate_transcript_hash).toBe("5".repeat(64));
    expect(body.metadata).toMatchObject({
      request_id: requestId,
      graph_hashes: `${"a".repeat(64)},${"b".repeat(64)}`,
      transcript_signature: "tsig==",
      debate_id: DEBATE_ID,
    });
    expect(inkprint.envelope.input.safeParse(body).success).toBe(true);

    const { receipt, payload } = await payloadOf("envelope");
    expect(receipt).toMatchObject({ ref: id, signature: expect.any(String) });
    expect(payload.request).toEqual(body);
    const upTo = payload.audit_up_to as number;
    expect(body.metadata.audit_up_to).toBe(String(upTo));
    expect(body.metadata.audit_digest_at_envelope).toBe(
      auditDigest(await requestEvents(requestId, upTo)),
    );
    // The bound includes measure's own calls, but not the envelope's.
    const covered = await requestEvents(requestId, upTo);
    expect(covered.filter((e) => e.action === "gateway.call").length).toBe(5 + 4);
  });

  it("recorded an audit digest that recomputes over its bound, even after more events", async () => {
    const { receipt, payload } = await payloadOf("audit");
    const upTo = payload.up_to_event_id as number;
    const before = await requestEvents(requestId, upTo);
    expect(payload.event_count).toBe(before.length);
    expect(receipt.hash).toBe(auditDigest(before));
    await audited("magpie");
    expect(auditDigest(await requestEvents(requestId, upTo))).toBe(receipt.hash);
    expect(auditDigest(await requestEvents(requestId))).not.toBe(receipt.hash);
  });

  it("stored one receipt of each kind, and a re-run of each stage adds nothing and calls nothing", async () => {
    const calls = { queries: queries.mock.calls.length, envelope: envelope.mock.calls.length };
    const steps = await getDb().select().from(dossierSteps).where(eq(dossierSteps.dossierId, id));
    const outputs = Object.fromEntries(steps.map((s) => [s.stage, s.output])) as Partial<
      Record<Stage, Json>
    >;
    const [d] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    if (!d) throw new Error("no dossier");
    const ctx = {
      dossier: d,
      requestId,
      outputs,
      now: new Date(),
      attempt: 2,
      startedAt: new Date(),
      signal: new AbortController().signal,
    };
    for (const stage of ["measure", "envelope", "record"] as const) {
      expect((await handlers[stage](ctx)).kind).toBe("ok");
    }
    expect(queries.mock.calls.length).toBe(calls.queries);
    expect(envelope.mock.calls.length).toBe(calls.envelope);
    const kinds = await getDb()
      .select({ kind: receipts.kind })
      .from(receipts)
      .where(
        and(eq(receipts.dossierId, id), inArray(receipts.kind, ["perf", "envelope", "audit"])),
      );
    expect(kinds.map((k) => k.kind).sort()).toEqual(["audit", "envelope", "perf"]);
  });
});
