import { publicStepError } from "@/dossier/public-error";
import type { Stage, StepRow, StepStatus } from "@/dossier/stages";
import { type OutputSummary, type StepSummaryRow, summarize } from "@/dossier/step-summary";
import type { Json } from "@/platform/canonical-json";

/**
 * One `dossier_steps` row as the dossier page sees it (spec 21 §6.6, "The live run"): what a
 * `step` event carries and what the page's first render hands its live island. Pure.
 *
 * - `nextAt` is `not_before` while the row is pending or waiting (when it may run next), else null;
 * - `leaseUntil` is the lease while one is held, else null (a released lease is the epoch);
 * - `note` is one line about the row's output — why it was skipped, what it waits for, what it
 *   produced — never the output itself (gather's candidates hold whole web pages).
 */

export type StepView = {
  stage: Stage;
  status: StepStatus;
  attempt: number;
  error: string | null;
  nextAt: string | null;
  leaseUntil: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  note: string | null;
};

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** A full row (the page) or a summary row (the stream): the view is the same either way. */
export function stepView(row: StepRow | StepSummaryRow): StepView {
  const waits = row.status === "pending" || row.status === "waiting";
  return {
    stage: row.stage,
    status: row.status,
    attempt: row.attempt,
    error: publicStepError(row.error),
    nextAt: waits ? row.notBefore.toISOString() : null,
    leaseUntil: row.leaseUntil.getTime() > 0 ? row.leaseUntil.toISOString() : null,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    note: noteOf(row.stage, row.status, "summary" in row ? row.summary : summarize(row.output)),
  };
}

/** What makes two views of one stage different enough to send again. */
export function stepFingerprint(v: StepView): string {
  return JSON.stringify([v.status, v.attempt, v.error, v.nextAt, v.leaseUntil, v.note]);
}

const SKIPPED: Readonly<Record<string, string>> = {
  no_sources: "no web sources were picked",
  no_documents: "no documents were picked",
  no_evidence: "no evidence to seal",
  no_transcript: "no debate ran, so there is nothing to seal",
  no_certificates: "nothing was certified, so there is no envelope",
};

function skippedNote(o: OutputSummary): string {
  if (o.reason === null) return "skipped";
  return SKIPPED[o.reason] ?? `skipped: ${o.reason}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function waitingNote(stage: Stage, o: OutputSummary): string | null {
  switch (stage) {
    case "wake":
      return o.asleep !== null && o.asleep.length > 0
        ? `waiting for ${o.asleep.join(", ")} to wake`
        : "waiting for the services to wake";
    case "read":
      return "waiting for inkthread to finish reading";
    case "debate":
      return o.debateId === null ? null : `debate ${o.debateId.slice(0, 8)} is running`;
    default:
      return null;
  }
}

function okNote(stage: Stage, o: OutputSummary): string | null {
  switch (stage) {
    case "wake":
      return o.live === null ? null : `live: ${o.live.join(", ")}`;
    case "gather":
      return o.length === null ? null : count(o.length, "web candidate", "web candidates");
    case "read":
      return o.length === null ? null : count(o.length, "passage or table", "passages and tables");
    case "seal":
      return o.certified === null || o.total === null
        ? null
        : `certified ${o.certified} of ${o.total}`;
    case "debate":
      if (o.verdict === null) return null;
      return o.confidence === null
        ? o.verdict.toLowerCase()
        : `${o.verdict.toLowerCase()} · ${Math.round(o.confidence * 100)}% confidence`;
    case "measure":
      return o.perfReceiptHash === null ? null : `perf receipt ${o.perfReceiptHash.slice(0, 8)}`;
    case "envelope":
      return o.envelopeId === null ? null : `envelope ${o.envelopeId.slice(0, 8)}`;
    case "record":
      return o.auditDigest === null ? null : `audit digest ${o.auditDigest.slice(0, 8)}`;
  }
}

/** One line about a row's output summary, or null when there is nothing to say. */
export function noteOf(stage: Stage, status: StepStatus, o: OutputSummary): string | null {
  switch (status) {
    case "skipped":
      return skippedNote(o);
    case "waiting":
      return waitingNote(stage, o);
    case "ok":
      return okNote(stage, o);
    case "pending":
    case "running":
    case "error":
      return null;
  }
}

/** One line about a row's output, or null when there is nothing to say (or it cannot be read). */
export function stepNote(stage: Stage, status: StepStatus, output: Json): string | null {
  return noteOf(stage, status, summarize(output));
}

const STAGE_ORDER: readonly Stage[] = [
  "wake",
  "gather",
  "read",
  "seal",
  "debate",
  "measure",
  "envelope",
  "record",
];

/** The views in stage order (Postgres returns the rows in no particular order); stable. */
export function sortByStage<V extends Pick<StepView, "stage">>(views: readonly V[]): V[] {
  return [...views].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
}

/** Exactly one view per stage — what the runner keeps, and what the live island can follow. */
export function onePerStage(views: readonly Pick<StepView, "stage">[]): boolean {
  return (
    views.length === STAGE_ORDER.length &&
    new Set(views.map((v) => v.stage)).size === STAGE_ORDER.length
  );
}
