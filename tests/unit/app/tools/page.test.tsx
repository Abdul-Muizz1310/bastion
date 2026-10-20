import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import ToolsIndex, { metadata } from "@/app/tools/page";
import { WORKBENCH_ORDER, WORKBENCHES } from "@/features/tools/catalog";
import { links, textOf } from "../../helpers/html";

/** `/tools` (spec 21 §5.1): the eight workbenches, each with what it operates and hands back. */

describe("/tools", () => {
  const html = renderToStaticMarkup(<ToolsIndex />);

  it("is titled and is the tools page of the nav", () => {
    expect(metadata).toMatchObject({ title: "workbenches" });
    const current = links(html).filter((l) => l.tag.includes('aria-current="page"'));
    expect(current.map((l) => l.href)).toEqual(["/tools"]);
  });

  it("has one h1", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("links every workbench, in dossier order, named by its product", () => {
    const cards = links(html).filter((l) => l.href?.startsWith("/tools/"));
    expect(cards.map((l) => l.href)).toEqual(WORKBENCH_ORDER.map((id) => `/tools/${id}`));
    for (const card of cards) expect(card.name).toMatch(/^[a-z-]+ workbench$/);
  });

  it("says what each one operates and the receipt it shows", () => {
    const text = textOf(html);
    for (const id of WORKBENCH_ORDER) {
      expect(text).toContain(WORKBENCHES[id].operate);
      expect(text).toContain(WORKBENCHES[id].receipt);
    }
  });

  it("shows each service-backed workbench's health, checking before the first answer", () => {
    expect(html.match(/data-state="checking"/g)?.length).toBe(7);
  });
});
