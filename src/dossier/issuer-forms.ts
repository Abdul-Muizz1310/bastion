import type { Transcript } from "@/capabilities/paper-trail";
import { PyFloat, type PyJson, pythonJsonDumps } from "@/platform/python-json";

/**
 * The exact strings the downstream issuers hash and sign (spec 21 §6.5), rebuilt from what they
 * serve so that a verifier can check their signatures without trusting bastion. Both issuers write
 * `json.dumps(…, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` and sign its UTF-8
 * bytes, so these mirror the Python values field by field (`@/platform/python-json` restores the
 * int/float split a JSON parser erases). Pure.
 *
 * paper-trail (contract-v2, `agents/tools/transcript.py::canonical_transcript_json`):
 * - **signed form** — `api/routers/debates.py::get_transcript_json` signs `{claim, verdict,
 *   confidence: float, rounds}` where each round is `TranscriptRound.model_dump()`: `{side,
 *   round: int, argument_md, citations: [{type, ref, title}], confidence: float | None}`. It is
 *   signed on every fetch, over the rounds as served; Ed25519 is deterministic, so the signature is
 *   the same each time while the key is.
 * - **render form** — the render node (`agents/nodes/render.py`) hashes the same object with each
 *   round's `confidence` key absent (`{side, round, argument_md, citations}`); that hash is the
 *   `transcript_hash` stored and served. A debate from before the render node stored a hash gets
 *   it computed by the route from the signed form instead.
 *
 * inkprint (contract-v2, `provenance/envelope_builder.py::canonical_bundle_bytes`): the envelope
 * signature is over `{dossier_id, evidence_cert_ids (as given), debate_transcript_hash,
 * perf_receipt_hash, metadata (or {}), issued_at}` — all strings, `issued_at` being
 * `datetime.isoformat()` as written into the manifest (`+00:00`, microseconds only when non-zero).
 * The response's `created_at` is the same instant as pydantic writes it (`Z`), which is not it.
 * The manifest's `c2pa.hash.data` is the SHA-256 of these bytes.
 *
 * inkprint's certificates (contract-v2, `provenance/canonicalize.py`): a certificate's `content_hash`
 * is the SHA-256, and its signature the Ed25519 signature, of `canonicalize(text)`: NFC, then every
 * run of Python `\s` (`str.isspace`, which is not JavaScript's `\s`: it adds U+001C–U+001F and
 * U+0085 and lacks U+FEFF) collapsed to one space, then `strip()`, as UTF-8.
 */

export type TranscriptContent = Pick<Transcript, "claim" | "verdict" | "confidence" | "rounds">;

type Round = TranscriptContent["rounds"][number];

const float = (x: number) => new PyFloat(x);

function citations(r: Round): PyJson[] {
  return r.citations.map((c) => ({ type: c.type, ref: c.ref, title: c.title }));
}

function transcriptJson(t: TranscriptContent, rounds: PyJson[]): string {
  return pythonJsonDumps({
    claim: t.claim,
    verdict: t.verdict,
    confidence: float(t.confidence),
    rounds,
  });
}

/** What paper-trail signs (`signature` on `transcript.json`). */
export function transcriptSignedJson(t: TranscriptContent): string {
  return transcriptJson(
    t,
    t.rounds.map((r) => ({
      side: r.side,
      round: r.round,
      argument_md: r.argument_md,
      citations: citations(r),
      confidence: r.confidence === null ? null : float(r.confidence),
    })),
  );
}

/** What paper-trail's render node hashes into `transcript_hash`. */
export function transcriptRenderJson(t: TranscriptContent): string {
  return transcriptJson(
    t,
    t.rounds.map((r) => ({
      side: r.side,
      round: r.round,
      argument_md: r.argument_md,
      citations: citations(r),
    })),
  );
}

export type EnvelopeBundle = {
  dossier_id: string;
  evidence_cert_ids: readonly string[];
  debate_transcript_hash: string;
  perf_receipt_hash: string;
  metadata?: Readonly<Record<string, string>> | null;
  /** The manifest's `issued_at`, verbatim. */
  issued_at: string;
};

/** What inkprint signs (`envelope_signature`) and hashes into the manifest's `c2pa.hash.data`. */
export function envelopeBundleJson(b: EnvelopeBundle): string {
  return pythonJsonDumps({
    dossier_id: b.dossier_id,
    evidence_cert_ids: [...b.evidence_cert_ids],
    debate_transcript_hash: b.debate_transcript_hash,
    perf_receipt_hash: b.perf_receipt_hash,
    metadata: { ...(b.metadata ?? {}) },
    issued_at: b.issued_at,
  });
}

/** Python's `\s` in a `str` pattern (`str.isspace`), as CPython 3.12 matches it. */
const PYTHON_WHITESPACE_RUN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Python's \s includes U+001C–U+001F.
  /[\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/**
 * The text inkprint hashes and signs for a certificate (`canonicalize(text)`, decoded). A lone
 * surrogate is refused (TypeError): Python could not have encoded it, so nothing was certified.
 */
export function inkprintCanonicalText(text: string): string {
  if (!text.isWellFormed()) throw new TypeError("inkprintCanonicalText: a lone surrogate");
  const collapsed = text.normalize("NFC").replace(PYTHON_WHITESPACE_RUN, " ");
  // After the collapse the only whitespace left is single spaces, so strip() trims at most one.
  return collapsed.replace(/^ /, "").replace(/ $/, "");
}
