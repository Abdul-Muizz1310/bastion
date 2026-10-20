import type { ReactNode } from "react";
import type { ActionState } from "@/features/tools/use-action";
import type { ServiceId } from "@/platform/registry/products";
import { OutcomeNotice } from "./OutcomeNotice";

/**
 * Where an action's result appears: nothing before it runs, "working…" while it does, the data
 * (with its receipt) or the failure said for what it is. A polite live region names the change, so
 * a screen reader hears that the result arrived without the whole result being read out.
 */
export function Outcome<O>({
  state,
  product,
  what,
  wakes,
  children,
}: {
  state: ActionState<O>;
  product: string;
  /** What the action produces, for the announcement ("the certificate"). */
  what: string;
  /** The service the call went to, when it is not the gate's own (a routed read). */
  wakes?: ServiceId;
  children: (data: O, requestId: string) => ReactNode;
}) {
  const { busy, outcome } = state;
  const announcement = busy
    ? `fetching ${what}…`
    : outcome === null
      ? ""
      : outcome.ok
        ? `${what} is ready`
        : `${what} did not come back`;
  return (
    <div aria-busy={busy} className="min-w-0 space-y-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {busy ? (
        <p className="font-mono text-xs text-fg-muted">
          <span className="motion-safe:animate-pulse">working…</span>
        </p>
      ) : null}
      {outcome === null ? null : outcome.ok ? (
        children(outcome.data, outcome.requestId)
      ) : (
        <OutcomeNotice failure={outcome} product={product} wakes={wakes} />
      )}
    </div>
  );
}
