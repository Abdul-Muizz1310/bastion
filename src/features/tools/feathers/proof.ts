import "server-only";
import { randomBytes } from "node:crypto";
import { feathers } from "@/capabilities/feathers";
import { type CallContext, callCapability } from "@/platform/gateway/call";
import { GATEWAY_ERROR_STATUS, type GatewayResult } from "@/platform/gateway/result";
import type { ToolOutcome } from "../outcome";
import type { ProofAnswer } from "./proof-answer";
import { type ProofStep, runSoftDeleteProof } from "./soft-delete";

/**
 * feathers' soft-delete proof, run on the server (spec 21 §5.1, review fix 1): the proof makes up
 * its own user, deletes exactly that user and reads it back, all under the caller's one request id.
 * `feathers.deleteUser` is not a tool, so this is the only way a visitor deletes anything — and only
 * what the proof itself created.
 */

/** A gateway result as the outcome the shared proof core reads. */
function outcome<T>(r: GatewayResult<T>): ToolOutcome<T> {
  if (r.ok) return { ok: true, data: r.data, status: r.status, requestId: r.requestId };
  const base = { ok: false as const, requestId: r.requestId };
  const detail = r.detail === undefined ? {} : { detail: r.detail };
  switch (r.error) {
    case "asleep":
      return { ...base, kind: "asleep" };
    case "rate_limited":
      return { ...base, kind: "rate_limited", retryAfterS: r.retryAfterS ?? 60 };
    case "budget_exhausted":
      return {
        ...base,
        kind: "budget_exhausted",
        ...(r.retryAfterS === undefined ? {} : { retryAfterS: r.retryAfterS }),
      };
    case "downstream_error":
      return { ...base, kind: "downstream_error", status: r.status, ...detail };
    case "invalid_response":
      return { ...base, kind: "invalid_response", ...detail };
    case "invalid_input":
      return { ...base, kind: "invalid_input", ...detail };
  }
}

function stepAnswer(s: ProofStep): ProofAnswer["steps"][number] {
  const o = s.outcome;
  if (o.ok) return { step: s.step, ok: true, status: o.status, kind: null, detail: null };
  // A downstream answer keeps its own status; the gateway's refusals have a fixed one.
  const status =
    o.kind === "downstream_error"
      ? o.status
      : o.kind === "refused" || o.kind === "unreachable"
        ? null
        : GATEWAY_ERROR_STATUS[o.kind];
  const detail = "detail" in o && o.detail !== undefined ? o.detail : null;
  return { step: s.step, ok: false, status, kind: o.kind, detail };
}

export async function proveSoftDelete(ctx: CallContext): Promise<ProofAnswer> {
  const input = {
    email: `proof-${randomBytes(4).toString("hex")}@example.com`,
    full_name: "Soft-delete proof",
  };
  const proof = await runSoftDeleteProof(
    {
      create: async (i) => outcome(await callCapability(feathers.createUser, i, ctx)),
      remove: async (id) => outcome(await callCapability(feathers.deleteUser, { id }, ctx)),
      read: async (id) => outcome(await callCapability(feathers.user, { id }, ctx)),
    },
    input,
  );
  return {
    verdict: proof.verdict,
    user: proof.user,
    steps: proof.steps.map(stepAnswer),
    requestId: ctx.requestId,
  };
}
