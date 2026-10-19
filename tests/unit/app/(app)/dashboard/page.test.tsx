import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTS } from "@/platform/registry/products";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

const probe = vi.fn();
vi.mock("@/platform/registry/health", () => ({
  probe: (...args: unknown[]) => probe(...args),
}));

import DashboardPage from "@/app/(app)/dashboard/page";

const health = (service: string, state: string, extra: Record<string, unknown> = {}) => ({
  service,
  state,
  latencyMs: 120,
  checkedAt: "2026-10-20T00:00:00.000Z",
  ...extra,
});

beforeEach(() => {
  probe.mockReset();
  probe.mockImplementation(async (service: string) =>
    service === "inkprint"
      ? health(service, "asleep", { latencyMs: 8000 })
      : health(service, "live", { version: "1.0.0" }),
  );
});

describe("DashboardPage", () => {
  it("lists every product from the v2 registry", async () => {
    const html = renderToString(await DashboardPage());
    expect(html).toContain("Platform");
    for (const product of PRODUCTS) {
      expect(html).toContain(product.name);
      expect(html).toContain(`/services/${product.id}`);
    }
  });

  it("shows live latency and version, and asleep as asleep", async () => {
    const html = renderToString(await DashboardPage());
    expect(html).toContain("120ms");
    expect(html).toContain("1.0.0");
    expect(html).toContain("asleep");
  });

  it("probes each service once with the 8 s budget", async () => {
    await DashboardPage();
    const services = probe.mock.calls.map((c) => c[0]);
    expect(new Set(services).size).toBe(services.length);
    for (const call of probe.mock.calls) expect(call[1]).toBe(8000);
  });

  it("renders without health data when probing fails", async () => {
    probe.mockRejectedValue(new Error("fail"));
    const html = renderToString(await DashboardPage());
    expect(html).toContain("Platform");
    expect(html).toContain("feathers");
  });

  it("marks bastion as having no hosted backend", async () => {
    const html = renderToString(await DashboardPage());
    expect(html).toContain("no hosted backend");
  });
});
