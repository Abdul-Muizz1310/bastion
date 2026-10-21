import "server-only";
import { and, asc, desc, eq, like, lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { likePrefix } from "./like";

/**
 * Reading the append-only log for the public audit pages (spec 21 §3.2). It selects the columns the
 * pages show plus the metadata their known fields come from — never `before` or `after` — and is
 * never scoped by actor: every visitor reads the same rows.
 *
 * `newest`: by id, descending — the list and its cursor (`beforeId`). `oldest`: by time, then id —
 * one request's events, as they were logged.
 */

export type StoredEvent = {
  id: number;
  actor: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  service: string | null;
  requestId: string | null;
  metadata: unknown;
  createdAt: Date;
};

export type ReadEventsOptions = {
  service?: string;
  /** A literal prefix: `%` and `_` match only themselves. */
  actionPrefix?: string;
  requestId?: string;
  /** Only events with a smaller id. */
  beforeId?: number;
  limit: number;
  order: "newest" | "oldest";
};

const MAX_LIMIT = 1_001;

export async function readEvents(options: ReadEventsOptions): Promise<StoredEvent[]> {
  const { limit, beforeId } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`readEvents: limit must be 1..${MAX_LIMIT}, not ${limit}`);
  }
  if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1)) {
    throw new RangeError(`readEvents: beforeId must be a positive whole number, not ${beforeId}`);
  }

  const conditions = [
    options.service === undefined ? undefined : eq(events.service, options.service),
    options.actionPrefix === undefined
      ? undefined
      : like(events.action, likePrefix(options.actionPrefix)),
    options.requestId === undefined ? undefined : eq(events.requestId, options.requestId),
    beforeId === undefined ? undefined : lt(events.id, beforeId),
  ];

  return getDb()
    .select({
      id: events.id,
      actor: events.actor,
      actorId: events.actorId,
      action: events.action,
      entityType: events.entityType,
      entityId: events.entityId,
      service: events.service,
      requestId: events.requestId,
      metadata: events.metadata,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(and(...conditions))
    .orderBy(
      ...(options.order === "newest" ? [desc(events.id)] : [asc(events.createdAt), asc(events.id)]),
    )
    .limit(limit);
}
