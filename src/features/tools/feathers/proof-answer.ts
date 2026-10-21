import * as z from "zod/mini";

/**
 * The answer of `POST /api/platform/feathers-proof` (spec 21 §5.1), client-safe: the verdict, the
 * user the proof created (and deleted), each step's status, and the one request id all three calls
 * share in the audit trail.
 */

export const PROOF_STEPS = ["create", "delete", "read"] as const;
export const FAILURE_KINDS = [
  "asleep",
  "rate_limited",
  "budget_exhausted",
  "downstream_error",
  "invalid_response",
  "invalid_input",
  "refused",
  "unreachable",
] as const;

export const proofAnswerSchema = z.object({
  verdict: z.enum(["honoured", "leaked", "incomplete"]),
  user: z.nullable(
    z.object({ id: z.string(), email: z.string(), full_name: z.string(), role: z.string() }),
  ),
  steps: z.array(
    z.object({
      step: z.enum(PROOF_STEPS),
      ok: z.boolean(),
      status: z.nullable(z.number()),
      kind: z.nullable(z.enum(FAILURE_KINDS)),
      detail: z.nullable(z.string()),
    }),
  ),
  requestId: z.string().check(z.minLength(1)),
});

export type ProofAnswer = z.infer<typeof proofAnswerSchema>;
export type ProofStepAnswer = ProofAnswer["steps"][number];
