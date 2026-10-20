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
