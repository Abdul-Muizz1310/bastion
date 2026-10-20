import type { ActorDisplay } from "@/features/audit/actor";
import type { KnownFields } from "@/features/audit/known-fields";

/**
 * Serialisable projection of a replay query (spec 07, spec 21 §3.2), as the slider receives it:
 * ISO strings, the actor as its pseudonym and the known fields only, so it crosses the Server
 * Action / Server Component boundary unchanged and never takes the metadata to the browser
 * (invariant 6). `message` is `null` (never `undefined`) when there is nothing to say. Types and
 * pure helpers only: the browser loads this module (`./to-view` builds the view on the server).
 */
export type TimeTravelEntityView = {
  entityType: string;
  entityId: string;
  /** A dossier's public page; null for every other entity. */
  href: string | null;
  service: string | null;
  lastAction: string;
  lastEventAt: string;
  requestId: string | null;
  actor: ActorDisplay;
  facts: KnownFields;
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
  /** More entities existed at this moment than the replay keeps. */
  truncated: boolean;
};

/**
 * What the Server Action returns: everything a caller can reasonably recover from is modelled as
 * data.
 */
export type TimeTravelQueryResult =
  | { ok: true; view: TimeTravelView }
  | { ok: false; error: "invalid_timestamp" | "invalid_service" };

export type TypeCount = { type: string; count: number };

/** Each entity type and how many entities it has, the most frequent first, then by name. */
export function typeCounts(entities: readonly TimeTravelEntityView[]): TypeCount[] {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.entityType, (counts.get(e.entityType) ?? 0) + 1);
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}
