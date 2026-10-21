import type { CallContext } from "@/platform/gateway/call";
import type { GatewayResult } from "@/platform/gateway/result";
import type { StageContext, StageOutcome } from "../stages";

/**
 * Ruling P: every gateway call a stage makes carries the dossier's own request id, so the measure
 * stage can find the dossier's queries in each downstream service by that id.
 */
export function callContext(ctx: StageContext): CallContext {
  return { actor: "bastion", requestId: ctx.dossier.requestId, clientIp: undefined };
}

type Failure = Extract<GatewayResult<unknown>, { ok: false }>;

/** A downstream 4xx is the caller's mistake and a retry repeats it; everything else may pass. */
function retryable(f: Failure): boolean {
  switch (f.error) {
    case "asleep":
    case "rate_limited":
      return true;
    case "downstream_error":
      return f.status >= 500;
    case "budget_exhausted":
    case "invalid_input":
    case "invalid_response":
      return false;
  }
}

/** A failed gateway call as a stage outcome: `<stage>_<error>[: detail]`, retryable per kind. */
export function failure(what: string, f: Failure): Extract<StageOutcome, { kind: "error" }> {
  return {
    kind: "error",
    error: `${what}: ${f.error}${f.detail === undefined ? "" : ` (${f.detail})`}`,
    retryable: retryable(f),
  };
}
