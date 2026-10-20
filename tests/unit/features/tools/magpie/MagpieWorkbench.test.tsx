import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import type { MagpieHeal, MagpieItem, MagpieSource, ScrapeResult } from "@/capabilities/magpie";
import { MagpieWorkbench, type MagpieState } from "@/features/tools/magpie/MagpieWorkbench";
import { fixture } from "../../../capabilities/harness";
import { budgetsWith, buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { links, textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok, RID } from "../outcomes";

/** magpie's workbench (spec 21 §5): sources, scrape once, items with hashes, heal history with PRs. */

const sources = fixture("magpie", "sources.json") as MagpieSource[];
const items = fixture("magpie", "items.json") as MagpieItem[];
const heals = fixture("magpie", "heals.json") as MagpieHeal[];
const scrape = fixture("magpie", "scrape-once.json") as ScrapeResult;

const seeded = {
  sources: ok(sources, "rid-sources"),
  source: "hackernews",
  items: ok(items, "rid-items"),
  heals: ok(heals, "rid-heals"),
  scrape: ok(scrape, RID),
};

function render(opts: Partial<Parameters<typeof Seeded>[0]> = {}, initial: MagpieState = seeded) {
  return renderToStaticMarkup(
    <Seeded services={["magpie"]} {...opts}>
      <MagpieWorkbench initial={initial} />
    </Seeded>,
  );
}

describe("MagpieWorkbench", () => {
  it("renders the asleep state without crashing when the wake fails, with scraping disabled", () => {
    const html = render({ gate: "failed" }, {});
    expect(html).toContain('data-gate="unknown"');
    expect(isDisabled(buttonNamed(html, /scrape .*once/))).toBe(true);
  });

  it("disables scrape once at budget 0", () => {
    const html = render({ budgets: budgetsWith({ scrape: { limit: 30, left: 0 } }) });
    expect(isDisabled(buttonNamed(html, /scrape hackernews once/))).toBe(true);
  });

  it("lists the sources to pick from, linking the read to its audit trail", () => {
    const html = render();
    for (const s of sources) expect(textOf(html)).toContain(s.name);
    expect(auditHrefs(html)).toContain("/audit/rid-sources");
  });

  it("shows a scrape's items with their content hashes, and its receipt", () => {
    const html = render();
    const text = textOf(html);
    expect(text).toContain(scrape.items[0]?.content_hash.slice(0, 12));
    expect(text).toMatch(/magpie scrape/);
    expect(auditHrefs(html)).toContain(`/audit/${RID}`);
    expect(copyButtons(html)).toContain("copy the magpie scrape receipt");
  });

  it("browses the source's items, each hash shown", () => {
    const text = textOf(render());
    for (const item of items) expect(text).toContain(item.content_hash.slice(0, 12));
    expect(auditHrefs(render())).toContain("/audit/rid-items");
  });

  it("offers a manual retry when a first load failed (it retries itself only once)", () => {
    const html = render({}, { sources: { ok: false, kind: "asleep", requestId: "rid-s" } });
    expect(isDisabled(buttonNamed(html, /^\s*try again\s*$/))).toBe(false);
  });

  it("holds that manual retry while the gate is waking magpie again (invariant 1)", () => {
    const html = render({ gate: "waking" }, { sources: { ok: false, kind: "asleep", requestId: "rid-s" } });
    expect(isDisabled(buttonNamed(html, /^\s*try again\s*$/))).toBe(true);
  });

  it("names an item that has neither title nor URL instead of drawing an empty link", () => {
    const html = render();
    expect(textOf(html)).toContain("(no title)");
    expect(links(html).filter((l) => l.href === "")).toHaveLength(0);
  });

  it("shows the heal history with each self-heal PR link", () => {
    const html = render();
    const prs = links(html).filter((l) => l.href?.startsWith("https://github.com/"));
    expect(prs.map((l) => l.href)).toContain(heals[0]?.pr_url);
    expect(auditHrefs(html)).toContain("/audit/rid-heals");
  });
});
