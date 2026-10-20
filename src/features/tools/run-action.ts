import type { ToolOutcome } from "./outcome";

/**
 * One workbench action, the part worth testing without a browser (spec 21 §5.1, review fix 2): the
 * outcome, or null when the page has moved on (aborted), a throw turned into "bastion unreachable",
 * and an asleep outcome reported — the wake gate then puts the product back to waking, so its
 * actions stay disabled until it answers again.
 */
export async function runAction<O>(
  call: (signal: AbortSignal) => Promise<ToolOutcome<O>>,
  signal: AbortSignal,
  hooks: { onAsleep: () => void },
): Promise<ToolOutcome<O> | null> {
  let outcome: ToolOutcome<O>;
  try {
    outcome = await call(signal);
  } catch {
    if (signal.aborted) return null;
    return {
      ok: false,
      kind: "unreachable",
      detail: "the page could not finish the call",
      requestId: null,
    };
  }
  if (signal.aborted) return null;
  if (!outcome.ok && outcome.kind === "asleep") hooks.onAsleep();
  return outcome;
}

/**
 * Review round 3: a first load retries at most once per failure. A load the gateway keeps timing
 * out (it reads as asleep, which re-gates the page) would otherwise loop forever; after its one
 * retry the panel shows the failure with a manual retry. A success clears the flag.
 */
export function nextLoad(
  outcome: ToolOutcome<unknown> | null,
  retried: boolean,
): { load: boolean; retried: boolean } {
  if (outcome === null) return { load: true, retried: false };
  if (outcome.ok) return { load: false, retried: false };
  return retried ? { load: false, retried: true } : { load: true, retried: true };
}
