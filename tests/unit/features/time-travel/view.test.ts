import { describe, expect, it } from "vitest";
import { toTimeTravelView } from "@/features/time-travel/to-view";
import { typeCounts } from "@/features/time-travel/view";
import type { TimeTravelEntity, TimeTravelResult } from "@/lib/audit/replay";

/**
 * Spec 07 + spec 21 §3.2 — the mapper that turns the replay's result (Dates, metadata) into the
 * serialisable view the slider receives: known fields only, never the metadata itself.
 */

const ASOF = new Date("2026-01-06T00:00:00.000Z");
const BOUNDS = {
  min: new Date("2026-01-01T00:00:00.000Z"),
  max: new Date("2026-01-11T00:00:00.000Z"),
};
const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";

function entity(overrides: Partial<TimeTravelEntity> = {}): TimeTravelEntity {
  return {
    entityType: "dossier",
    entityId: DOSSIER,
    service: "bastion",
    lastAction: "dossier.stage.ok",
    lastEventAt: new Date("2026-01-05T10:00:00.000Z"),
    requestId: "req-1",
    actor: "bastion",
    actorId: null,
    metadata: { stage: "seal", attempt: 1 },
    ...overrides,
  };
}

describe("toTimeTravelView", () => {
  it("serialises the moment, the bounds and each entity's known fields", () => {
    const result: TimeTravelResult = { entities: [entity()], bounds: BOUNDS, truncated: false };
    expect(toTimeTravelView(result, ASOF)).toEqual({
      asOf: "2026-01-06T00:00:00.000Z",
      bounds: { min: "2026-01-01T00:00:00.000Z", max: "2026-01-11T00:00:00.000Z" },
      entities: [
        {
          entityType: "dossier",
          entityId: DOSSIER,
          href: `/d/${DOSSIER}`,
          service: "bastion",
          lastAction: "dossier.stage.ok",
          lastEventAt: "2026-01-05T10:00:00.000Z",
          requestId: "req-1",
          actor: { kind: "system", label: "bastion" },
          facts: { status: null, ms: null, stage: "seal", attempt: 1, error: null },
        },
      ],
      message: null,
      truncated: false,
    });
  });

  it("never sends the metadata, nor a v1 user's uuid, to the browser (invariant 6)", () => {
    const result: TimeTravelResult = {
      entities: [
        entity({
          entityType: "user",
          entityId: "user-1",
          actor: null,
          actorId: DOSSIER,
          metadata: { requiredRoles: ["admin"], body: "SECRET" },
        }),
      ],
      bounds: BOUNDS,
      truncated: false,
    };
    const view = toTimeTravelView(result, ASOF);
    expect(JSON.stringify(view)).not.toMatch(/SECRET|requiredRoles|550e8400/);
    expect(view.entities[0]?.actor).toEqual({ kind: "v1-user", label: "v1 user" });
    expect(view.entities[0]?.href).toBeNull();
  });

  it("case 9: a null lower bound survives the mapping (empty database)", () => {
    const view = toTimeTravelView(
      {
        entities: [],
        bounds: { min: null, max: BOUNDS.max },
        message: "No audit data yet.",
        truncated: false,
      },
      ASOF,
    );
    expect(view.bounds.min).toBeNull();
    expect(view.message).toBe("No audit data yet.");
  });

  it("carries the cut", () => {
    expect(toTimeTravelView({ entities: [], bounds: BOUNDS, truncated: true }, ASOF).truncated).toBe(
      true,
    );
  });

  it("normalises a missing message to null", () => {
    expect(toTimeTravelView({ entities: [], bounds: BOUNDS, truncated: false }, ASOF).message).toBeNull();
  });

  it("survives JSON unchanged — it crosses the Server Action boundary", () => {
    const view = toTimeTravelView({ entities: [entity()], bounds: BOUNDS, truncated: false }, ASOF);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe("typeCounts", () => {
  it("counts each type, the most frequent first, then by name", () => {
    const view = toTimeTravelView(
      {
        entities: [
          entity({ entityType: "capability", entityId: "a" }),
          entity({ entityType: "dossier", entityId: "b" }),
          entity({ entityType: "capability", entityId: "c" }),
          entity({ entityType: "user", entityId: "d" }),
          entity({ entityType: "certificate", entityId: "e" }),
        ],
        bounds: BOUNDS,
        truncated: false,
      },
      ASOF,
    );
    expect(typeCounts(view.entities)).toEqual([
      { type: "capability", count: 2 },
      { type: "certificate", count: 1 },
      { type: "dossier", count: 1 },
      { type: "user", count: 1 },
    ]);
  });

  it("is empty for no entities", () => {
    expect(typeCounts([])).toEqual([]);
  });
});
