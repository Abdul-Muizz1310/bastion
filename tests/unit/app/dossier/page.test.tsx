import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { connection, budgetsLeft } = vi.hoisted(() => ({
  connection: vi.fn(async () => {}),
  budgetsLeft: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection }));
vi.mock("@/platform/budget", async (orig) => ({
  ...(await orig<typeof import("@/platform/budget")>()),
  budgetsLeft: () => budgetsLeft(),
}));

import ComposePage, { metadata } from "@/app/dossier/page";
import { buttonNamed, isDisabled } from "../../components/tools/gate-fixtures";
import { textOf } from "../../helpers/html";

/** Spec 21 §3, §6.6: `/dossier` composes a dossier, rendered per request with today's budgets. */

const today = (debate: { limit: number; left: number }) =>
  Object.fromEntries(
    ["debate", "upload", "leakscan", "scrape", "certify", "feathers.write"].map((k) => [
      k,
      k === "debate" ? debate : { limit: 4, left: 4 },
    ]),
  );

async function render() {
  return renderToStaticMarkup(await ComposePage());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  budgetsLeft.mockResolvedValue(today({ limit: 4, left: 2 }));
});

describe("/dossier", () => {
  it("is titled and canonical", () => {
    expect(metadata).toMatchObject({ title: "compose a dossier", alternates: { canonical: "/dossier" } });
  });

  it("waits for a request, then renders the form with the debates left today", async () => {
    const html = await render();
    expect(connection).toHaveBeenCalled();
    expect(html).toContain("<h1");
    expect(textOf(html)).toMatch(/debates left today\s+2 of 4/);
    expect(html).toContain('aria-current="page"');
  });

  it("disables the run at 0 debates left", async () => {
    budgetsLeft.mockResolvedValue(today({ limit: 4, left: 0 }));
    expect(isDisabled(buttonNamed(await render(), /run the dossier/))).toBe(true);
  });

  it("still renders when the budget store is unreachable", async () => {
    budgetsLeft.mockRejectedValue(new Error("upstash down"));
    const html = await render();
    expect(isDisabled(buttonNamed(html, /run the dossier/))).toBe(false);
    expect(textOf(html)).toMatch(/could not be read/);
  });

  it("names the eight stages a dossier runs through", async () => {
    const text = textOf(await render());
    for (const stage of ["wake", "gather", "read", "seal", "debate", "measure", "envelope", "record"]) {
      expect(text).toContain(stage);
    }
  });
});
