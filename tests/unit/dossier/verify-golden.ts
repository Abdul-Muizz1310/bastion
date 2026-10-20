import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inkprint } from "@/capabilities/inkprint";
import { inkthread } from "@/capabilities/inkthread";
import { paperTrail } from "@/capabilities/paper-trail";
import { auditDigest, type PerfReceipt, perfReceiptHash } from "@/dossier/receipt-math";
import type { StoredReceipt } from "@/dossier/receipts";
import type { DossierDocument } from "@/lib/db/schema";
import type { RequestEvent } from "@/platform/audit/request-events";
import { canonicalJson, type Json } from "@/platform/canonical-json";
import type { GatewayResult, RawBody } from "@/platform/gateway/result";
import { sha256Hex } from "@/platform/sha256";

/**
 * A fully consistent, really signed dossier for the verify tests (spec 21 §6.5): the stored
 * receipts bastion's stages would have written for `tests/fixtures/receipts/golden-dossier.json`,
 * with transcript-a signed by paper-trail's own code and the envelope signed by inkprint's own
 * code (`tests/fixtures/receipts/generate/`), and the live answers each issuer would give now.
 */

const dir = resolve(__dirname, "../../fixtures");
const json = (path: string): unknown => JSON.parse(readFileSync(resolve(dir, path), "utf8"));

type Golden = {
  dossier: { id: string; requestId: string };
  certificates: { id: string; key: string; text: string }[];
  transcript: string;
  perf: PerfReceipt;
  events: { id: number; action: string; service: string | null; createdAt: string }[];
  envelopeUpTo: number;
  recordUpTo: number;
  documents: { documentId: string; kind: "sample" | "upload"; sha256: string; graphHash: string }[];
};

export const GOLDEN = json("receipts/golden-dossier.json") as Golden;
export const DOSSIER = GOLDEN.dossier;
const AT = new Date("2026-10-20T09:10:00Z");

export const EVENTS: RequestEvent[] = GOLDEN.events.map((e) => ({
  ...e,
  createdAt: new Date(e.createdAt),
}));
export const eventsUpTo = (bound: number) => EVENTS.filter((e) => e.id <= bound);

export const TRANSCRIPT = paperTrail.transcript.output.parse(json(`receipts/${GOLDEN.transcript}`));
export const RECEIPT_KEY = paperTrail.receiptKey.output.parse(
  json("receipts/paper-trail/receipt-key.json"),
);
const envelopeFixture = json("receipts/inkprint/envelope-golden.json") as {
  request: Json;
  response: unknown;
};
export const ENVELOPE = inkprint.envelope.output.parse(envelopeFixture.response);
export const ENVELOPE_REQUEST = envelopeFixture.request as { [key: string]: Json };
export const INKPRINT_PEM = readFileSync(resolve(dir, "receipts/inkprint/public-key.pem"));
export const GRAPH = inkthread.graph.output.parse(json("downstream/inkthread/graph.json"));

/** A receipt row; `n` makes its id, so the same receipt always has the same id. */
function receipt(
  n: number,
  over: Partial<StoredReceipt> & Pick<StoredReceipt, "kind">,
): StoredReceipt {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    ref: null,
    hash: null,
    signature: null,
    payload: null,
    createdAt: AT,
    ...over,
  };
}

export function certificateReceipts(): StoredReceipt[] {
  return GOLDEN.certificates.map((c, i) =>
    receipt(1 + i, {
      kind: "certificate",
      ref: c.id,
      hash: sha256Hex(c.text),
      signature: "csig",
      payload: { text: c.text, key: c.key },
    }),
  );
}

export function transcriptReceipt(): StoredReceipt {
  return receipt(10, {
    kind: "transcript",
    ref: TRANSCRIPT.debate_id,
    hash: TRANSCRIPT.transcript_hash,
    signature: TRANSCRIPT.signature,
    payload: TRANSCRIPT as unknown as Json,
  });
}

export function perfReceipt(): StoredReceipt {
  return receipt(11, {
    kind: "perf",
    ref: DOSSIER.requestId,
    hash: perfReceiptHash(GOLDEN.perf),
    payload: GOLDEN.perf as unknown as Json,
  });
}

export function envelopeReceipt(): StoredReceipt {
  return receipt(12, {
    kind: "envelope",
    ref: ENVELOPE.envelope_id,
    hash: sha256Hex(canonicalJson(ENVELOPE.envelope_manifest as Json)),
    signature: ENVELOPE.envelope_signature,
    payload: {
      envelope_id: ENVELOPE.envelope_id,
      envelope_manifest: ENVELOPE.envelope_manifest as Json,
      envelope_signature: ENVELOPE.envelope_signature,
      created_at: ENVELOPE.created_at,
      audit_up_to: GOLDEN.envelopeUpTo,
      request: ENVELOPE_REQUEST,
    },
  });
}

export function auditReceipt(): StoredReceipt {
  const events = eventsUpTo(GOLDEN.recordUpTo);
  return receipt(13, {
    kind: "audit",
    ref: DOSSIER.requestId,
    hash: auditDigest(events),
    payload: {
      request_id: DOSSIER.requestId,
      up_to_event_id: GOLDEN.recordUpTo,
      event_count: events.length,
    },
  });
}

export function allReceipts(): StoredReceipt[] {
  return [
    ...certificateReceipts(),
    transcriptReceipt(),
    perfReceipt(),
    envelopeReceipt(),
    auditReceipt(),
  ];
}

export function documents(): DossierDocument[] {
  return GOLDEN.documents.map((d) => ({
    dossierId: DOSSIER.id,
    documentId: d.documentId,
    sha256: d.sha256,
    title: null,
    kind: d.kind,
    graphHash: d.graphHash,
    pageCount: 15,
    jobId: null,
  }));
}

export function ok<T>(data: T, status = 200): GatewayResult<T> {
  return { ok: true, data, status, requestId: "req-verify", ms: 1 };
}

type Failure = Extract<GatewayResult<never>, { ok: false }>;
export function failed(
  error: Failure["error"],
  status: number,
  extra: { detail?: string; retryAfterS?: number } = {},
): Failure {
  return { ok: false, error, status, requestId: "req-verify", ...extra };
}

/** Every way a downstream can be out — none of them may ever read as a pass. */
export const OUTAGES: [string, Failure][] = [
  ["asleep", failed("asleep", 504)],
  ["a 5xx", failed("downstream_error", 502, { detail: "HTTP 503" })],
  ["a network error", failed("downstream_error", 502, { detail: "network_error" })],
  ["a 401", failed("downstream_error", 401, { detail: "invalid platform token" })],
  ["an unexpected body", failed("invalid_response", 502, { detail: "x: invalid_type" })],
  ["the gateway's rate limit", failed("rate_limited", 429, { retryAfterS: 12 })],
];

export function publicKeyBody(pem: Uint8Array = INKPRINT_PEM): RawBody {
  return { contentType: "text/plain; charset=utf-8", bytes: new Uint8Array(pem) };
}

export function verifyAllValid() {
  return {
    results: GOLDEN.certificates.map((c) => ({
      certificate_id: c.id,
      valid: true,
      checks: { signature: true, hash: true, simhash: true, embedding: true },
      reason: null,
    })),
  };
}

/** A copy with one path replaced: `edit(value, ["a", 0, "b"], 1)`. */
export function edit<T>(value: T, path: (string | number)[], replacement: unknown): T {
  const copy = structuredClone(value) as unknown;
  let at = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
  at[path[path.length - 1] as string | number] = replacement;
  return copy as T;
}
