import { canonicalJson, type Json } from "@/platform/canonical-json";
import type { ServiceId } from "@/platform/registry/products";
import { sha256Hex } from "@/platform/sha256";

/**
 * The receipts' pure math (spec 21 §6.1, §6.5). No I/O: the measure, envelope and record stages
 * compute these when they write a receipt, and the verify step recomputes them from what is stored.
 *
 * `canonicalJson` is RFC 8785 (JCS) for these values, so any JCS library recomputes both digests;
 * Python's `json.dumps(sort_keys=True)` does not (see `@/platform/canonical-json`).
 *
 * - **Perf receipt hash** = `sha256Hex(canonicalJson(receipt))` over exactly the fields declared
 *   below (`perfReceiptJson`), whatever else a value carries at run time. The stored receipt
 *   payload *is* that value, so a third party hashes the payload as stored.
 * - **Audit digest** = `sha256Hex(canonicalJson(rows))` where `rows` is `[id, action, service,
 *   created_at]` per event, ordered by id ascending.
 *
 * The audit digest recipe a third party needs, from the `events` table alone:
 *
 * 1. take the rows with `request_id` = the dossier's request id and `id` ≤ the bound: the audit
 *    receipt's `payload.up_to_event_id`, or the envelope's signed `metadata.audit_up_to`;
 * 2. order them by `id` ascending; each becomes the array `[id, action, service, created_at]`:
 *    `id` a JSON number, `action` a string, `service` a string or null;
 * 3. `created_at` is the timestamptz **truncated (not rounded) to milliseconds**, in UTC, written
 *    `YYYY-MM-DDTHH:MM:SS.mmmZ` with exactly three fraction digits (`Date.prototype.toISOString`).
 *    Postgres keeps microseconds, so in SQL:
 *    `to_char(date_trunc('milliseconds', created_at) AT TIME ZONE 'UTC',
 *    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
 * 4. the digest is the lower-case hex SHA-256 of the UTF-8 bytes of the JCS form of that array of
 *    arrays (`[[41,"gateway.call","magpie","2026-10-20T10:00:00.123Z"],…]`, no whitespace).
 */

/** An index (or other) suggestion slowquery made; `sql` is null for one it could not write as SQL. */
export type PerfSuggestion = { kind: string; sql: string | null };

/** One query fingerprint a service ran for the request; `max_ms` is null when the service did not say. */
export type PerfQuery = {
  id: string;
  fingerprint: string;
  calls: number;
  total_ms: number;
  max_ms: number | null;
  suggestions: PerfSuggestion[];
};

/** A service that answered (its queries), or one that did not (no queries, and why). */
export type PerfService =
  | { service: ServiceId; queries: PerfQuery[]; error?: never }
  | { service: ServiceId; queries: []; error: string };

export type PerfReceipt = { dossier_id: string; request_id: string; services: PerfService[] };

function queryJson(q: PerfQuery): Json {
  return {
    id: q.id,
    fingerprint: q.fingerprint,
    calls: q.calls,
    total_ms: q.total_ms,
    max_ms: q.max_ms,
    suggestions: q.suggestions.map((s) => ({ kind: s.kind, sql: s.sql })),
  };
}

function serviceJson(s: PerfService): Json {
  const answered = { service: s.service, queries: s.queries.map(queryJson) };
  return s.error === undefined ? answered : { ...answered, error: s.error };
}

/** The receipt as the JSON value that is hashed and stored (only the declared fields). */
export function perfReceiptJson(r: PerfReceipt): Json {
  return {
    dossier_id: r.dossier_id,
    request_id: r.request_id,
    services: r.services.map(serviceJson),
  };
}

export function perfReceiptHash(r: PerfReceipt): string {
  return sha256Hex(canonicalJson(perfReceiptJson(r)));
}

/** The fields of an audit event the digest covers (`events` row: id, action, service, created_at). */
export type AuditEventForDigest = {
  id: number;
  action: string;
  service: string | null;
  createdAt: Date;
};

/**
 * The audit digest over a set of events, ordered by id whatever order they arrive in. Event ids are
 * the log's bigserial keys: a duplicate or a non-positive / non-integer id is refused, and so is a
 * time that is not a valid date.
 */
export function auditDigest(events: readonly AuditEventForDigest[]): string {
  const ids = new Set<number>();
  for (const e of events) {
    if (!Number.isSafeInteger(e.id) || e.id < 1) {
      throw new RangeError(`auditDigest: event id ${e.id} is not a positive integer`);
    }
    if (ids.has(e.id)) throw new RangeError(`auditDigest: event id ${e.id} appears twice`);
    ids.add(e.id);
  }
  const rows: Json = [...events]
    .sort((a, b) => a.id - b.id)
    .map((e) => [e.id, e.action, e.service, e.createdAt.toISOString()]);
  return sha256Hex(canonicalJson(rows));
}

/** The highest event id in the set — the inclusive bound a digest is recomputed over — or 0. */
export function lastEventId(events: readonly AuditEventForDigest[]): number {
  return events.reduce((max, e) => Math.max(max, e.id), 0);
}
