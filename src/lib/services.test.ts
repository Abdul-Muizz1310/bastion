import { describe, expect, it } from "vitest";
import { SERVICES } from "./services";

describe("service registry", () => {
  it("contains exactly 5 services", () => {
    expect(SERVICES).toHaveLength(5);
  });

  it("each service has a unique id", () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("feathers has no backend URL", () => {
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
