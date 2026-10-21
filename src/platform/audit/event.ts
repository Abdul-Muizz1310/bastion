import { z } from "zod/v4";
import { isVisitorId, type VisitorId } from "@/platform/visitor";

/**
 * One audit event as the application hands it to the append-only log (spec 06, spec 21 §4).
 *
 * Every event names its actor: a pseudonymous visitor, or `bastion` for system work (the
 * dossier runner). The v1 `actorId` (a user uuid) is not accepted — old rows keep `actor_id`,
 * new rows never write it. Unknown keys are rejected, so a stale caller fails loudly instead of
 * having its actor silently dropped.
 */

export const SYSTEM_ACTOR = "bastion";

export type Actor = VisitorId | typeof SYSTEM_ACTOR;

export const actorSchema = z.union([
  z.literal(SYSTEM_ACTOR),
  z.custom<VisitorId>(isVisitorId, { message: "actor must be a visitor id (v_…) or bastion" }),
]);

export const eventInputSchema = z.strictObject({
  actor: actorSchema,
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  service: z.string().optional(),
  requestId: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EventInput = z.infer<typeof eventInputSchema>;
