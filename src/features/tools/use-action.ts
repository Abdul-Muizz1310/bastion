"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRewake } from "@/components/tools/WakeGate";
import type { ServiceId } from "@/platform/registry/products";
import type { ToolOutcome } from "./outcome";
import { nextLoad, runAction } from "./run-action";

/**
 * One workbench action's state: whether it runs, and what it last came to. A new run aborts the one
 * before it; leaving the page aborts the one in flight, and an aborted run never sets state. An
 * asleep outcome — run or set — puts the wake gate back to waking (review fix 2).
 */

export type ActionState<O> = { busy: boolean; outcome: ToolOutcome<O> | null };

/** `target` is the service a routed call went to, when it is not the gate's own (Ruling AI). */
export type Action<O> = ActionState<O> & {
  run: (
    call: (signal: AbortSignal) => Promise<ToolOutcome<O>>,
    target?: ServiceId,
  ) => Promise<ToolOutcome<O> | null>;
  set: (outcome: ToolOutcome<O> | null, target?: ServiceId) => void;
};

export function useAction<O>(initial: ToolOutcome<O> | null = null): Action<O> {
  const [state, setState] = useState<ActionState<O>>({ busy: false, outcome: initial });
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  const rewake = useRewake();

  const run = useCallback(
    async (call: (signal: AbortSignal) => Promise<ToolOutcome<O>>, target?: ServiceId) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      setState((s) => ({ busy: true, outcome: s.outcome }));
      const outcome = await runAction(call, controller.signal, { onAsleep: () => rewake(target) });
      if (outcome !== null) setState({ busy: false, outcome });
      return outcome;
    },
    [rewake],
  );

  const set = useCallback(
    (outcome: ToolOutcome<O> | null, target?: ServiceId) => {
      current.current?.abort();
      setState({ busy: false, outcome });
      if (outcome && !outcome.ok && outcome.kind === "asleep") rewake(target);
    },
    [rewake],
  );

  return { ...state, run, set };
}

/**
 * Review round 3: one first load's gate — `shouldLoad(outcome)` says whether to (re)load it now,
 * spending its single automatic retry per failure; a success gives the retry back.
 */
export function useFirstLoad(): (outcome: ToolOutcome<unknown> | null) => boolean {
  const retried = useRef(false);
  return useCallback((outcome: ToolOutcome<unknown> | null) => {
    const next = nextLoad(outcome, retried.current);
    retried.current = next.retried;
    return next.load;
  }, []);
}
