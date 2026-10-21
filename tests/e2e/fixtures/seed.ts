import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { isLocalDatabase } from "./env";

/**
 * Playwright's global setup for the stub run (spec 21 §10.1): writes the golden dossier — every
 * receipt really signed by inkprint's and paper-trail's own code (`tests/fixtures/receipts/`) — into
 * the run's local database, with its audit events at the exact ids the envelope's audit digest
 * covers. Before writing, it recomputes the perf hash and the audit digest independently of bastion
 * and checks them against what inkprint signed, so a drifted fixture fails here, not in a test.
 *
 * Re-runnable: the dossier is replaced; the append-only events are inserted once and then checked
 * to be exactly the golden ones. A database whose ids are taken by other events is refused.
 */

// Playwright loads this file as CommonJS (the package has no "type": "module").
const FIXTURES = join(__dirname, "..", "..", "fixtures", "receipts");
const read = (path: string): unknown => JSON.parse(readFileSync(join(FIXTURES, path), "utf8"));

const golden = z.object({
  dossier: z.object({ id: z.uuid(), requestId: z.string() }),
  certificates: z.array(z.object({ key: z.string(), id: z.uuid(), text: z.string() })),
  perf: z.object({
    dossier_id: z.string(),
    request_id: z.string(),
    services: z.array(
      z.object({
        service: z.string(),
        error: z.string().optional(),
        queries: z.array(
          z.object({
            id: z.string(),
            fingerprint: z.string(),
            calls: z.number(),
            total_ms: z.number(),
            max_ms: z.number().nullable(),
            suggestions: z.array(z.object({ kind: z.string(), sql: z.string().nullable() })),
          }),
        ),
      }),
    ),
  }),
  events: z.array(
    z.object({
      id: z.number().int().positive(),
      action: z.string(),
      service: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  envelopeUpTo: z.number().int(),
  recordUpTo: z.number().int(),
  documents: z.array(
    z.object({
      documentId: z.uuid(),
      kind: z.enum(["sample", "upload"]),
      sha256: z.string(),
      graphHash: z.string(),
    }),
  ),
});

const transcriptSchema = z.object({
  debate_id: z.uuid(),
  claim: z.string(),
  verdict: z.string(),
  confidence: z.number(),
  transcript_hash: z.string(),
  signature: z.string(),
});

const envelopeSchema = z.object({
  request: z.object({
    perf_receipt_hash: z.string(),
    metadata: z.object({ audit_digest_at_envelope: z.string() }),
  }),
  response: z.object({
    envelope_id: z.uuid(),
    envelope_manifest: z.record(z.string(), z.json()),
    envelope_signature: z.string(),
    created_at: z.string(),
  }),
});

const certifiedSchema = z.object({
  items: z.array(
    z.object({
      certificate: z.object({
        fingerprints: z.object({ sha256: z.string() }),
        manifest: z.object({ signature: z.object({ value: z.string() }) }),
      }),
    }),
  ),
});

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** RFC 8785 for the plain values these fixtures hold, written here so the seed checks bastion. */
function jcs(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`)
    .join(",")}}`;
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export default async function seedGoldenDossier(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!isLocalDatabase(url)) {
    throw new Error("e2e seed: DATABASE_URL must name a local Postgres (localhost only)");
  }
  const G = golden.parse(read("golden-dossier.json"));
  const T = transcriptSchema.parse(read("paper-trail/transcript-a.json"));
  const ENV = envelopeSchema.parse(read("inkprint/envelope-golden.json"));
  const CERTIFIED = certifiedSchema.parse(read("inkprint/certificates-golden.json")).items;
  // Stored payloads keep every key the issuers wrote (a schema above would strip the unknown ones).
  const whole = z.json();
  const fullTranscript = whole.parse(read("paper-trail/transcript-a.json"));
  const perfPayload = z.object({ perf: whole }).parse(read("golden-dossier.json")).perf;
  const envelopeRequest = z
    .object({ request: whole })
    .parse(read("inkprint/envelope-golden.json")).request;

  // The perf receipt holds exactly the hashed fields; an error key only when a service failed.
  const perfJson = {
    dossier_id: G.perf.dossier_id,
    request_id: G.perf.request_id,
    services: G.perf.services.map((s) => ({
      service: s.service,
      queries: s.queries.map((q) => ({
        id: q.id,
        fingerprint: q.fingerprint,
        calls: q.calls,
        total_ms: q.total_ms,
        max_ms: q.max_ms,
        suggestions: q.suggestions.map((x) => ({ kind: x.kind, sql: x.sql })),
      })),
      ...(s.error === undefined ? {} : { error: s.error }),
    })),
  };
  const digest = (events: typeof G.events) =>
    sha(
      jcs(
        [...events]
          .sort((a, b) => a.id - b.id)
          .map((e) => [e.id, e.action, e.service, e.createdAt]),
      ),
    );
  const perfHash = sha(jcs(perfJson));
  if (perfHash !== ENV.request.perf_receipt_hash) {
    throw new Error("e2e seed: the golden perf receipt does not hash to what inkprint signed");
  }
  const atEnvelope = digest(G.events.filter((e) => e.id <= G.envelopeUpTo));
  if (atEnvelope !== ENV.request.metadata.audit_digest_at_envelope) {
    throw new Error("e2e seed: the golden audit digest does not match what inkprint signed");
  }

  const D = G.dossier.id;
  const DOC = G.documents[0];
  if (DOC === undefined) throw new Error("e2e seed: the golden dossier has no document");
  // The dossier's own times are now, so it stays among the gallery's 6 newest however many runs
  // went before on this database (each run adds 2 succeeded dossiers). Only the events' times feed
  // the signed audit digest, and those keep the golden fixture's.
  const t0 = new Date(Date.now() - 110_000);
  const at = (s: number) => new Date(t0.getTime() + s * 1000);
  const recorded = G.events.filter((e) => e.id <= G.recordUpTo);
  const e = ENV.response;

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx`delete from dossiers where id = ${D}`;
      await tx`insert into dossiers (id, visitor, claim, sources, mode, status, verdict, confidence,
                                     request_id, envelope_id, created_at, updated_at)
        values (${D}, 'v_e2egolden2', ${T.claim}, ${["uspto"]}, 'rapid', 'succeeded', ${T.verdict},
                ${T.confidence.toFixed(2)}, ${G.dossier.requestId}, ${e.envelope_id}, ${t0}, ${at(110)})`;

      const outputs: Record<string, JsonValue> = {
        wake: { live: ["inkprint", "paper-trail", "magpie", "inkthread"] },
        gather: [{ key: "w-uspto-0" }],
        read: [{ key: "p-d0c0-n7" }],
        seal: { certified: 2, total: 2 },
        debate: {
          debateId: T.debate_id,
          verdict: T.verdict,
          confidence: T.confidence,
          failedDebateIds: [],
        },
        measure: { perfReceiptHash: perfHash, auditUpTo: G.envelopeUpTo },
        envelope: { envelopeId: e.envelope_id },
        record: { auditDigest: digest(recorded) },
      };
      const ends: [string, number][] = [
        ["wake", 4],
        ["gather", 9],
        ["read", 15],
        ["seal", 22],
        ["debate", 88],
        ["measure", 95],
        ["envelope", 101],
        ["record", 104],
      ];
      let start = 0;
      for (const [stage, end] of ends) {
        await tx`insert into dossier_steps (dossier_id, stage, status, attempt, lease_until, not_before,
                                            started_at, finished_at, output)
          values (${D}, ${stage}, 'ok', 1, 'epoch', ${at(start)}, ${at(start)}, ${at(end)},
                  ${tx.json(outputs[stage] ?? null)})`;
        start = end;
      }
      await tx`insert into dossier_documents (dossier_id, document_id, sha256, title, kind, graph_hash, page_count)
        values (${D}, ${DOC.documentId}, ${DOC.sha256}, 'uspto-fee-schedule.pdf', ${DOC.kind},
                ${DOC.graphHash}, 15)`;

      const rows: Record<
        string,
        { kind: string; product: string; url: string; title: string; locator: JsonValue }
      > = {
        "w-uspto-0": {
          kind: "web",
          product: "magpie",
          url: "https://www.uspto.gov/learning-and-resources/fees-and-payment",
          title: "USPTO fee schedule — fees and payment",
          locator: {
            kind: "url",
            url: "https://www.uspto.gov/learning-and-resources/fees-and-payment",
          },
        },
        "p-d0c0-n7": {
          kind: "passage",
          product: "inkthread",
          url: `https://bastion-six.vercel.app/d/${D}#e-p-d0c0-n7`,
          title: "Patent fees",
          locator: {
            kind: "document",
            documentId: DOC.documentId,
            sha256: DOC.sha256,
            page: 1,
            bbox: [50.39, 242.62, 579.64, 368.18],
            nodeId: "p:c95bca1f83faa250",
          },
        },
      };
      for (const [i, c] of G.certificates.entries()) {
        const row = rows[c.key];
        const cert = CERTIFIED[i]?.certificate;
        if (row === undefined || cert === undefined) {
          throw new Error(`e2e seed: no evidence row or certificate for ${c.key}`);
        }
        await tx`insert into evidence_items (dossier_id, source, stable_id, url, title, certificate_id,
                                             content_hash, kind, product, locator, excerpt, inkprint_hash, created_at)
          values (${D}, ${row.product}, ${c.key}, ${row.url}, ${row.title}, ${c.id}, ${sha(c.text)},
                  ${row.kind}, ${row.product}, ${tx.json(row.locator)}, ${c.text.slice(0, 400)},
                  ${cert.fingerprints.sha256}, ${at(22)})`;
        await tx`insert into receipts (dossier_id, kind, ref, hash, signature, payload, created_at)
          values (${D}, 'certificate', ${c.id}, ${cert.fingerprints.sha256}, ${cert.manifest.signature.value},
                  ${tx.json({ text: c.text, key: c.key })}, ${at(22)})`;
      }
      await tx`insert into receipts (dossier_id, kind, ref, hash, signature, payload, created_at)
        values (${D}, 'transcript', ${T.debate_id}, ${T.transcript_hash}, ${T.signature},
                ${tx.json(fullTranscript)}, ${at(88)})`;
      await tx`insert into receipts (dossier_id, kind, ref, hash, signature, payload, created_at)
        values (${D}, 'perf', ${G.dossier.requestId}, ${perfHash}, null, ${tx.json(perfPayload)}, ${at(95)})`;
      await tx`insert into receipts (dossier_id, kind, ref, hash, signature, payload, created_at)
        values (${D}, 'envelope', ${e.envelope_id}, ${sha(jcs(e.envelope_manifest))}, ${e.envelope_signature},
                ${tx.json({
                  envelope_id: e.envelope_id,
                  envelope_manifest: e.envelope_manifest,
                  envelope_signature: e.envelope_signature,
                  created_at: e.created_at,
                  audit_up_to: G.envelopeUpTo,
                  request: envelopeRequest,
                })}, ${at(101)})`;
      await tx`insert into receipts (dossier_id, kind, ref, hash, signature, payload, created_at)
        values (${D}, 'audit', ${G.dossier.requestId}, ${digest(recorded)}, null,
                ${tx.json({ request_id: G.dossier.requestId, up_to_event_id: G.recordUpTo, event_count: recorded.length })},
                ${at(104)})`;

      // The log is append-only: insert each golden event once, then prove the ids hold exactly it.
      for (const ev of G.events) {
        await tx`insert into events (id, actor, action, entity_type, entity_id, service, request_id, metadata, created_at)
          values (${ev.id}, 'bastion', ${ev.action}, 'dossier', ${D}, ${ev.service}, ${G.dossier.requestId},
                  ${tx.json({})}, ${new Date(ev.createdAt)})
          on conflict (id) do nothing`;
      }
      const held = await tx<
        {
          id: number;
          action: string;
          service: string | null;
          request_id: string | null;
          at: string;
        }[]
      >`
        select id::int as id, action, service, request_id,
               to_char(date_trunc('milliseconds', created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
        from events where id = any(${G.events.map((ev) => ev.id)}) order by id`;
      const same =
        held.length === G.events.length &&
        held.every((row, i) => {
          const ev = G.events[i];
          return (
            ev !== undefined &&
            row.id === ev.id &&
            row.action === ev.action &&
            row.service === ev.service &&
            row.request_id === G.dossier.requestId &&
            row.at === ev.createdAt
          );
        });
      if (!same) {
        throw new Error(
          `e2e seed: event ids ${G.events.map((ev) => ev.id).join(", ")} hold other events — run the e2e suite on a fresh, migrated database`,
        );
      }
      await tx`select setval('events_id_seq', greatest((select max(id) from events), 100))`;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
