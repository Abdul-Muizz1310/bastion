import type { Stage, StepRow, StepStatus } from "@/dossier/stages";
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

export function stepView(row: StepRow): StepView {
  const waits = row.status === "pending" || row.status === "waiting";
  return {
    stage: row.stage,
    status: row.status,
    attempt: row.attempt,
    error: row.error,
    nextAt: waits ? row.notBefore.toISOString() : null,
    leaseUntil: row.leaseUntil.getTime() > 0 ? row.leaseUntil.toISOString() : null,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    note: stepNote(row.stage, row.status, row.output),
  };
}

/** What makes two views of one stage different enough to send again. */
export function stepFingerprint(v: StepView): string {
  return JSON.stringify([v.status, v.attempt, v.error, v.nextAt, v.leaseUntil, v.note]);
}

type Obj = { readonly [key: string]: Json };

function obj(value: Json): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function strings(value: Json | undefined): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : null;
}

function str(value: Json | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SKIPPED: Readonly<Record<string, string>> = {
  no_sources: "no web sources were picked",
  no_documents: "no documents were picked",
  no_evidence: "no evidence to seal",
  no_transcript: "no debate ran, so there is nothing to seal",
  no_certificates: "nothing was certified, so there is no envelope",
};

function skippedNote(output: Json): string {
  const reason = str(obj(output)?.reason);
  if (reason === null) return "skipped";
  return SKIPPED[reason] ?? `skipped: ${reason}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function waitingNote(stage: Stage, output: Json): string | null {
  switch (stage) {
    case "wake": {
      const asleep = strings(obj(output)?.asleep);
      return asleep !== null && asleep.length > 0
        ? `waiting for ${asleep.join(", ")} to wake`
        : "waiting for the services to wake";
    }
    case "read":
      return "waiting for inkthread to finish reading";
    case "debate": {
      const id = str(obj(output)?.debateId);
      return id === null ? null : `debate ${id.slice(0, 8)} is running`;
    }
    default:
      return null;
  }
}

function okNote(stage: Stage, output: Json): string | null {
  const o = obj(output);
  switch (stage) {
    case "wake": {
      const live = strings(o?.live);
      return live === null ? null : `live: ${live.join(", ")}`;
    }
    case "gather":
      return Array.isArray(output) ? count(output.length, "web candidate", "web candidates") : null;
    case "read":
      return Array.isArray(output)
        ? count(output.length, "passage or table", "passages and tables")
        : null;
    case "seal": {
      const certified = num(o?.certified);
      const total = num(o?.total);
      return certified === null || total === null ? null : `certified ${certified} of ${total}`;
    }
    case "debate": {
      const verdict = str(o?.verdict);
      const confidence = num(o?.confidence);
      if (verdict === null) return null;
      return confidence === null
        ? verdict.toLowerCase()
        : `${verdict.toLowerCase()} · ${Math.round(confidence * 100)}% confidence`;
    }
    case "measure": {
      const hash = str(o?.perfReceiptHash);
      return hash === null ? null : `perf receipt ${hash.slice(0, 8)}`;
    }
    case "envelope": {
      const id = str(o?.envelopeId);
      return id === null ? null : `envelope ${id.slice(0, 8)}`;
    }
    case "record": {
      const digest = str(o?.auditDigest);
      return digest === null ? null : `audit digest ${digest.slice(0, 8)}`;
    }
  }
}

/** One line about a row's output, or null when there is nothing to say (or it cannot be read). */
export function stepNote(stage: Stage, status: StepStatus, output: Json): string | null {
  switch (status) {
    case "skipped":
      return skippedNote(output);
    case "waiting":
      return waitingNote(stage, output);
    case "ok":
      return okNote(stage, output);
    case "pending":
    case "running":
    case "error":
      return null;
  }
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
