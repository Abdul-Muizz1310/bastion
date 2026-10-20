import * as z from "zod/mini";
import { DOSSIER_STAGES, STEP_STATUSES } from "@/lib/db/enums";
import type { StepView } from "../step-view";

/**
 * The stream route's events as the browser reads them (spec 21 §6.6, "The live run"): each one
 * parsed with these schemas (zod/mini, small enough for the island), never cast. An event outside
 * the contract is dropped, so it can never corrupt the timeline.
 */

export const DOSSIER_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type DossierStatus = (typeof DOSSIER_STATUSES)[number];
export const VERDICTS = ["TRUE", "FALSE", "INCONCLUSIVE"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type StatusEvent = {
  status: DossierStatus;
  verdict: Verdict | null;
  confidence: number | null;
};
export type DoneEvent = StatusEvent & { reason?: string };

export type StreamEvent =
  | { type: "step"; step: StepView }
  | { type: "status"; status: StatusEvent }
  | { type: "done"; done: DoneEvent }
  | { type: "timeout" }
  | { type: "heartbeat" };

const isoTime = z.string().check(z.refine((s) => !Number.isNaN(Date.parse(s)), "not a time"));
const time = z.nullable(isoTime);

const stepSchema = z.object({
  stage: z.enum(DOSSIER_STAGES),
  status: z.enum(STEP_STATUSES),
  attempt: z.number().check(z.int(), z.nonnegative()),
  error: z.nullable(z.string()),
  nextAt: time,
  leaseUntil: time,
  startedAt: time,
  finishedAt: time,
  note: z.nullable(z.string()),
});

const confidence = z.nullable(z.number().check(z.gte(0), z.lte(1)));

const statusSchema = z.object({
  status: z.enum(DOSSIER_STATUSES),
  verdict: z.nullable(z.enum(VERDICTS)),
  confidence,
});

/** A deleted dossier ends with `{status: "failed", reason}` and no verdict fields. */
const doneSchema = z.object({
  status: z.enum(DOSSIER_STATUSES),
  verdict: z.optional(z.nullable(z.enum(VERDICTS))),
  confidence: z.optional(confidence),
  reason: z.optional(z.string()),
});

function json(data: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(data) };
  } catch {
    return { ok: false };
  }
}

export function parseStreamEvent(type: string, data: string): StreamEvent | null {
  const body = json(data);
  if (!body.ok) return null;
  switch (type) {
    case "step": {
      const parsed = stepSchema.safeParse(body.value);
      return parsed.success ? { type: "step", step: parsed.data } : null;
    }
    case "status": {
      const parsed = statusSchema.safeParse(body.value);
      return parsed.success ? { type: "status", status: parsed.data } : null;
    }
    case "done": {
      const parsed = doneSchema.safeParse(body.value);
      if (!parsed.success) return null;
      const { status, verdict, confidence: c, reason } = parsed.data;
      return {
        type: "done",
        done: {
          status,
          verdict: verdict ?? null,
          confidence: c ?? null,
          ...(reason === undefined ? {} : { reason }),
        },
      };
    }
    case "timeout":
      return { type: "timeout" };
    case "heartbeat":
      return { type: "heartbeat" };
    default:
      return null;
  }
}
