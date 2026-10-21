import type { Metadata } from "next";
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import UnknownWorkbench, { generateMetadata } from "@/app/tools/[product]/page";
import * as bastionPage from "@/app/tools/bastion/page";
import * as feathersPage from "@/app/tools/feathers/page";
import * as inkgridPage from "@/app/tools/inkgrid/page";
import * as inkprintPage from "@/app/tools/inkprint/page";
import * as inkthreadPage from "@/app/tools/inkthread/page";
import * as magpiePage from "@/app/tools/magpie/page";
import * as paperTrailPage from "@/app/tools/paper-trail/page";
import * as slowqueryPage from "@/app/tools/slowquery/page";
import { WORKBENCH_ORDER, WORKBENCHES } from "@/features/tools/catalog";
import { PRODUCTS } from "@/platform/registry/products";
import { links, textOf } from "../../helpers/html";

/**
 * `/tools/<product>` (spec 21 §5.1): one live workbench per product, rendered per request. Each is
 * its own route module importing only its own workbench, so a page ships one workbench's code
 * (Ruling AH); `/tools/[product]` answers every other id with a 404.
 */

type PageModule = {
  default: (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
  metadata: Metadata;
};

const PAGES: Record<string, PageModule> = {
  magpie: magpiePage,
  inkgrid: inkgridPage,
  inkthread: inkthreadPage,
  inkprint: inkprintPage,
  "paper-trail": paperTrailPage,
  slowquery: slowqueryPage,
  feathers: feathersPage,
  bastion: bastionPage,
};

const WORKBENCH_MODULE: Record<string, string> = {
  magpie: "magpie/MagpieWorkbench",
  inkgrid: "inkgrid/InkgridWorkbench",
  inkthread: "inkthread/InkthreadWorkbench",
  inkprint: "inkprint/InkprintWorkbench",
  "paper-trail": "paper-trail/PaperTrailWorkbench",
  slowquery: "slowquery/SlowqueryWorkbench",
  feathers: "feathers/FeathersWorkbench",
  bastion: "bastion/BastionWorkbench",
};

const today = Object.fromEntries(
  ["debate", "upload", "leakscan", "scrape", "certify", "feathers.write"].map((k) => [k, { limit: 4, left: 2 }]),
);

async function render(product: string, search: Record<string, string> = {}): Promise<string> {
  const module = PAGES[product];
  if (!module) throw new Error(`no page for ${product}`);
  return renderToStaticMarkup(await module.default({ searchParams: Promise.resolve(search) }));
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

  it("404s any other id, prototype keys included", async () => {
    for (const product of ["nope", "constructor", "magpie"]) {
      await expect(UnknownWorkbench({ params: Promise.resolve({ product }) })).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
    }
    expect(await generateMetadata()).toEqual({ title: "workbench not found" });
  });

  it.each(WORKBENCH_ORDER)(
    "titles and describes the %s workbench from the registry alone, canonical (spec 20, case 14)",
    (id) => {
      const product = PRODUCTS.find((p) => p.id === id);
      expect(PAGES[id]?.metadata).toEqual({
        title: `${id} workbench`,
        description: `${product?.tagline} Operate it live in bastion and keep what it hands back.`,
        alternates: { canonical: `/tools/${id}` },
      });
    },
  );

  it.each(WORKBENCH_ORDER)("ships only the %s workbench's code: its page imports no other", (id) => {
    const source = readFileSync(resolve(__dirname, `../../../../src/app/tools/${id}/page.tsx`), "utf8");
    const imported = [...source.matchAll(/from "@\/features\/tools\/([^"]+Workbench)"/g)].map((m) => m[1]);
    expect(imported).toEqual([WORKBENCH_MODULE[id]]);
  });

  it("passes a linked document (?doc=) to inkthread and inkgrid only when it is a UUID", async () => {
    const doc = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
    expect(await render("inkthread", { doc })).toContain(`the document from the link (${doc.slice(0, 8)})`);
    expect(await render("inkthread", { doc: "../etc" })).not.toContain("the document from the link");
  });
});
