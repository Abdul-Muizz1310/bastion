import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("registry: checkServiceHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns healthy:true for CLI service (feathers)", async () => {
    const { checkServiceHealth } = await import("./registry");
    const result = await checkServiceHealth("feathers");
    expect(result.id).toBe("feathers");
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBe(0);
    expect(result.version).toBe("CLI");
  });

  it("throws for unknown service", async () => {
    const { checkServiceHealth } = await import("./registry");
    await expect(checkServiceHealth("nonexistent")).rejects.toThrow("Unknown service");
  });

  it("returns healthy:true when fetch succeeds with ok status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ version: "2.0.0" }),
    });
    const { checkServiceHealth } = await import("./registry");
    const result = await checkServiceHealth("paper-trail");
    expect(result.healthy).toBe(true);
    expect(result.version).toBe("2.0.0");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns healthy:false when fetch succeeds with non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });
    const { checkServiceHealth } = await import("./registry");
    const result = await checkServiceHealth("inkprint");
    expect(result.healthy).toBe(false);
  });

  it("handles non-JSON response body gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => {
        throw new Error("not json");
      },
    });
    const { checkServiceHealth } = await import("./registry");
    const result = await checkServiceHealth("magpie");
    expect(result.healthy).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it("returns healthy:false with timeout error when fetch is aborted", async () => {
    mockFetch.mockRejectedValueOnce(new Error("The operation was aborted"));
    const { checkServiceHealth } = await import("./registry");
    const result = await checkServiceHealth("slowquery");
    expect(result.healthy).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("returns healthy:false with error message on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { checkServiceHealth } = await import("./registry");
    const result = await checkServiceHealth("paper-trail");
    expect(result.healthy).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("returns version from commit field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ commit: "abc123" }),
    });
    const { checkServiceHealth } = await import("./registry");
    const result = await checkServiceHealth("paper-trail");
    expect(result.version).toBe("abc123");
  });
});

describe("registry: getAggregatedStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns health for all services", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.0" }),
    });
    const { getAggregatedStatus } = await import("./registry");
    const results = await getAggregatedStatus();
    // 5 services total - feathers is CLI, 4 have backends
    expect(results.length).toBe(5);
    const feathers = results.find((r) => r.id === "feathers");
    expect(feathers?.healthy).toBe(true);
    expect(feathers?.version).toBe("CLI");
  });
});
