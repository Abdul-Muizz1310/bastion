import { SYSTEM_ACTOR } from "@/platform/audit/event";
import { SERVICES, type ServiceId } from "@/platform/registry/products";

/**
 * `/audit`'s query string, parsed at the boundary (spec 21 §3.2 and invariant 3): three filters and
 * a cursor. An empty value is no filter (what an empty form field submits); an unknown parameter, a
 * repeated one or a malformed value is refused — named, with why — and nothing is read. A refused
 * value is never echoed back. Pure.
 */

export const AUDIT_PAGE_SIZE = 50;

/** One request's trail shows at most this many events. */
export const TRACE_LIMIT = 500;

export type AuditService = typeof SYSTEM_ACTOR | ServiceId;

/** bastion first, then the six services the gateway calls. */
export const AUDIT_SERVICES: readonly AuditService[] = [
  SYSTEM_ACTOR,
  ...(Object.keys(SERVICES) as ServiceId[]),
];

export type AuditFilters = {
  service?: AuditService;
  /** A literal prefix of the action. */
  action?: string;
  /** An exact request id. */
  request?: string;
};

export type AuditQuery = { filters: AuditFilters; before: number | null };

export type FilterProblem = { param: string; reason: "unknown" | "repeated" | "malformed" };

export type ParsedAuditQuery =
  | { ok: true; query: AuditQuery }
  | { ok: false; problems: FilterProblem[] };

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

const ACTION_PREFIX = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CURSOR = /^[1-9]\d{0,15}$/;

const PARAMS = ["service", "action", "request", "before"] as const;
type Param = (typeof PARAMS)[number];

function isParam(name: string): name is Param {
  return (PARAMS as readonly string[]).includes(name);
}

function isAuditService(value: string): value is AuditService {
  return (AUDIT_SERVICES as readonly string[]).includes(value);
}

export function parseAuditQuery(search: SearchParams): ParsedAuditQuery {
  const problems: FilterProblem[] = [];
  const filters: AuditFilters = {};
  let before: number | null = null;

  for (const [param, raw] of Object.entries(search)) {
    if (!isParam(param)) {
      problems.push({ param, reason: "unknown" });
      continue;
    }
    if (raw === undefined || raw === "") continue;
    if (Array.isArray(raw)) {
      problems.push({ param, reason: "repeated" });
      continue;
    }
    const malformed = () => problems.push({ param, reason: "malformed" });
    switch (param) {
      case "service":
        if (isAuditService(raw)) filters.service = raw;
        else malformed();
        break;
      case "action":
        if (ACTION_PREFIX.test(raw)) filters.action = raw;
        else malformed();
        break;
      case "request":
        if (REQUEST_ID.test(raw)) filters.request = raw;
        else malformed();
        break;
      case "before": {
        const n = Number(raw);
        if (CURSOR.test(raw) && Number.isSafeInteger(n)) before = n;
        else malformed();
        break;
      }
      default:
        return assertNever(param);
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, query: { filters, before } };
}

export function hasFilters(filters: AuditFilters): boolean {
  return (
    filters.service !== undefined || filters.action !== undefined || filters.request !== undefined
  );
}

/** The `/audit` URL for these filters (in a fixed order) and, optionally, a cursor. */
export function auditHref(filters: AuditFilters, before?: number): string {
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) {
    throw new RangeError(`auditHref: the cursor must be a positive whole number, not ${before}`);
  }
  const params = new URLSearchParams();
  if (filters.service !== undefined) params.set("service", filters.service);
  if (filters.action !== undefined) params.set("action", filters.action);
  if (filters.request !== undefined) params.set("request", filters.request);
  if (before !== undefined) params.set("before", String(before));
  const query = params.toString();
  return query === "" ? "/audit" : `/audit?${query}`;
}

function assertNever(value: never): never {
  throw new TypeError(`audit filters: unexpected parameter ${String(value)}`);
}
