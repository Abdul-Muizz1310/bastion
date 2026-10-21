import { describe, expect, it } from "vitest";
import { type AuditEventView, eventView } from "@/features/audit/view";
import { axisTicks, formatDuration, waterfall } from "@/features/audit/waterfall";
import type { StoredEvent } from "@/platform/audit/read";

/**
 * Spec 21 §3.2 `/audit/[requestId]` and invariant 5: one request's events on one time scale. An
 * event with a duration started that long before it was logged (the gateway logs a call when it
 * ends); rows are ordered by start, ties by id.
 */

const T0 = Date.parse("2026-10-20T09:00:00.000Z");
const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";

function at(id: number, offsetMs: number, more: Partial<StoredEvent> = {}): AuditEventView {
  return eventView({
    id,
    actor: "bastion",
    actorId: null,
    action: "gateway.call",
    entityType: "capability",
    entityId: "magpie.scrape",
    service: "magpie",
    requestId: "req-1",
    metadata: {},
    createdAt: new Date(T0 + offsetMs),
    ...more,
  });
}

describe("waterfall: ordering by start", () => {
  it("orders by start, not by when each event was logged", () => {
    // Logged 2nd but started first: a 1.5 s call that ended at +2 s.
    const w = waterfall([
      at(1, 1000, { action: "dossier.stage.ok", entityType: "dossier", entityId: DOSSIER }),
      at(2, 2000, { metadata: { status: 200, ms: 1500 } }),
    ]);
    expect(w.rows.map((r) => r.event.id)).toEqual([2, 1]);
    expect(w.rows.map((r) => r.offsetMs)).toEqual([0, 500]);
  });

  it("breaks ties by id, whatever order the events came in", () => {
    const w = waterfall([at(9, 0), at(3, 0), at(5, 0)]);
    expect(w.rows.map((r) => r.event.id)).toEqual([3, 5, 9]);
  });

  it("an event without a duration starts and ends when it was logged", () => {
    const [row] = waterfall([at(1, 0)]).rows;
    expect(row).toMatchObject({ offsetMs: 0, durationMs: null, left: 0, width: 0 });
  });
});

describe("waterfall: the shared scale", () => {
  const w = waterfall([
    at(1, 0),
    at(2, 1000, { metadata: { status: 200, ms: 400 } }), // 600 → 1000
    at(3, 2000, { metadata: { status: 502, ms: 1000, error: "downstream_error" } }), // 1000 → 2000
  ]);

  it("spans the earliest start to the latest end", () => {
    expect(w.spanMs).toBe(2000);
    expect(w.startedAt).toEqual(new Date(T0));
    expect(w.endedAt).toEqual(new Date(T0 + 2000));
  });

  it("places each bar from its start to its end, as a share of the span", () => {
    expect(w.rows.map((r) => [r.left, r.width])).toEqual([
      [0, 0],
      [30, 20],
      [50, 50],
    ]);
  });

  it("keeps every offset ≥ 0 and every bar inside [0, 100] (invariant 5)", () => {
    for (const r of w.rows) {
      expect(r.offsetMs).toBeGreaterThanOrEqual(0);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.left + r.width).toBeLessThanOrEqual(100);
    }
  });

  it("a span of 0 puts every tick at 0", () => {
    const flat = waterfall([at(1, 0), at(2, 0)]);
    expect(flat.spanMs).toBe(0);
    expect(flat.rows.map((r) => [r.left, r.width])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("a duration longer than the time since the first event moves the start back, not below 0", () => {
    const early = waterfall([at(1, 0), at(2, 100, { metadata: { ms: 5000 } })]);
    expect(early.rows.map((r) => r.event.id)).toEqual([2, 1]);
    expect(early.rows[0]).toMatchObject({ offsetMs: 0, left: 0 });
    expect(early.rows[1]?.offsetMs).toBe(4900);
  });
});

describe("waterfall: what the request touched", () => {
  it("names the services in order of first start, once each", () => {
    const w = waterfall([
      at(1, 0, { service: "bastion", action: "dossier.created", entityType: "dossier", entityId: DOSSIER }),
      at(2, 10, { service: "magpie" }),
      at(3, 20, { service: "inkprint" }),
      at(4, 30, { service: "magpie" }),
      at(5, 40, { service: null }),
    ]);
    expect(w.services).toEqual(["bastion", "magpie", "inkprint"]);
  });

  it("names the dossiers the request belongs to, once each, only by uuid", () => {
    const w = waterfall([
      at(1, 0, { entityType: "dossier", entityId: DOSSIER }),
      at(2, 10, { entityType: "dossier", entityId: DOSSIER }),
      at(3, 20, { entityType: "dossier", entityId: "dossier-42" }),
    ]);
    expect(w.dossiers).toEqual([DOSSIER]);
  });

  it("refuses an empty request: there is nothing to draw", () => {
    expect(() => waterfall([])).toThrow(RangeError);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 ms"],
    [312.4, "312 ms"],
    [999, "999 ms"],
    [1000, "1.00 s"],
    [2500, "2.50 s"],
    [59_994, "59.99 s"],
    [60_000, "1 m 00 s"],
    [125_400, "2 m 05 s"],
    [3_600_000, "1 h 00 m"],
    [5_430_000, "1 h 30 m"],
    [86_399_999, "23 h 59 m"],
    [86_400_000, "1 d 00 h"],
    [6_865_980_000, "79 d 11 h"],
  ])("%s ms reads %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it("refuses a negative or non-finite duration", () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(Number.NaN)).toThrow(RangeError);
  });
});

describe("axisTicks", () => {
  it("marks the start, quarters and the end of the span", () => {
    expect(axisTicks(2000)).toEqual([
      { pct: 0, label: "0 ms" },
      { pct: 25, label: "500 ms" },
      { pct: 50, label: "1.00 s" },
      { pct: 75, label: "1.50 s" },
      { pct: 100, label: "2.00 s" },
    ]);
  });

  it("a span of 0 has one tick", () => {
    expect(axisTicks(0)).toEqual([{ pct: 0, label: "0 ms" }]);
  });
});
