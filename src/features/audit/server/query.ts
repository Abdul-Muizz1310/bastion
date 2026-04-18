import { forbidden } from "next/navigation";
import { queryEvents } from "@/lib/audit/write";
import type { HydratedSession } from "@/lib/auth/session";
import type { Event as EventRow } from "@/lib/db/schema";

export type AuditFilters = {
  service?: string;
  actionPrefix?: string;
  since?: Date;
  limit?: number;
};

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/**
 * Query audit events scoped to the session's role:
 * - admin / editor → see all events (filters narrow).
 * - viewer → sees only their own events (actorId forced to session user).
 */
export async function queryAuditFor(
  session: HydratedSession,
  filters: AuditFilters = {},
): Promise<EventRow[]> {
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const options = {
    service: filters.service,
    actionPrefix: filters.actionPrefix,
    from: filters.since,
    limit,
    actorId: session.user.role === "viewer" ? session.user.id : undefined,
  };
  return queryEvents(options);
}

/**
 * Fetch all events for a given requestId, ordered by createdAt ASC (trace order).
 * For viewer, rejects with `forbidden()` if any event in the trace belongs to
 * another user — prevents viewing cross-user traces.
 */
export async function queryTraceFor(
  session: HydratedSession,
  requestId: string,
): Promise<EventRow[]> {
  const events = await queryEvents({ requestId, limit: MAX_LIMIT });

  if (session.user.role === "viewer") {
    const hasOthers = events.some((e) => e.actorId !== null && e.actorId !== session.user.id);
    if (hasOthers) {
      forbidden();
    }
  }

  // Reverse to ASC — queryEvents returns DESC.
  return [...events].reverse();
}
