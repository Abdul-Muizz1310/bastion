import { and, asc, eq, lte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";

/**
 * One request's slice of the append-only audit log (spec 21 §6.1, §6.5): every event carrying the
 * request id, ordered by id, optionally only up to an inclusive id bound. A dossier's receipts read
 * it to learn which services the dossier called and to digest what was logged; storing the bound
 * next to a digest lets the verify step recompute it over exactly the same events later.
 */

export type RequestEvent = {
  id: number;
  action: string;
  service: string | null;
  createdAt: Date;
};

export async function requestEvents(requestId: string, upTo?: number): Promise<RequestEvent[]> {
  if (requestId.trim() === "") throw new RangeError("requestEvents: the request id is blank");
  if (upTo !== undefined && (!Number.isSafeInteger(upTo) || upTo < 0)) {
    throw new RangeError(`requestEvents: the bound ${upTo} is not a non-negative integer`);
  }
  return getDb()
    .select({
      id: events.id,
      action: events.action,
      service: events.service,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(
      and(eq(events.requestId, requestId), upTo === undefined ? undefined : lte(events.id, upTo)),
    )
    .orderBy(asc(events.id));
}
