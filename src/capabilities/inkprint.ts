import { z } from "zod";
import type { Capability } from "@/platform/gateway/call";
import type { RawBody } from "@/platform/gateway/result";
import {
  hex64,
  isoDateTime,
  jsonObject,
  noInput,
  nonBlank,
  pemBody,
  pngBody,
  seg,
  stringMap,
  uuid,
} from "./shared";

/**
 * inkprint (spec 21 §5, §6): certificates, verification, diff, leak scans, dossier envelopes and
 * the public key. Response schemas mirror inkprint-backend's `schemas/certificate.py`
 * (`CertificateResponse`, `CertificateDetail`, `VerifyResponse`, `DiffResponse`, `LeakScanResponse`),
 * `schemas/batch.py`, `schemas/envelope.py`, and the leak-scan job record
 * (`repositories/leak_repo.py::_job_to_record`, results from `save_results`).
 *
 * Ruling I: inkprint answers 413/422 (size, body) and 404 (unknown certificate for a leak scan, or
 * parent for a diff) before it signs, embeds or queries a corpus, so a 4xx releases the
 * `certify`/`leakscan` budget.
 */

/** inkprint's `max_text_bytes` for `POST /certificates` (core/config.py). */
const MAX_TEXT_BYTES = 500_000;
/** The batch item's `max_length` (characters). */
const MAX_BATCH_TEXT = 1_000_000;
const MAX_BATCH = 50;
export const CORPORA = ["common_crawl", "huggingface", "the_stack_v2"] as const;

const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

/**
 * A 64-bit SimHash. JSON numbers past 2^53 arrive rounded, and `.int()` would refuse them (Zod
 * accepts only safe integers), so it is a plain number; bastion never computes with it.
 */
const simhash = z.number();

const certificateText = nonBlank.refine((s) => utf8Bytes(s) <= MAX_TEXT_BYTES, {
  message: `must be at most ${MAX_TEXT_BYTES} UTF-8 bytes`,
});

const certificate = z.object({
  id: uuid,
  author: z.string(),
  content_hash: hex64,
  simhash,
  content_len: z.number().int(),
  language: z.string().nullable(),
  issued_at: isoDateTime,
  signature: z.string().min(1),
  manifest: jsonObject,
  storage_key: z.string(),
});

const certificateDetail = certificate.extend({ text: z.string() });

const batchRecord = z.object({
  certificate_id: uuid,
  manifest: jsonObject,
  fingerprints: z.object({ sha256: hex64, simhash, embedding_id: uuid }),
});

const verifyResponse = z.object({
  valid: z.boolean(),
  checks: jsonObject,
  warnings: z.array(z.string()),
});

const verifyBatchResponse = z.object({
  results: z.array(
    z.object({
      certificate_id: uuid,
      valid: z.boolean(),
      checks: z.record(z.string(), z.boolean()),
      reason: z.string().nullable(),
    }),
  ),
});

const diffResponse = z.object({
  hamming: z.number().int(),
  cosine: z.number(),
  verdict: z.string(),
  overlap_pct: z.number().int(),
  changed_spans: z.array(z.json()),
});

const leakScanResponse = z.object({ scan_id: uuid, status: z.string() });

const leakScanStatus = z.object({
  scan_id: uuid,
  certificate_id: uuid,
  corpora: z.array(z.string()),
  status: z.enum(["pending", "running", "complete", "error"]),
  hit_count: z.number().int(),
  confidence: z.number().nullable(),
  results: z.array(
    z.object({
      corpus: z.string(),
      hit_count: z.number().int(),
      status: z.string(),
      snapshot: z.string().nullable(),
    }),
  ),
});

const envelopeResponse = z.object({
  envelope_id: uuid,
  envelope_manifest: jsonObject,
  envelope_signature: z.string().min(1),
  created_at: isoDateTime,
});

export type Certificate = z.infer<typeof certificate>;
export type CertificateDetail = z.infer<typeof certificateDetail>;
export type CertificateBatch = { certificates: z.infer<typeof batchRecord>[] };
export type VerifyResult = z.infer<typeof verifyResponse>;
export type VerifyBatchResult = z.infer<typeof verifyBatchResponse>;
export type DiffResult = z.infer<typeof diffResponse>;
export type LeakScan = z.infer<typeof leakScanResponse>;
export type LeakScanStatus = z.infer<typeof leakScanStatus>;
export type Envelope = z.infer<typeof envelopeResponse>;

const certifyInput = z.strictObject({
  text: certificateText,
  author: nonBlank,
  metadata: jsonObject.optional(),
});

const batchItem = z.strictObject({
  text: nonBlank.refine((s) => s.length <= MAX_BATCH_TEXT, {
    message: `must be at most ${MAX_BATCH_TEXT} characters`,
  }),
  author: z.string().min(1),
  metadata: stringMap.optional(),
});

const certifyBatchInput = z.strictObject({ items: z.array(batchItem).min(1).max(MAX_BATCH) });

const byId = z.strictObject({ id: uuid });

const verifyInput = z.strictObject({
  manifest: jsonObject.refine((m) => Object.keys(m).length > 0, {
    message: "manifest must not be empty",
  }),
  text: z.string().nullable().optional(),
});

