"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState } from "react";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import type { Stage } from "@/dossier/stages";
import type { ToolOutcome } from "@/features/tools/outcome";
import { useAction } from "@/features/tools/use-action";
import { postAdvance, postRetry, type RetryAnswer } from "../live/advance-client";
import { initialLive, type LiveInitial, type LiveState, liveReducer } from "../live/model";
import { frontier } from "../live/nudge";
import { type AdvanceOutcome, createNudger, type Nudger } from "../live/nudger";
import { followDossier } from "../live/stream-client";
import { clock } from "../timeline-view";
import { StageTimeline } from "./StageTimeline";

/**
 * The live run of a dossier (spec 21 §6.6): the timeline the server rendered, kept current by the
 * SSE stream; the nudge that calls `advance` when the frontier stage has been due for the grace
 * (single-flight, backing off); and, on a failed dossier, "retry from this stage". When the stream
 * says done — or a retry is accepted — the page is rendered again on the server: a finished
 * dossier becomes its receipt, a retried one starts following again.
 */

export function DossierLive({
  dossierId,
  initial,
  initialRetry = null,
}: {
  dossierId: string;
  initial: LiveInitial;
  /** What a retry came to (tests seed it). */
  initialRetry?: ToolOutcome<RetryAnswer> | null;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(liveReducer, initial, initialLive);
  const startedFinished = useRef(state.finished);
  const [nudged, setNudged] = useState<{ outcome: AdvanceOutcome; at: number } | null>(null);

  // Follow the stream while the dossier is unfinished; leaving the page closes it.
  useEffect(() => {
    if (startedFinished.current) return;
    return followDossier(
      dossierId,
      {
        onEvent: (event) => dispatch({ type: "event", event }),
        onConnection: (s) => dispatch({ type: "connection", state: s }),
      },
      {
        EventSourceImpl: EventSource,
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (h) => window.clearTimeout(h as number),
      },
    );
  }, [dossierId]);

  // The nudge: one controller for the page's life, told every change of the steps.
  const nudger = useRef<Nudger | null>(null);
  useEffect(() => {
    if (startedFinished.current) return;
    const n = createNudger({
      advance: (signal) => postAdvance(dossierId, signal),
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h as number),
      onNudge: (outcome, at) => setNudged({ outcome, at }),
    });
    nudger.current = n;
    return () => n.dispose();
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

  const failed = state.status === "failed";
  return (
    <div className="space-y-5">
      <p aria-live="polite" className="font-mono text-xs text-fg-muted">
        {connectionWords(state)}
      </p>
      <StageTimeline
        steps={state.steps}
        labelledBy="run-title"
        retry={
          failed
            ? {
                onRetry,
                busy: retry.busy,
                notice:
                  retry.outcome && !retry.outcome.ok ? (
                    <OutcomeNotice failure={retry.outcome} product="bastion" />
                  ) : null,
              }
            : undefined
        }
      />
      {nudged && !state.finished ? (
        <p className="font-mono text-[11px] leading-relaxed text-fg-muted">
          {nudgeWords(nudged.outcome, nudged.at)}
        </p>
      ) : null}
    </div>
  );
}

function connectionWords(s: LiveState): string {
  if (s.finished) {
    if (s.status === "failed") {
      const at = frontier(s.steps);
      return at === null
        ? "the run stopped."
        : `the run stopped at ${at.stage}: retry it from that stage below.`;
    }
    return "the run finished — loading its receipt…";
  }
  switch (s.connection) {
    case "connecting":
      return "connecting to the live run…";
    case "open":
      return "following the live run: each stage updates as it moves.";
    case "reconnecting":
      return "reconnecting to the live run…";
    case "closed":
      return "not following the run.";
  }
}

function nudgeWords(outcome: AdvanceOutcome, at: number): string {
  const when = clock(new Date(at).toISOString());
  switch (outcome.kind) {
    case "ok":
      return `This page nudged the runner at ${when}: the stage it shows was due.`;
    case "rate_limited":
      return `The runner told this page to wait ${outcome.retryAfterS} s before nudging again (${when}).`;
    case "gone":
      return "bastion no longer knows this dossier.";
    case "failed":
      return `Nudging the runner did not work at ${when} (${outcome.detail}); this page tries again shortly.`;
  }
}
