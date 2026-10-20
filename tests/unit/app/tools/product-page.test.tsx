import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { notFound, connection, budgetsLeft } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  connection: vi.fn(async () => {}),
  budgetsLeft: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection,
}));
vi.mock("@/platform/budget", async (orig) => ({
  ...(await orig<typeof import("@/platform/budget")>()),
  budgetsLeft: () => budgetsLeft(),
}));

import WorkbenchPage, { generateMetadata } from "@/app/tools/[product]/page";
import { WORKBENCH_ORDER, WORKBENCHES } from "@/features/tools/catalog";
import { PRODUCTS } from "@/platform/registry/products";
import { links, textOf } from "../../helpers/html";

/** `/tools/[product]` (spec 21 §5.1): one live workbench per product, rendered per request. */

const today = Object.fromEntries(
  ["debate", "upload", "leakscan", "scrape", "certify", "feathers.write"].map((k) => [k, { limit: 4, left: 2 }]),
);

async function render(product: string, search: Record<string, string> = {}): Promise<string> {
  const page = await WorkbenchPage({
    params: Promise.resolve({ product }),
    searchParams: Promise.resolve(search),
  });
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  vi.clearAllMocks();
  budgetsLeft.mockResolvedValue(today);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/tools/[product]", () => {
  it.each(WORKBENCH_ORDER)("renders the %s workbench with its name, tagline and §5 row", async (id) => {
    const html = await render(id);
    const product = PRODUCTS.find((p) => p.id === id);
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
    expect(textOf(h1)).toBe(id);
    const text = textOf(html);
    expect(text).toContain(product?.tagline);
    expect(text).toContain(WORKBENCHES[id].operate);
    expect(text).toContain(WORKBENCHES[id].receipt);
    expect(html).toContain("data-gate=");
  });

  it("waits for a request before it reads today's budgets", async () => {
    await render("magpie");
    expect(connection).toHaveBeenCalled();
    expect(budgetsLeft).toHaveBeenCalled();
  });

  it("still renders when the budgets cannot be read, saying so beside the action", async () => {
    budgetsLeft.mockRejectedValue(new Error("upstash down"));
    expect(textOf(await render("paper-trail"))).toMatch(/budget could not be read/);
  });

  it("is the tools page of the nav", async () => {
    const current = links(await render("inkprint")).filter((l) => l.tag.includes('aria-current="page"'));
    expect(current.map((l) => l.href)).toEqual(["/tools"]);
  });

  it("404s a product that does not exist, prototype keys included", async () => {
    await expect(render("nope")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(render("constructor")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("titles each workbench from its product alone", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ product: "slowquery" }) })).toEqual({
      title: "slowquery workbench",
    });
  });
});
