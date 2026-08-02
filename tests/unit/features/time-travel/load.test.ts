import { describe, expect, it, vi } from "vitest";
import { createLoader } from "@/features/time-travel/load";
import type { TimeTravelQueryResult, TimeTravelView } from "@/features/time-travel/view";

const VIEW: TimeTravelView = {
  asOf: "2026-01-06T00:00:00.000Z",
  bounds: { min: "2026-01-01T00:00:00.000Z", max: "2026-01-11T00:00:00.000Z" },
  entities: [],
  message: null,
};

function action(result: TimeTravelQueryResult) {
  return vi.fn(async () => result);
}

describe("07-replay loader: Server Action result -> scheduler contract", () => {
  it("unwraps a successful result", async () => {
    const load = createLoader(action({ ok: true, view: VIEW }));
    await expect(load("2026-01-06T00:00:00.000Z")).resolves.toEqual(VIEW);
  });

  it("passes the requested timestamp straight through to the action", async () => {
    const spy = action({ ok: true, view: VIEW });
    await createLoader(spy)("2026-01-06T00:00:00.000Z");
    expect(spy).toHaveBeenCalledWith("2026-01-06T00:00:00.000Z");
  });

  it("turns an invalid_timestamp rejection into a readable error", async () => {
    const load = createLoader(action({ ok: false, error: "invalid_timestamp" }));
    await expect(load("nope")).rejects.toThrow(/timestamp/i);
  });

  it("turns an invalid_service rejection into a readable error", async () => {
    const load = createLoader(action({ ok: false, error: "invalid_service" }));
    await expect(load("2026-01-06T00:00:00.000Z")).rejects.toThrow(/service filter/i);
  });

  it("falls back to a generic message for an error code it does not know", async () => {
    const load = createLoader(
      action({ ok: false, error: "something_new" } as unknown as TimeTravelQueryResult),
    );
    await expect(load("2026-01-06T00:00:00.000Z")).rejects.toThrow("Time-travel query failed");
  });
});
