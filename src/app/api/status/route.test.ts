import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/registry", () => ({
  getAggregatedStatus: vi
    .fn()
    .mockResolvedValue([{ id: "paper-trail", healthy: true, latencyMs: 100 }]),
}));

import { GET } from "./route";

describe("GET /api/status", () => {
  it("returns services array and timestamp", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.services).toEqual([{ id: "paper-trail", healthy: true, latencyMs: 100 }]);
    expect(body.timestamp).toBeDefined();
  });
});
