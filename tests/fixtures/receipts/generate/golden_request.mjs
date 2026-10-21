// The envelope request bastion's envelope stage would send for golden-dossier.json: the stored
// certificate ids (stable_id order), transcript-a's hash and signature, the perf receipt's hash, the
// audit digest of the events up to `envelopeUpTo`, and the documents' graph hashes. inkprint's own
// code then signs it (ink_fixture.py), so the verify tests hold a fully consistent signed dossier.
//
// usage (from the bastion root): node tests/fixtures/receipts/generate/golden_request.mjs <out.json>

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../../../../src/platform/canonical-json.ts";

const dir = resolve(import.meta.dirname, "..");
const golden = JSON.parse(readFileSync(resolve(dir, "golden-dossier.json"), "utf8"));
const transcript = JSON.parse(readFileSync(resolve(dir, golden.transcript), "utf8"));
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const rows = golden.events
  .filter((e) => e.id <= golden.envelopeUpTo)
  .sort((a, b) => a.id - b.id)
  .map((e) => [e.id, e.action, e.service, new Date(e.createdAt).toISOString()]);

const certificates = [...golden.certificates].sort((a, b) => (a.key < b.key ? -1 : 1));
const body = {
  dossier_id: golden.dossier.id,
  evidence_cert_ids: certificates.map((c) => c.id),
  debate_transcript_hash: transcript.transcript_hash,
  perf_receipt_hash: sha256(canonicalJson(golden.perf)),
  metadata: {
    request_id: golden.dossier.requestId,
    audit_digest_at_envelope: sha256(canonicalJson(rows)),
    audit_up_to: String(golden.envelopeUpTo),
    graph_hashes: golden.documents
      .map((d) => d.graphHash)
      .sort()
      .join(","),
    transcript_signature: transcript.signature,
    debate_id: transcript.debate_id,
  },
};
writeFileSync(process.argv[2], `${JSON.stringify(body, null, 2)}\n`);
console.log(JSON.stringify(body, null, 2));
