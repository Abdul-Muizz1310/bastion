import { describe, expect, it } from "vitest";
import { SERVICES } from "./services";

describe("08-registry: service manifest", () => {
  it("contains exactly 5 services", () => {
    expect(SERVICES).toHaveLength(5);
  });

  it("each service has a unique id", () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

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

  it("service detail includes repo link, backend URL, frontend URL", () => {
    const pt = SERVICES.find((s) => s.id === "paper-trail");
    expect(pt?.repoUrl).toContain("github.com");
    expect(pt?.backendUrl).toContain("onrender.com");
    expect(pt?.frontendUrl).toContain("vercel.app");
  });

  it("all services have required fields", () => {
    for (const s of SERVICES) {
      expect(s.id).toBeTruthy();
      expect(s.name).toBeTruthy();
      expect(s.role).toBeTruthy();
      expect(s.repoUrl).toBeTruthy();
      expect(s.tags.length).toBeGreaterThan(0);
    }
  });
});

describe("08-registry: health checks", () => {
  it.todo("checkServiceHealth returns healthy status for reachable service (integration)");
  it.todo("getAggregatedStatus returns status for all 5 services (integration)");
  it.todo("getAggregatedStatus completes in under 2 seconds (integration)");
  it.todo("/api/status uses ISR with 60s revalidation (structural)");
});

describe("08-registry: edge and failure cases", () => {
  it.todo("unhealthy service returns status without crashing (integration)");
  it.todo("service timeout returns timeout status (integration)");

  it("unknown service ID throws", async () => {
    const { checkServiceHealth } = await import("./registry");
    await expect(checkServiceHealth("nonexistent")).rejects.toThrow("Unknown service");
  });

  it.todo("all services unhealthy still returns valid status array (integration)");
  it.todo("getAggregatedStatus returns 200 with all marked unhealthy (integration)");
});

describe("08-registry: security", () => {
  it.todo("/dashboard requires authentication (tested in middleware)");
  it.todo("/api/status and /api/health are public (tested in middleware)");
});