const verifyBatchInput = z.strictObject({
  items: z
    .array(
      z.strictObject({
        certificate_id: uuid,
        text: z.string().max(MAX_BATCH_TEXT).nullable().optional(),
      }),
    )
    .min(1)
    .max(MAX_BATCH),
});

const diffInput = z.strictObject({ parent_id: uuid, text: z.string().max(MAX_BATCH_TEXT) });

const leakScanInput = z.strictObject({
  certificate_id: uuid,
  // Validated here because inkprint checks corpora only inside the background scan: an unknown
  // one would spend the budget on a scan that can only fail.
  corpora: z
    .array(z.enum(CORPORA))
    .min(1)
    .refine((c) => new Set(c).size === c.length, { message: "corpora must not repeat" })
    .optional(),
});

const envelopeInput = z.strictObject({
  dossier_id: uuid,
  evidence_cert_ids: z.array(uuid).min(1).max(MAX_BATCH),
  debate_transcript_hash: hex64,
  perf_receipt_hash: hex64,
  metadata: stringMap.optional(),
});

const certify: Capability<z.infer<typeof certifyInput>, Certificate> = {
  id: "inkprint.certify",
  service: "inkprint",
  method: "POST",
  path: () => "/certificates",
  body: (i) => i,
  input: certifyInput,
  output: certificate,
  grant: "editor",
  cost: "quota",
  budget: "certify",
};

const certifyBatch: Capability<z.infer<typeof certifyBatchInput>, CertificateBatch> = {
  id: "inkprint.certifyBatch",
  service: "inkprint",
  method: "POST",
  path: () => "/certificates/batch",
  body: (i) => i,
  input: certifyBatchInput,
  output: z.object({ certificates: z.array(batchRecord) }),
  grant: "editor",
  cost: "quota",
  budget: "certify",
  // Ruling K: the certify budget counts certificates, so a batch spends one unit per item.
  budgetUnits: (i) => i.items.length,
  // One embedding request for up to 50 texts.
  timeoutMs: 60_000,
};

const certificateGet: Capability<z.infer<typeof byId>, CertificateDetail> = {
  id: "inkprint.certificate",
  service: "inkprint",
  method: "GET",
  path: (i) => `/certificates/${seg(i.id)}`,
  input: byId,
  output: certificateDetail,
  grant: "viewer",
  cost: "free",
};

const verify: Capability<z.infer<typeof verifyInput>, VerifyResult> = {
  id: "inkprint.verify",
  service: "inkprint",
  method: "POST",
  path: () => "/verify",
  body: (i) => i,
  input: verifyInput,
  output: verifyResponse,
  grant: "viewer",
  cost: "free",
};

const verifyBatch: Capability<z.infer<typeof verifyBatchInput>, VerifyBatchResult> = {
  id: "inkprint.verifyBatch",
  service: "inkprint",
  method: "POST",
  path: () => "/verify/batch",
  body: (i) => i,
  input: verifyBatchInput,
  output: verifyBatchResponse,
  grant: "viewer",
  cost: "free",
};

const diff: Capability<z.infer<typeof diffInput>, DiffResult> = {
  id: "inkprint.diff",
  service: "inkprint",
  method: "POST",
  path: () => "/diff",
  body: (i) => i,
  input: diffInput,
  output: diffResponse,
  grant: "editor",
  // Ruling M: every diff embeds the new text (`_compute_embedding_or_zero`), the same spend as a
  // certificate, so it counts one unit against the certify budget.
  cost: "quota",
  budget: "certify",
};

const leakScan: Capability<z.infer<typeof leakScanInput>, LeakScan> = {
  id: "inkprint.leakScan",
  service: "inkprint",
  method: "POST",
  path: () => "/leak-scan",
  body: (i) => i,
  input: leakScanInput,
  output: leakScanResponse,
  grant: "editor",
  cost: "quota",
  budget: "leakscan",
};

const leakScanStatusGet: Capability<z.infer<typeof byId>, LeakScanStatus> = {
  id: "inkprint.leakScanStatus",
  service: "inkprint",
  method: "GET",
  path: (i) => `/leak-scan/${seg(i.id)}`,
  input: byId,
  output: leakScanStatus,
  grant: "viewer",
  cost: "free",
};

const envelope: Capability<z.infer<typeof envelopeInput>, Envelope> = {
  id: "inkprint.envelope",
  service: "inkprint",
  method: "POST",
  path: () => "/dossiers/envelope",
  body: (i) => i,
  input: envelopeInput,
  output: envelopeResponse,
  grant: "editor",
  cost: "free",
};

const publicKey: Capability<z.infer<typeof noInput>, RawBody> = {
  id: "inkprint.publicKey",
  service: "inkprint",
  method: "GET",
  path: () => "/public-key.pem",
  input: noInput,
  output: pemBody,
  grant: "viewer",
  cost: "free",
  raw: "pem",
};

const qr: Capability<z.infer<typeof byId>, RawBody> = {
  id: "inkprint.qr",
  service: "inkprint",
  method: "GET",
  path: (i) => `/certificates/${seg(i.id)}/qr`,
  input: byId,
  output: pngBody,
  grant: "viewer",
  cost: "free",
  raw: "png",
};

export const inkprint = {
  certify,
  certifyBatch,
  certificate: certificateGet,
  verify,
  verifyBatch,
  diff,
  leakScan,
  leakScanStatus: leakScanStatusGet,
  envelope,
  publicKey,
  qr,
} as const;
