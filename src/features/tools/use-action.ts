"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRewake } from "@/components/tools/WakeGate";
import type { ToolOutcome } from "./outcome";
import { runAction } from "./run-action";

/**
 * One workbench action's state: whether it runs, and what it last came to. A new run aborts the one
 * before it; leaving the page aborts the one in flight, and an aborted run never sets state. An
 * asleep outcome — run or set — puts the wake gate back to waking (review fix 2).
 */

export type ActionState<O> = { busy: boolean; outcome: ToolOutcome<O> | null };

export type Action<O> = ActionState<O> & {
  run: (call: (signal: AbortSignal) => Promise<ToolOutcome<O>>) => Promise<ToolOutcome<O> | null>;
  set: (outcome: ToolOutcome<O> | null) => void;
};

export function useAction<O>(initial: ToolOutcome<O> | null = null): Action<O> {
  const [state, setState] = useState<ActionState<O>>({ busy: false, outcome: initial });
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  const rewake = useRewake();

  const run = useCallback(
    async (call: (signal: AbortSignal) => Promise<ToolOutcome<O>>) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      setState((s) => ({ busy: true, outcome: s.outcome }));
      const outcome = await runAction(call, controller.signal, { onAsleep: rewake });
      if (outcome !== null) setState({ busy: false, outcome });
      return outcome;
    },
    [rewake],
  );

  const set = useCallback(
    (outcome: ToolOutcome<O> | null) => {
      current.current?.abort();
      setState({ busy: false, outcome });
      if (outcome && !outcome.ok && outcome.kind === "asleep") rewake();
    },
    [rewake],
  );

  return { ...state, run, set };
}
