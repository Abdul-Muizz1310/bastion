import { afterEach, describe, expect, it, vi } from "vitest";

describe("SERVICES env override", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses a valid https override", async () => {
    vi.stubEnv("MAGPIE_BACKEND_URL", "https://magpie.example.test");
    vi.resetModules();
    const { SERVICES } = await import("@/platform/registry/products");
    expect(SERVICES.magpie.baseUrl).toBe("https://magpie.example.test");
  });

  it("rejects a non-https override", async () => {
    vi.stubEnv("MAGPIE_BACKEND_URL", "http://insecure.example.test");
    vi.resetModules();
    await expect(import("@/platform/registry/products")).rejects.toThrow();
  });
});
