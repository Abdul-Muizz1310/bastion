"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolOutcome } from "./outcome";

/**
 * One workbench action's state: whether it runs, and what it last came to. A new run aborts the one
 * before it; leaving the page aborts the one in flight, and an aborted run never sets state.
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

  const run = useCallback(async (call: (signal: AbortSignal) => Promise<ToolOutcome<O>>) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setState((s) => ({ busy: true, outcome: s.outcome }));
    try {
      const outcome = await call(controller.signal);
      if (controller.signal.aborted) return null;
      setState({ busy: false, outcome });
      return outcome;
    } catch {
      if (controller.signal.aborted) return null;
      const outcome: ToolOutcome<O> = {
        ok: false,
        kind: "unreachable",
        detail: "the page could not finish the call",
        requestId: null,
      };
      setState({ busy: false, outcome });
      return outcome;
    }
  }, []);

  const set = useCallback((outcome: ToolOutcome<O> | null) => {
    current.current?.abort();
    setState({ busy: false, outcome });
  }, []);

  return { ...state, run, set };
}
