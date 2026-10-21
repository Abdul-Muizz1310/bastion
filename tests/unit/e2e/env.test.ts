import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLocalDatabase,
  SERVICE_IDS,
  serviceUrls,
  STUB_ORIGIN,
  TENANTS,
} from "../../e2e/fixtures/env";

/**
 * Spec 21 §10.1: the e2e run points every downstream service at the local stub. A service the
 * registry gains but the e2e list lacks would keep its production default during the run — so the
 * list is pinned to the registry, and the URLs are checked the way the app reads them.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("e2e env: every service goes to the stub", () => {
  it("lists exactly the registry's services", async () => {
    const { SERVICES } = await import("@/platform/registry/products");
    expect([...SERVICE_IDS].sort()).toEqual(Object.keys(SERVICES).sort());
  });

  it.each(TENANTS)("points each service of tenant %s at the stub, as the registry reads it", async (tenant) => {
    for (const [name, url] of Object.entries(serviceUrls(tenant))) vi.stubEnv(name, url);
    vi.resetModules();
    const { SERVICES } = await import("@/platform/registry/products");
    for (const id of SERVICE_IDS) {
      expect(SERVICES[id].baseUrl).toBe(`${STUB_ORIGIN}/${tenant}/${id}`);
    }
  });
});

describe("e2e env: the run writes only to a local database", () => {
  it.each([
    "postgresql://postgres:pg@localhost:5433/bastion_e2e",
    "postgres://bastion:bastion@127.0.0.1:5432/bastion",
    "postgresql://u:p@[::1]:5432/db",
  ])("accepts %s", (url) => {
    expect(isLocalDatabase(url)).toBe(true);
  });

  it.each([
    "postgresql://u:p@ep-cool-1.eu-central-1.aws.neon.tech/db?sslmode=require",
    "postgresql://u:p@localhost.example.com/db",
    "mysql://u:p@localhost/db",
    "",
    "not a url",
  ])("refuses %s", (url) => {
    expect(isLocalDatabase(url)).toBe(false);
  });
});
