import "server-only";
import { type AuditQuery, type FilterProblem, parseAuditQuery, type SearchParams } from "./filters";
import { allowRead as spendRead } from "./read-limit";
import { listAudit as readPage } from "./server/query";
import type { AuditPage } from "./view";

/**
 * What `/audit` renders (spec 21 §3.2): the page the query asks for; a refusal, before anything is
 * read, when the query holds what the page does not understand (invariant 3); the visitor's read
 * limit, when it is spent (Ruling AL: 60 a minute, nothing read); or the log marked unavailable
 * when the database cannot be read — never the page failing.
 */

export type AuditState =
  | { kind: "ok"; query: AuditQuery; page: AuditPage }
  | { kind: "refused"; problems: FilterProblem[] }
  | { kind: "limited"; query: AuditQuery; retryAfterS: number; limit: number }
  | { kind: "unavailable"; query: AuditQuery };

export type AuditDeps = { listAudit: typeof readPage; allowRead: typeof spendRead };

export async function loadAudit(
  search: SearchParams,
  deps: AuditDeps = { listAudit: readPage, allowRead: spendRead },
): Promise<AuditState> {
  const parsed = parseAuditQuery(search);
  if (!parsed.ok) return { kind: "refused", problems: parsed.problems };
  const allowance = await deps.allowRead("audit");
  if (!allowance.ok) {
    return {
      kind: "limited",
      query: parsed.query,
      retryAfterS: allowance.retryAfterS,
      limit: allowance.limit,
    };
  }
  try {
    return { kind: "ok", query: parsed.query, page: await deps.listAudit(parsed.query) };
  } catch (err) {
    console.error("audit: the log could not be read", err);
    return { kind: "unavailable", query: parsed.query };
  }
}
