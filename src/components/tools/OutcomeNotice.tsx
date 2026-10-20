import type { FailedOutcome } from "@/features/tools/outcome";
import type { ServiceId } from "@/platform/registry/products";
import { AuditLink } from "./AuditLink";
import { BUTTON_QUIET } from "./styles";
import { useGateServices, useSideWakes } from "./WakeGate";
import { rewakePlan, type SideWakes, sideWakeWords, type WakePlan } from "./wake-model";

/**
 * A failed action, said for what it is (spec 21 §5.1 invariant 4). The platform's limits — asleep,
 * rate limited, today's budget spent — are named as such and never as the product failing; the
 * product's own answer keeps its status and reason; bastion's own trouble says it is bastion's. An
 * asleep answer names what bastion is waking for it, or says nothing is (Ruling AI).
 */

const SLEEP = "Free Render services sleep after 15 minutes and take about a minute to wake.";

function wakingWords(plan: WakePlan, side: SideWakes): string {
  switch (plan.kind) {
    case "gate":
      return `${SLEEP} bastion is waking ${plan.services.join(" and ")} again above; the actions come back once it answers.`;
    case "side":
      return `${SLEEP} ${sideWakeWords(plan.service, side[plan.service])}`;
    case "none":
      return `${SLEEP} Nothing on this page wakes it: try again in a minute.`;
  }
}

type Tone = "limit" | "product" | "bastion";

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  limit: "border-warning/40 text-warning",
  product: "border-error/50 text-error",
  bastion: "border-border-bright text-foreground",
};

function describe(
  f: FailedOutcome,
  product: string,
  plan: WakePlan,
  side: SideWakes,
): { tone: Tone; title: string; body?: string } {
  switch (f.kind) {
    case "asleep":
      return {
        tone: "limit",
        title: `${product} is asleep (it did not answer in time)`,
        body: wakingWords(plan, side),
      };
    case "rate_limited":
      return {
        tone: "limit",
        title: "rate limited",
        body: `Too many calls in a short time — try again in ${f.retryAfterS} s.`,
      };
    case "budget_exhausted":
      return {
        tone: "limit",
        title: "today’s budget for this action is spent",
        body: "Budgets reset at 00:00 UTC. They share the free model quota between every visitor.",
      };
    case "downstream_error":
      return {
        tone: "product",
        title: `${product} answered ${f.status}`,
        body: f.detail ?? "It gave no reason.",
      };
    case "invalid_response":
      return {
        tone: "product",
        title: `${product} answered in a shape bastion does not accept`,
        body: f.detail,
      };
    case "invalid_input":
      return { tone: "bastion", title: "bastion refused the input", body: f.detail };
    case "refused":
      return { tone: "bastion", title: `bastion refused the call (${f.error})`, body: f.detail };
    case "unreachable":
      return {
        tone: "bastion",
        title: "bastion could not be reached",
        body: f.detail ?? "Check the connection and try again.",
      };
  }
}

export function OutcomeNotice({
  failure,
  product,
  wakes,
  onRetry,
}: {
  failure: FailedOutcome;
  product: string;
  /** The service the call went to, when it is not the gate's own (a routed read). */
  wakes?: ServiceId;
  /** A manual retry, for a first load that has used its one automatic retry (review round 3). */
  onRetry?: () => void;
}) {
  const plan = rewakePlan(useGateServices(), wakes);
  const { tone, title, body } = describe(failure, product, plan, useSideWakes());
  return (
    <div
      data-kind={failure.kind}
      className={`rounded-[3px] border bg-background px-4 py-3 font-mono text-xs ${TONE_CLASS[tone]}`}
    >
      <p className="font-semibold">{title}</p>
      {body ? <p className="mt-1 leading-relaxed text-fg-muted break-words">{body}</p> : null}
      {failure.requestId ? (
        <AuditLink requestId={failure.requestId} className="mt-2 inline-block" />
      ) : null}
      {onRetry ? (
        <div className="mt-3">
          <button type="button" onClick={onRetry} className={BUTTON_QUIET}>
            try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
