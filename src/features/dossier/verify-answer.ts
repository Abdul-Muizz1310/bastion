import * as z from "zod/mini";
import { CHECK_NAMES, CHECK_STATES, type Check } from "@/dossier/checks";
import { type CallOptions, postRoute } from "@/features/tools/client";
import type { ToolOutcome } from "@/features/tools/outcome";

/**
 * "Verify everything" from the browser (spec 21 §6.5, §6.6): `POST /api/dossiers/[id]/verify` and
 * its answer, parsed with this schema (zod/mini) — a v2 answer with its checks, or a legacy one
 * with its note and no checks. Never cast.
 */

const state = z.enum(CHECK_STATES);

const check = z.object({
  name: z.enum(CHECK_NAMES),
  state,
  detail: z.string(),
  items: z.optional(z.array(z.object({ ref: z.string(), state, detail: z.string() }))),
});

const checked = z.object({
  dossierId: z.string(),
  legacy: z.literal(false),
  checks: z.array(check),
});

const legacy = z.object({
  dossierId: z.string(),
  legacy: z.literal(true),
  note: z.string().check(z.minLength(1)),
  checks: z.array(check).check(z.maxLength(0)),
});

export const verifyAnswer = z.discriminatedUnion("legacy", [checked, legacy]);

export type VerifyAnswer =
  | { dossierId: string; legacy: false; checks: Check[] }
  | { dossierId: string; legacy: true; note: string; checks: Check[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function postVerify(
  dossierId: string,
  options: CallOptions = {},
): Promise<ToolOutcome<VerifyAnswer>> {
  if (!UUID.test(dossierId)) throw new RangeError("verify: not a dossier id");
  return postRoute(`/api/dossiers/${dossierId}/verify`, {}, verifyAnswer, options);
}
