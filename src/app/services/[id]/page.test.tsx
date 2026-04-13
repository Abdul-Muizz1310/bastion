import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock next/navigation
const mockNotFound = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    mockNotFound();
    throw new Error("NOT_FOUND");
  },
}));

// Mock registry
const mockCheckServiceHealth = vi.fn();
vi.mock("@/lib/registry", () => ({
  checkServiceHealth: (...args: unknown[]) => mockCheckServiceHealth(...args),
}));

import ServiceDetailPage from "./page";

describe("ServiceDetailPage", () => {
  it("renders a known service with health data", async () => {
    mockCheckServiceHealth.mockResolvedValueOnce({
      id: "paper-trail",
      healthy: true,
      latencyMs: 150,
      version: "1.2.3",
    });
    const jsx = await ServiceDetailPage({ params: Promise.resolve({ id: "paper-trail" }) });
    const html = renderToString(jsx);
    expect(html).toContain("Paper Trail");
    expect(html).toContain("healthy");
    expect(html).toContain("150");
    expect(html).toContain("1.2.3");
    expect(html).toContain("github");
  });

  it("renders a CLI service (feathers)", async () => {
    const jsx = await ServiceDetailPage({ params: Promise.resolve({ id: "feathers" }) });
    const html = renderToString(jsx);
    expect(html).toContain("Feathers");
    expect(html).toContain("CLI tool");
  });

  it("renders unhealthy service", async () => {
    mockCheckServiceHealth.mockResolvedValueOnce({
      id: "inkprint",
      healthy: false,
      latencyMs: 5000,
      error: "timeout",
    });
    const jsx = await ServiceDetailPage({ params: Promise.resolve({ id: "inkprint" }) });
    const html = renderToString(jsx);
    expect(html).toContain("unhealthy");
  });

  it("calls notFound for unknown service", async () => {
    mockNotFound.mockClear();
    await expect(
      ServiceDetailPage({ params: Promise.resolve({ id: "nonexistent" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("renders without health data when fetch fails", async () => {
    mockCheckServiceHealth.mockRejectedValueOnce(new Error("network error"));
    const jsx = await ServiceDetailPage({ params: Promise.resolve({ id: "paper-trail" }) });
    const html = renderToString(jsx);
    expect(html).toContain("Paper Trail");
    expect(html).toContain("failed to fetch health");
  });
});
