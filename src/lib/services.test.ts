import { describe, expect, it } from "vitest";
import { checkServiceHealth, getAggregatedStatus } from "./registry";
import { SERVICES } from "./services";

describe("08-registry: service manifest", () => {
  // Case 1: dashboard renders 5 cards
  it("contains exactly 5 services", () => {
    expect(SERVICES).toHaveLength(5);
  });

  it("each service has a unique id", () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Case 6: feathers shows CLI badge
  it("feathers has no backend URL (CLI-only)", () => {
    const feathers = SERVICES.find((s) => s.id === "feathers");
    expect(feathers).toBeDefined();
    expect(feathers?.backendUrl).toBe("");
  });

  it("non-CLI services have health paths", () => {
    const hosted = SERVICES.filter((s) => s.id !== "feathers");
    for (const s of hosted) {
      expect(s.healthPath).toBe("/health");
      expect(s.backendUrl).toBeTruthy();
    }
  });
});

describe("08-registry: health checks", () => {
  // Case 2: each card shows health indicator
  it("checkServiceHealth returns healthy status for reachable service", async () => {
    const result = await checkServiceHealth("paper-trail");
    expect(result).toBeDefined();
    expect(typeof result.healthy).toBe("boolean");
    expect(typeof result.latencyMs).toBe("number");
  });

  // Case 3: /api/status returns all 5 statuses
  it("getAggregatedStatus returns status for all 5 services", async () => {
    const statuses = await getAggregatedStatus();
    expect(statuses).toHaveLength(5);
    for (const s of statuses) {
      expect(s.id).toBeDefined();
      expect(typeof s.healthy).toBe("boolean");
    }
  });

  // Case 4: parallel fetch under 2s
  it("getAggregatedStatus completes in under 2 seconds", async () => {
    const start = Date.now();
    await getAggregatedStatus();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  // Case 5: service detail page (placeholder)
  it("service detail includes repo link, backend URL, frontend URL", () => {
    const pt = SERVICES.find((s) => s.id === "paper-trail");
    expect(pt?.repoUrl).toContain("github.com");
    expect(pt?.backendUrl).toContain("onrender.com");
    expect(pt?.frontendUrl).toContain("vercel.app");
  });

  // Case 7: ISR 60s cache (structural, not testable in unit)
  it("/api/status uses ISR with 60s revalidation", () => {
    expect(true).toBe(false); // placeholder — structural, tested in integration
  });
});

describe("08-registry: edge and failure cases", () => {
  // Case 8: unhealthy service doesn't crash dashboard
  it("unhealthy service returns status without crashing", async () => {
    // Would need to mock a failing service
    expect(true).toBe(false); // placeholder — needs HTTP mock
  });

  // Case 9: service timeout shows timeout status
  it("service timeout returns timeout status", async () => {
    expect(true).toBe(false); // placeholder — needs HTTP mock with delay
  });

  // Case 10: unknown service ID returns 404
  it("checkServiceHealth throws for unknown service", async () => {
    await expect(checkServiceHealth("nonexistent")).rejects.toThrow();
  });

  // Case 11: all services down still renders
  it("all services unhealthy still returns valid status array", async () => {
    expect(true).toBe(false); // placeholder — needs all services mocked as down
  });

  // Case 12: /api/status returns 200 even when all down
  it("getAggregatedStatus returns 200 with all marked unhealthy", async () => {
    expect(true).toBe(false); // placeholder — needs mock
  });
});

describe("08-registry: security", () => {
  // Case 13: dashboard requires auth
  it("/dashboard requires authentication", () => {
    expect(true).toBe(false); // placeholder — tested in RBAC/middleware
  });

  // Case 14: /api/status is public
  it("/api/status and /api/health are public", () => {
    expect(true).toBe(false); // placeholder — tested in middleware config
  });
});
