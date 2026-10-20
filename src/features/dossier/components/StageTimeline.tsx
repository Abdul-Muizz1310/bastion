import type { ReactNode } from "react";
import { BUTTON_QUIET } from "@/components/tools/styles";
import type { Stage } from "@/dossier/stages";
import { type StepView, sortByStage } from "../step-view";
import { type ErrorTone, type StageRow, stageRow, type Tone } from "../timeline-view";

/**
 * The eight stages of a dossier (spec 21 §6.6, "The timeline"): each status written in words beside
 * a glyph that is hidden from assistive tech, the attempt past the first, what a stage waits for or
 * produced, and when a waiting stage is asked again. An error is said for what it is (§6.4); the
 * error stage alone carries "retry from this stage", held while that call is in flight. No hooks:
 * the server renders it for a finished receipt, the live island for a run.
 */

export type TimelineRetry = {
  onRetry: (stage: Stage) => void;
  busy: boolean;
  /** What the last retry came to, when it was refused (rendered by the island). */
  notice?: ReactNode;
};

const TONE_TEXT: Readonly<Record<Tone, string>> = {
  muted: "text-fg-muted",
  violet: "text-accent-violet",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

const NODE_CLASS: Readonly<Record<Tone, string>> = {
  muted: "border-border-bright bg-background",
  violet: "border-accent-violet bg-accent-violet-soft",
  success: "border-success/70 bg-background",
  warning: "border-warning/70 bg-background",
  error: "border-error bg-background",
};

const ERROR_CLASS: Readonly<Record<ErrorTone, string>> = {
  limit: "border-warning/40 text-warning",
  product: "border-error/50 text-error",
  bastion: "border-border-bright text-foreground",
};

export function StageTimeline({
  steps,
  retry,
  labelledBy,
}: {
  steps: readonly StepView[];
  retry?: TimelineRetry;
  labelledBy?: string;
}) {
  if (steps.length === 0) {
    return (
      <p className="font-mono text-xs leading-relaxed text-fg-muted">
        This dossier predates the eight-stage runner: it has no step rows to show, and its receipts
        are whatever its first version kept.
      </p>
    );
  }
  return (
    <ol aria-labelledby={labelledBy} className="relative">
      {sortByStage(steps).map((step, i) => (
        <StageItem
          key={step.stage}
          row={stageRow(step, i + 1)}
          last={i === steps.length - 1}
          retry={retry}
        />
      ))}
    </ol>
  );
}

function StageItem({ row, last, retry }: { row: StageRow; last: boolean; retry?: TimelineRetry }) {
  const active = row.status === "running" || row.status === "waiting";
  return (
    <li
      data-stage={row.stage}
      data-status={row.status}
      className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]"
    >
      {/* The rail between nodes: decoration, the order is the list's own. */}
      {last ? null : (
        <span
          aria-hidden="true"
          className={`absolute top-8 bottom-0 left-[1.0625rem] w-px ${
            row.status === "ok" || row.status === "skipped" ? "bg-border-bright" : "bg-border"
          }`}
        />
      )}
      <span
        aria-hidden="true"
        data-glyph={row.glyph}
        className={`relative z-[1] mt-0.5 flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-full border font-mono text-sm ${NODE_CLASS[row.tone]} ${TONE_TEXT[row.tone]} ${
          active ? "motion-safe:animate-pulse" : ""
        }`}
      >
        {row.glyph}
      </span>

      <div className="min-w-0 pt-1">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span aria-hidden="true" className="font-mono text-[11px] tabular-nums text-fg-muted">
            {String(row.index).padStart(2, "0")}
          </span>
          <span className="font-display text-sm font-bold tracking-tight text-foreground">
            {row.stage}
          </span>
          <span className={`font-mono text-xs sm:hidden ${TONE_TEXT[row.tone]}`}>{row.word}</span>
        </p>
        <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-fg-muted">{row.does}</p>
        {row.note || row.when || row.attempt ? (
          <p className="mt-1.5 font-mono text-xs leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
            {[row.note, row.attempt, row.when].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {row.error ? (
          <div
            data-tone={row.error.tone}
            className={`mt-2.5 rounded-[3px] border bg-background px-3 py-2.5 font-mono text-xs ${ERROR_CLASS[row.error.tone]}`}
          >
            <p className="font-semibold">{row.error.title}</p>
            <p className="mt-1 leading-relaxed break-words text-fg-muted">{row.error.detail}</p>
            {row.retry && retry ? (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => retry.onRetry(row.stage)}
                  disabled={retry.busy}
                  aria-busy={retry.busy || undefined}
                  className={BUTTON_QUIET}
                >
                  {retry.busy ? "retrying…" : "retry from this stage"}
                </button>
                {retry.notice ?? null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className={`hidden pt-1.5 font-mono text-xs sm:block ${TONE_TEXT[row.tone]}`}>
        {row.word}
      </p>
    </li>
  );
}
