import { type QueryRow, SLOWQUERY_HOSTS, slowquery } from "@/capabilities/slowquery";
import { requestEvents } from "@/platform/audit/request-events";
import { callCapability } from "@/platform/gateway/call";
import type { GatewayResult } from "@/platform/gateway/result";
import {
  lastEventId,
  type PerfQuery,
  type PerfReceipt,
  type PerfService,
  perfReceiptHash,
  perfReceiptJson,
} from "../receipt-math";
import { findReceipt, saveReceiptOnce } from "../receipts";
import type { StageContext, StageHandler, StageOutcome } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `measure` (spec 21 §6.1): the perf receipt. Every service the dossier called — read off the
 * audit log for its request id — that keeps a slowquery log is asked, in parallel, for the queries
 * it ran under that request id (Ruling P put the id on every call). A service that is asleep or
 * answers 401/403/404/5xx or something unreadable contributes `{service, queries: [], error}` and
 * the stage still succeeds; a failure that is bastion's own (its rate limit, a refused input,
 * another 4xx) fails it. The receipt is stored once per dossier: a re-run reuses it.
 *
 * Output `{perfReceiptHash, auditUpTo}`: `auditUpTo` is the last audit event id for the request
 * once measuring is done — the envelope's audit digest covers exactly the events up to it, so a
 * retried envelope signs the same bundle (inkprint answers an identical bundle idempotently).
 */

export type SlowqueryHost = (typeof SLOWQUERY_HOSTS)[number];

type QueriesInput = { service: SlowqueryHost; requestId: string };

export type MeasureDeps = {
  events: typeof requestEvents;
  queries: typeof callQueries;
  stored: typeof findReceipt;
  save: typeof saveReceiptOnce;
};

function callQueries(ctx: StageContext, input: QueriesInput) {
  return callCapability(slowquery.queries, input, callContext(ctx));
}

const HOSTS: ReadonlySet<string> = new Set(SLOWQUERY_HOSTS);

function isHost(service: string | null): service is SlowqueryHost {
  return service !== null && HOSTS.has(service);
}

/** The services the audit log shows the request called that keep a slowquery log, sorted. */
export function measuredServices(events: readonly { service: string | null }[]): SlowqueryHost[] {
  return [...new Set(events.map((e) => e.service).filter(isHost))].sort();
}

function toPerfQuery(row: QueryRow): PerfQuery {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    calls: row.call_count,
    total_ms: row.total_ms,
    max_ms: row.max_ms,
    suggestions: row.suggestions.map((s) => ({ kind: s.kind, sql: s.sql })),
  };
}

type Failure = Extract<GatewayResult<unknown>, { ok: false }>;

/** The code a service that did not answer contributes, or null when the failure is bastion's. */
function unanswered(f: Failure): string | null {
  switch (f.error) {
    case "asleep":
    case "invalid_response":
      return f.error;
    case "downstream_error":
      return [401, 403, 404].includes(f.status) || f.status >= 500 ? String(f.status) : null;
    case "rate_limited":
    case "budget_exhausted":
    case "invalid_input":
      return null;
  }
}

const byId = (a: PerfQuery, b: PerfQuery) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function measureStage(deps: MeasureDeps): StageHandler {
  return async (ctx): Promise<StageOutcome> => {
    const { id: dossierId, requestId } = ctx.dossier;
    const before = await deps.events(requestId);
    const ok = (hash: string | null, auditUpTo: number): StageOutcome =>
      hash === null
        ? { kind: "error", error: "measure: the stored perf receipt has no hash", retryable: false }
        : { kind: "ok", output: { perfReceiptHash: hash, auditUpTo } };

    const existing = await deps.stored(dossierId, "perf");
    if (existing !== null) return ok(existing.hash, lastEventId(before));

    const services = measuredServices(before);
    const answers = await Promise.all(
      services.map(async (service) => ({
        service,
        result: await deps.queries(ctx, { service, requestId }),
      })),
    );
    const measured: PerfService[] = [];
    for (const { service, result } of answers) {
      if (result.ok) {
        measured.push({ service, queries: result.data.map(toPerfQuery).sort(byId) });
        continue;
      }
      const code = unanswered(result);
      if (code === null) return failure(`slowquery.queries (${service})`, result);
      measured.push({ service, queries: [], error: code });
    }

    const receipt: PerfReceipt = {
      dossier_id: dossierId,
      request_id: requestId,
      services: measured,
    };
    const kept = await deps.save(dossierId, {
      kind: "perf",
      ref: requestId,
      hash: perfReceiptHash(receipt),
      signature: null,
      payload: perfReceiptJson(receipt),
    });
    // Read again: the queries above are audited under the request id too.
    return ok(kept.hash, lastEventId(await deps.events(requestId)));
  };
}

export const measure: StageHandler = measureStage({
  events: requestEvents,
  queries: callQueries,
  stored: findReceipt,
  save: saveReceiptOnce,
});
