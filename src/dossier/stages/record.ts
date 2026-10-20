import { requestEvents } from "@/platform/audit/request-events";
import { auditDigest, lastEventId } from "../receipt-math";
import { findReceipt, saveReceiptOnce } from "../receipts";
import type { StageHandler, StageOutcome } from "../stages";

/**
 * Stage `record` (spec 21 §6.1, §6.5): the audit receipt. One read of the append-only log takes
 * every event under the dossier's request id; their digest is stored with the last id it covers
 * (`up_to_event_id`), so the verify step recomputes it over exactly those events however many are
 * logged afterwards (this stage's own `dossier.stage.ok` among them). Stored once per dossier.
 *
 * The stage does not touch `dossiers.status`: once it is ok every stage is ok or skipped and the
 * runner's status sync marks the dossier succeeded in the same transaction.
 */

export type RecordDeps = {
  events: typeof requestEvents;
  stored: typeof findReceipt;
  save: typeof saveReceiptOnce;
};

function ok(hash: string | null): StageOutcome {
  return hash === null
    ? { kind: "error", error: "record: the stored audit receipt has no digest", retryable: false }
    : { kind: "ok", output: { auditDigest: hash } };
}

export function recordStage(deps: RecordDeps): StageHandler {
  return async (ctx) => {
    const { id: dossierId, requestId } = ctx.dossier;
    const existing = await deps.stored(dossierId, "audit");
    if (existing !== null) return ok(existing.hash);

    const events = await deps.events(requestId);
    const kept = await deps.save(dossierId, {
      kind: "audit",
      ref: requestId,
      hash: auditDigest(events),
      signature: null,
      payload: {
        request_id: requestId,
        up_to_event_id: lastEventId(events),
        event_count: events.length,
      },
    });
    return ok(kept.hash);
  };
}

export const record: StageHandler = recordStage({
  events: requestEvents,
  stored: findReceipt,
  save: saveReceiptOnce,
});
