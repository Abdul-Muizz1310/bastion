"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type { Stage } from "@/dossier/stages";
import type { ToolOutcome } from "@/features/tools/outcome";
import { useAction } from "@/features/tools/use-action";
import { postAdvance, postRetry, type RetryAnswer } from "../live/advance-client";
import { initialLive, type LiveInitial, type LiveState, liveReducer } from "../live/model";
import { type AdvanceOutcome, createNudger, type Nudger } from "../live/nudger";
import { followDossier, type StreamControl } from "../live/stream-client";

/**
 * The live island of a dossier page (spec 21 §6.6), as a context around everything on the page
 * that moves with the run — the verdict slip and the timeline. It follows the SSE stream, nudges
 * `advance` once the shown stage is due (single-flight, backing off), pauses both while the tab is
 * hidden and resumes them when it is shown, and offers "retry from this stage" on a failed run.
 * When the stream says done — or a retry is accepted — the page is rendered again on the server.
 */

export type LiveDossierValue = {
  state: LiveState;
  /** Whether this page follows the run at all (not for a finished or failed render). */
  following: boolean;
  retry: {
    busy: boolean;
    outcome: ToolOutcome<RetryAnswer> | null;
    onRetry: (stage: Stage) => void;
  };
  nudged: { outcome: AdvanceOutcome; at: number } | null;
};

export const LiveDossierContext = createContext<LiveDossierValue | null>(null);

/** The island's state, or null outside it (a finished receipt, a test of one part). */
export function useLiveDossier(): LiveDossierValue | null {
  return useContext(LiveDossierContext);
}

export function LiveDossier({
  dossierId,
  initial,
  initialRetry = null,
  children,
}: {
  dossierId: string;
  initial: LiveInitial;
  /** What a retry came to (tests seed it). */
  initialRetry?: ToolOutcome<RetryAnswer> | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(liveReducer, initial, initialLive);
  const startedFinished = useRef(state.finished);
  const [nudged, setNudged] = useState<{ outcome: AdvanceOutcome; at: number } | null>(null);
  const stream = useRef<StreamControl | null>(null);
  const nudger = useRef<Nudger | null>(null);

  // Follow the stream and nudge while the dossier is unfinished; leaving the page ends both.
  useEffect(() => {
    if (startedFinished.current) return;
    const timers = {
      setTimer: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
      clearTimer: (h: unknown) => window.clearTimeout(h as number),
    };
    const s = followDossier(
      dossierId,
      {
        onEvent: (event) => dispatch({ type: "event", event }),
        onConnection: (c) => {
          dispatch({ type: "connection", state: c });
          // No live view, no nudging on stale steps: the page says to reload.
          if (c === "failed") nudger.current?.dispose();
        },
      },
      { EventSourceImpl: EventSource, ...timers },
    );
    const n = createNudger({
      advance: (signal) => postAdvance(dossierId, signal),
      now: () => Date.now(),
      ...timers,
      onNudge: (outcome, at) => setNudged({ outcome, at }),
    });
    stream.current = s;
    nudger.current = n;

    // A hidden tab neither streams nor nudges; shown again, the stream reopens (its first tick
    // sends every row again) and the nudge plans afresh.
    const onVisibility = () => {
      if (document.hidden) {
        s.pause();
        n.pause();
      } else {
        s.resume();
        n.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.hidden) onVisibility();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      s.close();
      n.dispose();
    };
  }, [dossierId]);

  useEffect(() => {
    if (state.finished) nudger.current?.dispose();
    else nudger.current?.update(state.steps);
  }, [state.steps, state.finished]);

  // A run that finishes while the page is open becomes its receipt.
  useEffect(() => {
    if (state.finished && !startedFinished.current) router.refresh();
  }, [state.finished, router]);

  const retry = useAction<RetryAnswer>(initialRetry);
  const onRetry = (stage: Stage) => {
    void retry
      .run((signal) => postRetry(dossierId, stage, { signal }))
      .then((outcome) => {
        if (outcome?.ok) router.refresh();
      });
  };

  return (
    <LiveDossierContext
      value={{
        state,
        following: !startedFinished.current,
        retry: { busy: retry.busy, outcome: retry.outcome, onRetry },
        nudged,
      }}
    >
      {children}
    </LiveDossierContext>
  );
}
