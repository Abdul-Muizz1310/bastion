import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/link as a plain <a> that keeps every attribute (aria-current, aria-label …).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { AppNav, NAV_LINKS } from "@/components/terminal/AppNav";
import { attr, links, textOf } from "../../helpers/html";

/** Spec 21 §3.1: one primary nav, map · tools · dossier · audit · time-travel · platform. */

describe("AppNav", () => {
  it("lists exactly the six v2 destinations, in order", () => {
    expect(NAV_LINKS.map((l) => [l.label, l.href])).toEqual([
      ["map", "/"],
      ["tools", "/tools"],
      ["dossier", "/dossier"],
      ["audit", "/audit"],
      ["time-travel", "/time-travel"],
      ["platform", "/platform"],
    ]);
    const html = renderToStaticMarkup(<AppNav />);
    const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
    expect(links(nav).map((l) => [l.name, l.href])).toEqual(
      NAV_LINKS.map((l) => [l.label, l.href]),
    );
  });

  it("is a labelled navigation landmark", () => {
    const html = renderToStaticMarkup(<AppNav />);
    expect(attr(/<nav\b[^>]*>/.exec(html)?.[0] ?? "", "aria-label")).toBe("primary");
  });

  it("marks the active page with aria-current, and only that one", () => {
    const html = renderToStaticMarkup(<AppNav active="audit" />);
    const current = links(html).filter((l) => attr(l.tag, "aria-current") === "page");
    expect(current.map((l) => l.href)).toEqual(["/audit"]);
  });

  it("marks nothing as current when no page is active", () => {
    const html = renderToStaticMarkup(<AppNav />);
    expect(html).not.toContain("aria-current");
  });

  it("brands the bar with a link home whose name says where it goes", () => {
    const html = renderToStaticMarkup(<AppNav />);
    const brand = links(html).find((l) => attr(l.tag, "data-brand") === "true");
    expect(brand?.href).toBe("/");
    expect(brand?.name).toBe("bastion, platform map");
  });

  it("links the source on GitHub, its arrow hidden from assistive tech", () => {
    const html = renderToStaticMarkup(<AppNav />);
    const source = links(html).find((l) => l.href === "https://github.com/Abdul-Muizz1310/bastion");
    expect(source).toBeTruthy();
    expect(source?.name).toBe("source");
    expect(source?.inner).toContain('aria-hidden="true"');
  });

  it("has no sign-in surface: no login, whoami, sign-in words or role pill (spec 21 §2)", () => {
    const html = renderToStaticMarkup(<AppNav active="map" />);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/whoami"');
    expect(textOf(html)).not.toMatch(/\b(log ?in|sign ?in|sign ?out|whoami)\b/i);
    expect(textOf(html)).not.toMatch(/\b(admin|editor|viewer)\b/);
  });
});
