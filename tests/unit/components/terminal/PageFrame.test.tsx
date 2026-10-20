import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { PageFrame } from "@/components/terminal/PageFrame";
import { attr, links } from "../../helpers/html";

describe("PageFrame", () => {
  it("renders children inside the main landmark, between the nav and the status bar", () => {
    const html = renderToStaticMarkup(<PageFrame active="platform">page-content-here</PageFrame>);
    expect(html).toMatch(/<main\b[^>]*id="main"[^>]*>[\s\S]*page-content-here[\s\S]*<\/main>/);
    expect(html.indexOf("<nav")).toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf("<footer"));
  });

  it("starts with a skip link to the main content (spec 21 §3.1)", () => {
    const html = renderToStaticMarkup(<PageFrame>content</PageFrame>);
    const first = links(html)[0];
    expect(first?.href).toBe("#main");
    expect(first?.name).toBe("skip to content");
  });

  it("passes the active page to the nav", () => {
    const html = renderToStaticMarkup(<PageFrame active="platform">content</PageFrame>);
    const current = links(html).filter((l) => attr(l.tag, "aria-current") === "page");
    expect(current.map((l) => l.href)).toEqual(["/platform"]);
  });

  it("passes statusRight to the status bar", () => {
    const html = renderToStaticMarkup(<PageFrame statusRight="5 services">content</PageFrame>);
    expect(html).toContain("5 services");
  });
});
