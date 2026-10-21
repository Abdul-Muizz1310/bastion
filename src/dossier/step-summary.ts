import type { Json } from "@/platform/canonical-json";
import type { StepRow } from "./stages";

/**
 * The few small facts a step's one-line note needs (spec 21 §6.6, "The live run"), read off its
 * output — never the output itself, which for gather holds whole web pages. Pure. `summarize` is
 * the reference: the stream's SQL projection (`loadStepSummaries` in `./store`) reads the same
 * fields with the same types, and an integration test holds them to agree row for row.
 *
 * - `length`: an array output's length (gather's and read's candidates), else null;
 * - strings (`reason`, `debateId`, `verdict`, the receipt ids): only a non-empty string;
 * - numbers (`certified`, `total`, `confidence`): only a JSON number;
 * - lists (`live`, `asleep`): only an array of strings.
 */

export type OutputSummary = {
  length: number | null;
  reason: string | null;
  live: string[] | null;
  asleep: string[] | null;
  certified: number | null;
  total: number | null;
  debateId: string | null;
  verdict: string | null;
  confidence: number | null;
  perfReceiptHash: string | null;
  envelopeId: string | null;
  auditDigest: string | null;
};

export const EMPTY_SUMMARY: OutputSummary = {
  length: null,
  reason: null,
  live: null,
  asleep: null,
  certified: null,
  total: null,
  debateId: null,
  verdict: null,
  confidence: null,
  perfReceiptHash: null,
  envelopeId: null,
  auditDigest: null,
};

/** A step row as the stream reads it: every column but the output, and the output's summary. */
export type StepSummaryRow = Omit<StepRow, "output"> & { summary: OutputSummary };

type Obj = { readonly [key: string]: Json };

function str(o: Obj, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v !== "" ? v : null;
}

function num(o: Obj, key: string): number | null {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strings(o: Obj, key: string): string[] | null {
  const v = o[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

export function summarize(output: Json): OutputSummary {
  if (Array.isArray(output)) return { ...EMPTY_SUMMARY, length: output.length };
  if (typeof output !== "object" || output === null) return EMPTY_SUMMARY;
  const o = output as Obj;
  return {
    length: null,
    reason: str(o, "reason"),
    live: strings(o, "live"),
    asleep: strings(o, "asleep"),
    certified: num(o, "certified"),
    total: num(o, "total"),
    debateId: str(o, "debateId"),
    verdict: str(o, "verdict"),
    confidence: num(o, "confidence"),
    perfReceiptHash: str(o, "perfReceiptHash"),
    envelopeId: str(o, "envelopeId"),
    auditDigest: str(o, "auditDigest"),
  };
}

/** A full row as the stream would read it (the page reads full rows; the stream, summaries). */
export function summarizeRow(row: StepRow): StepSummaryRow {
  const { output, ...rest } = row;
  return { ...rest, summary: summarize(output) };
}
