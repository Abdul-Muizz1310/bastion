import "server-only";
import { readEvents } from "@/platform/audit/read";
import { AUDIT_PAGE_SIZE, type AuditQuery, TRACE_LIMIT } from "../filters";
import { type AuditEventView, type AuditPage, eventView, pageOf } from "../view";

/**
 * The audit pages' reads (spec 21 §3.2). The log is public: every visitor reads the same rows, so
 * nothing here is scoped by actor (invariant 1). Rows leave as views — known fields only.
 */

export { TRACE_LIMIT };

/** One page of the log, newest first by id, and the cursor for the next older page. */
export async function listAudit(query: AuditQuery): Promise<AuditPage> {
  const { service, action, request } = query.filters;
  const rows = await readEvents({
    ...(service === undefined ? {} : { service }),
    ...(action === undefined ? {} : { actionPrefix: action }),
    ...(request === undefined ? {} : { requestId: request }),
    ...(query.before === null ? {} : { beforeId: query.before }),
    limit: AUDIT_PAGE_SIZE + 1,
    order: "newest",
  });
  return pageOf(rows.map(eventView), AUDIT_PAGE_SIZE);
}

/** One request's events as they were logged — the first 500, and whether there were more. */
export async function requestTrace(
  requestId: string,
): Promise<{ events: AuditEventView[]; truncated: boolean }> {
  const rows = await readEvents({ requestId, limit: TRACE_LIMIT + 1, order: "oldest" });
  return {
    events: rows.slice(0, TRACE_LIMIT).map(eventView),
    truncated: rows.length > TRACE_LIMIT,
  };
}
