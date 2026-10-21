import { SYSTEM_ACTOR } from "@/platform/audit/event";
import { isVisitorId, type VisitorId } from "@/platform/visitor";

/**
 * Who an event says acted, as the public log writes it (spec 21 §3.2 invariant 2): a visitor's
 * pseudonym as it is, system work as `bastion`. A v1 row only knows a signed-in user's uuid, which
 * is never shown; anything else in the column is never echoed. Pure.
 */

export type ActorDisplay =
  | { kind: "visitor"; label: VisitorId }
  | { kind: "system"; label: typeof SYSTEM_ACTOR }
  | { kind: "v1-user"; label: "v1 user" }
  | { kind: "none"; label: "no actor" }
  | { kind: "unrecognised"; label: "unrecognised actor" };

export function actorDisplay(row: { actor: string | null; actorId: string | null }): ActorDisplay {
  const { actor, actorId } = row;
  if (actor === SYSTEM_ACTOR) return { kind: "system", label: SYSTEM_ACTOR };
  if (isVisitorId(actor)) return { kind: "visitor", label: actor };
  if (actor !== null) return { kind: "unrecognised", label: "unrecognised actor" };
  if (actorId !== null) return { kind: "v1-user", label: "v1 user" };
  return { kind: "none", label: "no actor" };
}
