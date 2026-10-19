import type { Event as EventRow } from "@/lib/db/schema";
import { queryEvents } from "@/platform/audit/write";

export type AuditFilters = {
  service?: string;
  actionPrefix?: string;
  since?: Date;
  limit?: number;
};

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/**
 * Query the audit log. It is public (spec 21 §2): every visitor reads the same log, so nothing
 * here scopes by actor — filters only narrow.
 */
export async function queryAudit(filters: AuditFilters = {}): Promise<EventRow[]> {
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  return queryEvents({
    service: filters.service,
    actionPrefix: filters.actionPrefix,
    from: filters.since,
    limit,
  });
}

/** Fetch all events for a given requestId, ordered by createdAt ASC (trace order). */
export async function queryTrace(requestId: string): Promise<EventRow[]> {
  const events = await queryEvents({ requestId, limit: MAX_LIMIT });
  // Reverse to ASC — queryEvents returns DESC.
  return [...events].reverse();
}
