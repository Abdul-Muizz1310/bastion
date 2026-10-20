import "server-only";
import { actorDisplay } from "@/features/audit/actor";
import { knownFields } from "@/features/audit/known-fields";
import { entityHref } from "@/features/audit/view";
import type { TimeTravelResult } from "@/lib/audit/replay";
import type { TimeTravelView } from "./view";

/**
 * The replay's result (Dates, each entity's metadata) as the view the slider receives (spec 07,
 * spec 21 §3.2): known fields only — the metadata stays on the server (invariant 6). Pure.
 */
export function toTimeTravelView(result: TimeTravelResult, asOf: Date): TimeTravelView {
  return {
    asOf: asOf.toISOString(),
    bounds: {
      min: result.bounds.min ? result.bounds.min.toISOString() : null,
      max: result.bounds.max.toISOString(),
    },
    entities: result.entities.map((entity) => ({
      entityType: entity.entityType,
      entityId: entity.entityId,
      href: entityHref(entity.entityType, entity.entityId),
      service: entity.service,
      lastAction: entity.lastAction,
      lastEventAt: entity.lastEventAt.toISOString(),
      requestId: entity.requestId,
      actor: actorDisplay(entity),
      facts: knownFields(entity.metadata),
    })),
    message: result.message ?? null,
    truncated: result.truncated,
  };
}
