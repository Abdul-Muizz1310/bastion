import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 07 — the Server Action the slider calls. It is the ONLY path from the
 * client to `getTimeTravelState`, so the admin gate and the read-only contract
 * are asserted here (cases 11 and 12).
 */

const mockRequireRole = vi.fn();
class MockAccessDeniedError extends Error {}
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
  AccessDeniedError: MockAccessDeniedError,
}));

const mockGetTimeTravelState = vi.fn();
vi.mock("@/lib/audit/replay", () => ({
  getTimeTravelState: (...args: unknown[]) => mockGetTimeTravelState(...args),
}));

const MIN = new Date("2026-01-01T00:00:00.000Z");
const MAX = new Date("2026-01-11T00:00:00.000Z");

function primeState(overrides: Record<string, unknown> = {}) {
  mockGetTimeTravelState.mockResolvedValue({
    entities: [
      {
        entityType: "user",
        entityId: "user-1",
        service: "bastion",
        state: { role: "editor" },
        lastAction: "user.role_changed",
        lastEventAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ],
    bounds: { min: MIN, max: MAX },
    ...overrides,
  });
}

describe("07-replay server action: loadTimeTravelState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      sid: "sess-1",
      user: { id: "admin-1", email: "a@x.com", role: "admin", name: null },
    });
    primeState();
  });

  it("case 11: gates on the admin role before touching the database", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    await loadTimeTravelState("2026-01-06T00:00:00.000Z");
    expect(mockRequireRole).toHaveBeenCalledWith(["admin"], "time-travel.query");
  });

  it("case 11b: a denied role stops the query — getTimeTravelState is never called", async () => {
    mockRequireRole.mockRejectedValueOnce(new MockAccessDeniedError("denied"));
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    await expect(loadTimeTravelState("2026-01-06T00:00:00.000Z")).rejects.toBeInstanceOf(
      MockAccessDeniedError,
    );
    expect(mockGetTimeTravelState).not.toHaveBeenCalled();
  });

  it("case 1: forwards the requested timestamp to the DISTINCT ON query", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    await loadTimeTravelState("2026-01-06T00:00:00.000Z");
    expect(mockGetTimeTravelState).toHaveBeenCalledWith({
      asOf: new Date("2026-01-06T00:00:00.000Z"),
      service: undefined,
    });
  });

  it("case 5: forwards the optional service filter", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    await loadTimeTravelState("2026-01-06T00:00:00.000Z", "slowquery");
    expect(mockGetTimeTravelState).toHaveBeenCalledWith({
      asOf: new Date("2026-01-06T00:00:00.000Z"),
      service: "slowquery",
    });
  });

  it("returns a serialisable view — no Date instances cross the boundary", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    const res = await loadTimeTravelState("2026-01-06T00:00:00.000Z");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.view.asOf).toBe("2026-01-06T00:00:00.000Z");
    expect(res.view.bounds).toEqual({
      min: MIN.toISOString(),
      max: MAX.toISOString(),
    });
    expect(res.view.entities[0].lastEventAt).toBe("2026-01-05T00:00:00.000Z");
    expect(JSON.parse(JSON.stringify(res.view))).toEqual(res.view);
  });

  it("case 7: propagates the 'no events before this time' message", async () => {
    primeState({ entities: [], message: "No events before this time" });
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    const res = await loadTimeTravelState("2025-12-01T00:00:00.000Z");
    if (!res.ok) throw new Error("expected ok");
    expect(res.view.entities).toHaveLength(0);
    expect(res.view.message).toBe("No events before this time");
  });

  it("rejects a non-ISO timestamp without querying the database", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    const res = await loadTimeTravelState("last tuesday");
    expect(res).toEqual({ ok: false, error: "invalid_timestamp" });
    expect(mockGetTimeTravelState).not.toHaveBeenCalled();
  });

  it("rejects an empty timestamp without querying the database", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    const res = await loadTimeTravelState("");
    expect(res).toEqual({ ok: false, error: "invalid_timestamp" });
    expect(mockGetTimeTravelState).not.toHaveBeenCalled();
  });

  it("rejects an oversized service filter rather than passing it to SQL", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    const res = await loadTimeTravelState("2026-01-06T00:00:00.000Z", "x".repeat(200));
    expect(res).toEqual({ ok: false, error: "invalid_service" });
    expect(mockGetTimeTravelState).not.toHaveBeenCalled();
  });

  it("case 12: the action forwards nothing but read options — no writeable field reaches replay", async () => {
    const { loadTimeTravelState } = await import("@/features/time-travel/server/query");
    await loadTimeTravelState("2026-01-06T00:00:00.000Z", "bastion");
    const [options] = mockGetTimeTravelState.mock.calls[0];
    expect(Object.keys(options).sort()).toEqual(["asOf", "service"]);
  });
});
