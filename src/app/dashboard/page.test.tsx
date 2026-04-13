import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock registry
vi.mock("@/lib/registry", () => ({
  getAggregatedStatus: vi.fn().mockResolvedValue([
    { id: "paper-trail", healthy: true, latencyMs: 120, version: "1.0.0" },
    { id: "inkprint", healthy: false, latencyMs: 5000, error: "timeout" },
  ]),
}));

import DashboardPage from "./page";

describe("DashboardPage", () => {
  it("renders service registry with health data", async () => {
    const jsx = await DashboardPage();
    const html = renderToString(jsx);
    expect(html).toContain("Platform");
    expect(html).toContain("Services");
    expect(html).toContain("Paper Trail");
    expect(html).toContain("120ms");
    expect(html).toContain("1.0.0");
    expect(html).toContain("timeout");
  });

  it("renders services without health data when fetch fails", async () => {
    const { getAggregatedStatus } = await import("@/lib/registry");
    (getAggregatedStatus as any).mockRejectedValueOnce(new Error("fail"));
    const jsx = await DashboardPage();
    const html = renderToString(jsx);
    expect(html).toContain("Platform");
    expect(html).toContain("Feathers");
    expect(html).toContain("CLI");
  });
});
