import * as z from "zod/mini";

/**
 * The answer of `GET /api/platform/transcript-check` (spec 21 §5.1) — client-safe, so the
 * paper-trail workbench parses it in the browser. The check itself runs on the server
 * (`./transcript-check`), where the Ed25519 verifier lives.
 *
 * - `hash`: `pass` when `transcript_hash` is the SHA-256 of the render form (or, for a legacy
 *   debate, the signed form) recomputed from the rounds; else `fail`.
 * - `signature`: `pass` verified with paper-trail's published key, `fail` it does not verify (or the
 *   key is not Ed25519), `unsigned` the transcript carries none, `unavailable` the key could not be
 *   fetched. Only `pass` is a pass.
 */

export const CHECK_STATES = ["pass", "fail"] as const;
export const SIGNATURE_STATES = ["pass", "fail", "unsigned", "unavailable"] as const;

export const transcriptCheckSchema = z.object({
  debateId: z.string(),
  claim: z.string(),
  verdict: z.string(),
  confidence: z.number(),
  transcriptHash: z.string(),
  hash: z.object({
    state: z.enum(CHECK_STATES),
    form: z.nullable(z.enum(["render", "signed"])),
  }),
  signature: z.object({
    state: z.enum(SIGNATURE_STATES),
    alg: z.nullable(z.string()),
    detail: z.string(),
  }),
});

export type TranscriptCheck = z.infer<typeof transcriptCheckSchema>;

export type TranscriptCheckAnswer = TranscriptCheck & { requestId: string };

export const transcriptCheckAnswerSchema = z.extend(transcriptCheckSchema, {
  requestId: z.string().check(z.minLength(1)),
});
