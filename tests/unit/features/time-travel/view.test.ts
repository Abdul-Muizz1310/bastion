import { describe, expect, it } from "vitest";
import { toTimeTravelView } from "@/features/time-travel/view";
import type { TimeTravelResult } from "@/lib/audit/replay";

/**
 * Spec 07 — the mapper that turns the DB-facing `TimeTravelResult` (Date
 * objects) into the serialisable view the client component receives across the
 * server/client boundary.
 */

const ASOF = new Date("2026-01-06T00:00:00.000Z");

describe("07-replay view mapper", () => {
  it("case 6: keeps each entity's most recent `after` state and serialises timestamps", () => {
    const result: TimeTravelResult = {
      entities: [
        {
          entityType: "user",
          entityId: "user-1",
          service: "bastion",
          state: { role: "admin" },
          lastAction: "user.promoted",
          lastEventAt: new Date("2026-01-05T10:00:00.000Z"),
        },
      ],
      bounds: { min: new Date("2026-01-01T00:00:00.000Z"), max: new Date("2026-01-11T00:00:00.000Z") },
    };

    const mapped = toTimeTravelView(result, ASOF);
    expect(mapped).toEqual({
      asOf: "2026-01-06T00:00:00.000Z",
      bounds: { min: "2026-01-01T00:00:00.000Z", max: "2026-01-11T00:00:00.000Z" },
      entities: [
        {
          entityType: "user",
          entityId: "user-1",
          service: "bastion",
          state: { role: "admin" },
          lastAction: "user.promoted",
          lastEventAt: "2026-01-05T10:00:00.000Z",
        },
      ],
      message: null,
    });
  });

  it("case 9: a null lower bound survives the mapping (empty database)", () => {
    const result: TimeTravelResult = {
      entities: [],
      bounds: { min: null, max: new Date("2026-01-11T00:00:00.000Z") },
      message: "No audit data yet.",
    };

    const mapped = toTimeTravelView(result, ASOF);
    expect(mapped.bounds.min).toBeNull();
    expect(mapped.entities).toEqual([]);
    expect(mapped.message).toBe("No audit data yet.");
  });

  it("case 7: the 'no events before this time' message is carried through", () => {
    const result: TimeTravelResult = {
      entities: [],
      bounds: { min: new Date("2026-01-01T00:00:00.000Z"), max: new Date("2026-01-11T00:00:00.000Z") },
      message: "No events before this time",
    };
    expect(toTimeTravelView(result, ASOF).message).toBe("No events before this time");
  });

  it("normalises a missing message to null rather than leaving it undefined", () => {
    const result: TimeTravelResult = {
      entities: [],
      bounds: { min: null, max: new Date("2026-01-11T00:00:00.000Z") },
    };
    expect(toTimeTravelView(result, ASOF).message).toBeNull();
  });
});
