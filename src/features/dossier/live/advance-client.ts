import * as z from "zod/mini";
import type { Stage } from "@/dossier/stages";
import { type CallOptions, postRoute } from "@/features/tools/client";
import type { FetchLike, ToolOutcome } from "@/features/tools/outcome";
import { DOSSIER_STAGES, STEP_STATUSES } from "@/lib/db/enums";
import { DOSSIER_STATUSES } from "./events";
import type { AdvanceOutcome } from "./nudger";

/**
 * The browser edges of the runner (spec 21 §6.2, §6.4, §6.6): the page's nudge, `POST
 * /api/dossiers/[id]/advance` (its `AdvanceResult` parsed), and "retry from this stage", `POST
 * /api/dossiers/[id]/retry` with `{stage}`. An abort is rethrown, so a page that was left sets
 * nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dossierPath(id: string, action: "advance" | "retry"): string {
  if (!UUID.test(id)) throw new RangeError(`${action}: not a dossier id`);
  return `/api/dossiers/${id}/${action}`;
}

const isoTime = z.string().check(z.refine((s) => !Number.isNaN(Date.parse(s)), "not a time"));

const advanceResult = z.object({
  ran: z.nullable(z.enum(DOSSIER_STAGES)),
  status: z.nullable(z.enum(STEP_STATUSES)),
  dossier: z.enum(DOSSIER_STATUSES),
  nextAt: z.nullable(isoTime),
});

const limitBody = z.object({ retryAfterS: z.optional(z.number().check(z.nonnegative())) });

function retryAfter(res: Response, body: unknown): number {
  const fromBody = limitBody.safeParse(body);
  if (fromBody.success && fromBody.data.retryAfterS !== undefined) return fromBody.data.retryAfterS;
  const header = res.headers.get("retry-after")?.trim() ?? "";
  return /^\d+$/.test(header) ? Math.max(1, Number(header)) : 60;
}

async function body(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text());
  } catch {
    return undefined;
  }
}

export async function postAdvance(
  dossierId: string,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<AdvanceOutcome> {
  const path = dossierPath(dossierId, "advance");
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method: "POST",
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
  } catch (err) {
    if (signal.aborted) throw err;
    return { kind: "failed", detail: "bastion could not be reached" };
  }
  const answer = await body(res);
  if (res.status === 429) return { kind: "rate_limited", retryAfterS: retryAfter(res, answer) };
  if (res.status === 404) return { kind: "gone" };
  if (!res.ok) return { kind: "failed", detail: `advance answered ${res.status}` };
  const parsed = advanceResult.safeParse(answer);
  if (!parsed.success) return { kind: "failed", detail: "advance answered in an unexpected shape" };
  return { kind: "ok", dossier: parsed.data.dossier, nextAt: parsed.data.nextAt };
}

export const retryAnswer = z.object({
  stage: z.enum(DOSSIER_STAGES),
  dossier: z.enum(DOSSIER_STATUSES),
});
export type RetryAnswer = z.infer<typeof retryAnswer>;

export function postRetry(
  dossierId: string,
  stage: Stage,
  options: CallOptions = {},
): Promise<ToolOutcome<RetryAnswer>> {
  return postRoute(dossierPath(dossierId, "retry"), { stage }, retryAnswer, options);
}
