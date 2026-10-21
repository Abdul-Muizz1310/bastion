"use client";

import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { BUTTON_QUIET } from "@/components/tools/styles";
import type { ToolOutcome } from "@/features/tools/outcome";
import type { RetryAnswer } from "../live/advance-client";
import type { LiveInitial } from "../live/model";
import { connectionWords, nudgeWords } from "../live/words";
import { LiveDossier, useLiveDossier } from "./LiveDossier";
import { StageTimeline } from "./StageTimeline";

/**
 * The run as the live island shows it (spec 21 §6.6): the state of the stream in words (with a
 * reload once it stopped trying), the eight stages kept current by it, "retry from this stage" on
 * a failed run, and a one-line account of the page's own nudges.
 */
export function RunView() {
  const live = useLiveDossier();
  if (live === null) throw new Error("RunView must sit inside LiveDossier");
  const { state, retry, nudged } = live;
  const words = connectionWords(state);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p aria-live="polite" className="font-mono text-xs text-fg-muted">
          {words.text}
        </p>
        {words.reload ? (
          <button type="button" onClick={() => window.location.reload()} className={BUTTON_QUIET}>
            reload the page
          </button>
        ) : null}
      </div>
      <StageTimeline
        steps={state.steps}
        labelledBy="run-title"
        retry={
          state.status === "failed"
            ? {
                onRetry: retry.onRetry,
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

/** The island with just its run view: what a page without a live slip uses (and the tests). */
export function DossierLive({
  dossierId,
  initial,
  initialRetry = null,
}: {
  dossierId: string;
  initial: LiveInitial;
  initialRetry?: ToolOutcome<RetryAnswer> | null;
}) {
  return (
    <LiveDossier dossierId={dossierId} initial={initial} initialRetry={initialRetry}>
      <RunView />
    </LiveDossier>
  );
}
