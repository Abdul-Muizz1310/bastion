import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

const mockNotFound = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    mockNotFound();
    throw new Error("NOT_FOUND");
  },
}));

const probe = vi.fn();
vi.mock("@/platform/registry/health", () => ({
  probe: (...args: unknown[]) => probe(...args),
}));

import ServiceDetailPage from "@/app/(app)/services/[id]/page";

const render = async (id: string) =>
  renderToString(await ServiceDetailPage({ params: Promise.resolve({ id }) }));

describe("ServiceDetailPage", () => {
  it("renders a product with its live health, repo, backend and frontend", async () => {
    probe.mockResolvedValueOnce({
      service: "paper-trail",
      state: "live",
      latencyMs: 150,
      version: "1.2.3",
      checkedAt: "2026-10-20T00:00:00.000Z",
    });
    const html = await render("paper-trail");
    expect(probe).toHaveBeenLastCalledWith("paper-trail", 8000);
    expect(html).toContain("paper-trail");
    expect(html).toContain("live");
    expect(html).toContain("150");
    expect(html).toContain("1.2.3");
    expect(html).toContain("github");
    expect(html).toContain("paper-trail-backend-jjpf.onrender.com");
    expect(html).toContain("paper-trail-frontend-sable.vercel.app");
  });

  it("renders an asleep service as asleep", async () => {
    probe.mockResolvedValueOnce({
      service: "inkprint",
      state: "asleep",
      latencyMs: 8000,
      checkedAt: "2026-10-20T00:00:00.000Z",
    });
    expect(await render("inkprint")).toContain("asleep");
  });

  it("renders a product without a hosted backend (bastion)", async () => {
    probe.mockClear();
    const html = await render("bastion");
    expect(html).toContain("no hosted backend");
    expect(probe).not.toHaveBeenCalled();
  });

  it("calls notFound for an unknown product", async () => {
    mockNotFound.mockClear();
    await expect(render("nonexistent")).rejects.toThrow("NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("calls notFound for a prototype key", async () => {
    await expect(render("constructor")).rejects.toThrow("NOT_FOUND");
  });

  it("renders without health data when probing fails", async () => {
    probe.mockRejectedValueOnce(new Error("network error"));
    const html = await render("magpie");
    expect(html).toContain("magpie");
    expect(html).toContain("failed to fetch health");
  });
});
