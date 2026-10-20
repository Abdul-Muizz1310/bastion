import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

// The page must wait for a request before it reads the database.
const mockConnection = vi.fn().mockResolvedValue(undefined);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => mockConnection(),
}));

const mockList = vi.fn();
vi.mock("@/dossier/gallery", () => ({
  listPublicDossiers: (...args: unknown[]) => mockList(...args),
}));

const mockBudgets = vi.fn();
vi.mock("@/platform/budget", () => ({
  budgetsLeft: (...args: unknown[]) => mockBudgets(...args),
}));

import type { PublicDossier } from "@/dossier/gallery";
import { PRODUCTS } from "@/platform/registry/products";
import { links, sliceByAttr, textOf } from "../helpers/html";

/** Spec 21 §3.1: spine, live map, three entry points, gallery — public, per request. */

function dossier(i: number, overrides: Partial<PublicDossier> = {}): PublicDossier {
  return {
    id: `0f8a1c2e-4b6d-4e8f-9a0b-${String(i).padStart(12, "0")}`,
    claim: `claim ${i}`,
    mode: "rapid",
    status: "succeeded",
    verdict: "TRUE",
    confidence: 0.91,
    createdAt: "2026-10-20T10:00:00.000Z",
    evidenceCount: 12,
    documentCount: 1,
    products: ["inkthread", "magpie"],
    ...overrides,
  };
}

async function renderHome(): Promise<string> {
  const { default: Home } = await import("@/app/page");
  return renderToStaticMarkup(await Home());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockList.mockResolvedValue([]);
  mockBudgets.mockResolvedValue({ debate: { limit: 4, left: 3 } });
});

describe("Home page (spec 21 §3.1)", () => {
  it("leads with the brand spine as its one h1", async () => {
    const html = await renderHome();
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => textOf(m[1] ?? ""));
    expect(h1s).toEqual(["tools that hand you a receipt."]);
  });

  it("is the map page of the nav", async () => {
    const html = await renderHome();
    const current = links(html).filter((l) => l.tag.includes('aria-current="page"'));
    expect(current.map((l) => l.href)).toEqual(["/"]);
  });

  it("draws the system map with the 8 products linking to their workbenches", async () => {
    const html = await renderHome();
    const wide = sliceByAttr(html, "data-layout", "wide");
    expect(
      links(wide)
        .map((l) => l.href)
        .sort(),
    ).toEqual(PRODUCTS.map((p) => `/tools/${p.id}`).sort());
  });

  it("offers the three entry points: run a dossier, open a workbench, read the audit log", async () => {
    const html = await renderHome();
    const entries = sliceByAttr(html, "data-section", "entry-points");
    // The title is the link (its box stretched over the card), so each name stays short.
    expect(links(entries).map((l) => [l.href, l.name])).toEqual([
      ["/dossier", "run a dossier"],
      ["/tools", "open a workbench"],
      ["/audit", "read the audit log"],
    ]);
  });

  it("shows today's remaining debates on the dossier entry", async () => {
    const html = await renderHome();
    const entries = sliceByAttr(html, "data-section", "entry-points");
    expect(entries).toContain('role="meter"');
    expect(textOf(entries)).toContain("3 of 4");
  });

  it("omits the budget meter when the budget store does not answer", async () => {
    mockBudgets.mockRejectedValue(new Error("upstash down"));
    const html = await renderHome();
    expect(html).not.toContain('role="meter"');
    expect(sliceByAttr(html, "data-section", "entry-points")).toContain('href="/dossier"');
  });

  it("prints the 6 most recent succeeded dossiers as receipts", async () => {
    mockList.mockResolvedValue([
      dossier(1, { status: "running", verdict: null }),
      ...Array.from({ length: 7 }, (_, i) => dossier(i + 2)),
    ]);
    const html = await renderHome();
    expect(mockList).toHaveBeenCalledWith(12);
    const gallery = sliceByAttr(html, "data-section", "gallery");
    const hrefs = links(gallery).map((l) => l.href);
    expect(hrefs).toHaveLength(6);
    expect(hrefs[0]).toBe("/d/0f8a1c2e-4b6d-4e8f-9a0b-000000000002");
    expect(textOf(gallery)).toContain("12 items");
    expect(textOf(gallery)).toContain("inkthread · magpie");
    expect(textOf(gallery)).toContain("true · 91% confidence");
  });

  it("shows the empty state when no dossier has finished", async () => {
    const html = await renderHome();
    expect(textOf(sliceByAttr(html, "data-section", "gallery"))).toContain(
      "no finished dossiers yet",
    );
  });

  it("still renders when the database is down, with the gallery marked unavailable", async () => {
    mockList.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const html = await renderHome();
    expect(textOf(sliceByAttr(html, "data-section", "gallery"))).toContain(
      "gallery is unavailable",
    );
    expect(html).toContain('data-layout="wide"');
  });

  it("is rendered per request, never prerendered at build: connection() precedes the query", async () => {
    await renderHome();
    expect(mockConnection).toHaveBeenCalledTimes(1);
    expect(mockConnection.mock.invocationCallOrder[0]).toBeLessThan(
      mockList.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("lists what each product hands back", async () => {
    const text = textOf(await renderHome());
    for (const p of PRODUCTS) expect(text).toContain(p.receipt);
  });

  it("shows no sign-in surface: no role, no email, no login link, no v1 console", async () => {
    const html = await renderHome();
    const text = textOf(html);
    expect(html).not.toContain('href="/login"');
    expect(text).not.toMatch(/\b(log ?in|sign ?in|role ·|read-only|dossier console)\b/i);
  });
});
