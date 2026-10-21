import { DOSSIER_STAGES } from "@/lib/db/enums";

/**
 * The few fields of an event's metadata the public log shows (spec 21 §3.2 "What an event shows"),
 * each checked for shape. Metadata is free-form and could carry what a downstream answered, so
 * nothing else is ever read from it, and an error that is not a code is withheld. Pure, and safe in
 * the browser (it imports only constants).
 */

export type Stage = (typeof DOSSIER_STAGES)[number];

export type ErrorFact = { kind: "code"; code: string } | { kind: "withheld" };

export type KnownFields = {
  /** The HTTP status a gateway call got back, 100–599. */
  status: number | null;
  /** How long it took, ms (v2 `ms`, v1 `latencyMs`); finite, ≥ 0. */
  ms: number | null;
  /** A dossier stage event's stage. */
  stage: Stage | null;
  /** Which attempt at that stage, from 1. */
  attempt: number | null;
  error: ErrorFact | null;
};

export const NO_FIELDS: KnownFields = Object.freeze({
  status: null,
  ms: null,
  stage: null,
  attempt: null,
  error: null,
});

const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function status(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599
    ? (value as number)
    : null;
}

function duration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function stage(value: unknown): Stage | null {
  return typeof value === "string" && (DOSSIER_STAGES as readonly string[]).includes(value)
    ? (value as Stage)
    : null;
}

function attempt(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1 ? (value as number) : null;
}

function error(value: unknown): ErrorFact | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && ERROR_CODE.test(value)
    ? { kind: "code", code: value }
    : { kind: "withheld" };
}

export function knownFields(metadata: unknown): KnownFields {
  if (!isRecord(metadata)) return { ...NO_FIELDS };
  return {
    status: status(metadata.status),
    ms: duration(metadata.ms) ?? duration(metadata.latencyMs),
    stage: stage(metadata.stage),
    attempt: attempt(metadata.attempt),
    error: error(metadata.error ?? metadata.reason),
  };
}
