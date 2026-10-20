import { describe, expect, it, vi } from "vitest";
import { auditDigest } from "@/dossier/receipt-math";
import type { SingletonReceipt, StoredReceipt } from "@/dossier/receipts";
import { recordStage } from "@/dossier/stages/record";
import type { RequestEvent } from "@/platform/audit/request-events";
import { sha256Hex } from "@/platform/sha256";
import { stageCtx } from "./helpers";

/**
 * Stage `record` (spec 21 §6.1, §6.5): the audit receipt — the digest of every event logged under
 * the dossier's request id so far, with the last id it covers, so the verify step can recompute it
 * over exactly the same events. The dossier is marked succeeded by the runner once this stage is ok.
 */

const REQUEST_ID = "req-dossier-1";
const AT = new Date("2026-10-20T10:00:00Z");
const EVENTS: RequestEvent[] = [
  { id: 4, action: "gateway.call", service: "magpie", createdAt: AT },
  { id: 9, action: "dossier.stage.ok", service: "bastion", createdAt: AT },
  { id: 12, action: "gateway.call", service: null, createdAt: AT },
];

const storedFrom = (r: SingletonReceipt): StoredReceipt => ({
  id: "00000000-0000-4000-8000-0000000000bb",
  ...r,
  createdAt: AT,
});

function setup(
  opts: { events?: RequestEvent[]; stored?: StoredReceipt | null; keep?: StoredReceipt } = {},
) {
  const events = vi.fn(async (_requestId: string, _upTo?: number) => opts.events ?? EVENTS);
  const saved: SingletonReceipt[] = [];
  const stage = recordStage({
    events,
    stored: async () => opts.stored ?? null,
    save: async (_id, r) => {
      saved.push(r);
      return opts.keep ?? storedFrom(r);
    },
  });
  return { stage, events, saved };
}

describe("record stage", () => {
  it("stores the digest of the request's events with the last id it covers", async () => {
    const { stage, events, saved } = setup();
    const out = await stage(stageCtx());
    expect(events).toHaveBeenCalledWith(REQUEST_ID);
    expect(saved).toEqual([
      {
        kind: "audit",
        ref: REQUEST_ID,
        hash: auditDigest(EVENTS),
        signature: null,
        payload: { request_id: REQUEST_ID, up_to_event_id: 12, event_count: 3 },
      },
    ]);
    expect(out).toEqual({ kind: "ok", output: { auditDigest: auditDigest(EVENTS) } });
  });

  it("digests no events as the sha256 of [] up to id 0", async () => {
    const { stage, saved } = setup({ events: [] });
    await stage(stageCtx());
    expect(saved[0]).toMatchObject({
      hash: sha256Hex("[]"),
      payload: { request_id: REQUEST_ID, up_to_event_id: 0, event_count: 0 },
    });
  });

  it("reuses a stored audit receipt: no second digest", async () => {
    const kept = storedFrom({
      kind: "audit",
      ref: REQUEST_ID,
      hash: "c".repeat(64),
      signature: null,
      payload: {},
    });
    const { stage, saved, events } = setup({ stored: kept });
    expect(await stage(stageCtx())).toEqual({
      kind: "ok",
      output: { auditDigest: "c".repeat(64) },
    });
    expect(saved).toHaveLength(0);
    expect(events).not.toHaveBeenCalled();
  });

  it("reports the digest that was kept when another save won", async () => {
    const winner = storedFrom({
      kind: "audit",
      ref: REQUEST_ID,
      hash: "d".repeat(64),
      signature: null,
      payload: {},
    });
    const { stage } = setup({ keep: winner });
    expect(await stage(stageCtx())).toEqual({
      kind: "ok",
      output: { auditDigest: "d".repeat(64) },
    });
  });

  it("fails loudly when a stored audit receipt has no digest", async () => {
    const broken = {
      ...storedFrom({ kind: "audit", ref: null, hash: "x", signature: null, payload: {} }),
      hash: null,
    };
    const { stage } = setup({ stored: broken });
    expect(await stage(stageCtx())).toEqual({
      kind: "error",
      error: "record: the stored audit receipt has no digest",
      retryable: false,
    });
  });

  it("fails (and stores nothing) when the log holds an event id twice", async () => {
    const { stage, saved } = setup({
      events: [EVENTS[0] as RequestEvent, EVENTS[0] as RequestEvent],
    });
    await expect(stage(stageCtx())).rejects.toThrow(RangeError);
    expect(saved).toHaveLength(0);
  });
});
