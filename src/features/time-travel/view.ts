import type { TimeTravelResult } from "@/lib/audit/replay";

/**
 * Serialisable projection of a replay query.
 *
 * `TimeTravelResult` carries `Date` objects; this view carries ISO strings so
 * it can cross the Server Action / Server Component boundary unchanged and be
 * compared structurally in tests. Nothing in here is nullable-by-accident:
 * `message` is `null` (never `undefined`) when there is nothing to say.
 */
export type TimeTravelEntityView = {
  entityType: string;
  entityId: string;
  service: string | null;
  state: unknown;
  lastAction: string;
  lastEventAt: string;
};

export type TimeTravelBoundsView = {
  /** ISO timestamp of the earliest event, or null when the log is empty. */
  min: string | null;
  /** ISO timestamp of the newest selectable moment (server "now"). */
  max: string;
};

export type TimeTravelView = {
  asOf: string;
  bounds: TimeTravelBoundsView;
  entities: TimeTravelEntityView[];
  message: string | null;
};

/**
 * What the Server Action returns. RBAC failures still throw (Next's
 * forbidden()/unauthorized() interrupts); everything a caller can reasonably
 * recover from is modelled as data.
 */
export type TimeTravelQueryResult =
  | { ok: true; view: TimeTravelView }
  | { ok: false; error: "invalid_timestamp" | "invalid_service" };

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
      service: entity.service,
      state: entity.state,
      lastAction: entity.lastAction,
      lastEventAt: entity.lastEventAt.toISOString(),
    })),
    message: result.message ?? null,
  };
}
