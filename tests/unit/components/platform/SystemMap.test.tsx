import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FLOWS, NODE_ROLE } from "@/components/platform/map-layout";
import { STATE_META } from "@/components/platform/states";
import { SystemMap } from "@/components/platform/SystemMap";
import { HealthProvider } from "@/features/health/components/HealthProvider";
import { HealthSummary } from "@/features/health/components/HealthSummary";
import { parseStatusResponse, type StatusSnapshot } from "@/features/health/model";
import { PRODUCTS, SERVICES, type ServiceId } from "@/platform/registry/products";
import { attr, innerById, links, sliceByAttr, textOf } from "../../helpers/html";

/**
 * Spec 21 §3.1: the map renders the 8 products as links to their workbenches, each named with its
 * health state in words (never colour alone), bastion at the centre, the flows described in text.
 */

const AT = "2026-10-20T10:00:00.000Z";
const LAYOUT_IDS = ["wide", "tall"] as const;

function snapshot(entries: [ServiceId, string, number][]): StatusSnapshot {
  return parseStatusResponse({
    services: entries.map(([service, state, latencyMs]) => ({
      service,
      state,
      latencyMs,
      checkedAt: AT,
    })),
    timestamp: AT,
  });
}

const MIXED = snapshot([
  ["magpie", "live", 212],
  ["inkprint", "asleep", 8000],
  ["paper-trail", "down", 40],
  ["inkthread", "live", 95],
  ["feathers-demo", "asleep", 8000],
  // slowquery has no entry: unknown
]);

function render(initial?: StatusSnapshot): string {
  return renderToStaticMarkup(
    initial ? (
      <HealthProvider initial={initial}>
        <SystemMap />
      </HealthProvider>
    ) : (
      <SystemMap />
    ),
  );
}

function nodeLinks(html: string, layout: (typeof LAYOUT_IDS)[number]) {
  return links(sliceByAttr(html, "data-layout", layout));
}

function nameOf(html: string, layout: (typeof LAYOUT_IDS)[number], id: string): string {
  const link = nodeLinks(html, layout).find((l) => l.href === `/tools/${id}`);
  if (!link) throw new Error(`no node link for ${id}`);
  return link.name;
}

describe.each(LAYOUT_IDS)("SystemMap, %s layout", (layout) => {
  it("tabs through the nodes in the dossier's order: bastion first, then along the flows", () => {
    expect(nodeLinks(render(), layout).map((l) => l.href)).toEqual([
      "/tools/bastion",
      "/tools/magpie",
      "/tools/inkgrid",
      "/tools/inkthread",
      "/tools/inkprint",
      "/tools/paper-trail",
      "/tools/slowquery",
      "/tools/feathers",
    ]);
  });

  it("renders the 8 products as links to their workbenches", () => {
    const hrefs = nodeLinks(render(), layout).map((l) => l.href);
    expect(hrefs).toHaveLength(8);
    expect([...hrefs].sort()).toEqual(PRODUCTS.map((p) => `/tools/${p.id}`).sort());
  });

  it("names every node with its name, its state in words and its role", () => {
    const html = render(MIXED);
    expect(nameOf(html, layout, "magpie")).toBe(`magpie live · 212 ms ${NODE_ROLE.magpie}`);
    expect(nameOf(html, layout, "inkprint")).toBe(`inkprint asleep ${NODE_ROLE.inkprint}`);
    expect(nameOf(html, layout, "paper-trail")).toBe(`paper-trail down ${NODE_ROLE["paper-trail"]}`);
    expect(nameOf(html, layout, "slowquery")).toBe(`slowquery unknown ${NODE_ROLE.slowquery}`);
    // inkgrid is served by inkthread; feathers by feathers-demo.
    expect(nameOf(html, layout, "inkgrid")).toBe(`inkgrid live · 95 ms ${NODE_ROLE.inkgrid}`);
    expect(nameOf(html, layout, "feathers")).toBe(`feathers asleep ${NODE_ROLE.feathers}`);
    expect(nameOf(html, layout, "bastion")).toBe(
      `bastion live · serving this page ${NODE_ROLE.bastion}`,
    );
  });

  it("says checking before the first answer, and bastion is live", () => {
    const html = render();
    for (const p of PRODUCTS) {
      const expected = p.id === "bastion" ? "live" : STATE_META.checking.label;
      expect(nameOf(html, layout, p.id)).toContain(` ${expected}`);
    }
  });

  it("says unknown for every service-backed node after a failed request", () => {
    const html = render({ phase: "error", checkedAt: AT });
    for (const p of PRODUCTS) {
      const expected = p.id === "bastion" ? "live" : "unknown";
      expect(nameOf(html, layout, p.id)).toContain(` ${expected}`);
    }
  });

  it("marks each node's state for colour, next to the words (colour is never alone)", () => {
    const svg = sliceByAttr(render(MIXED), "data-layout", layout);
    const tag = links(svg).find((l) => l.href === "/tools/paper-trail")?.inner ?? "";
    expect(tag).toContain('data-state="down"');
    expect(textOf(tag)).toContain("down");
  });

  it("draws a visible focus ring on every node", () => {
    for (const l of nodeLinks(render(), layout)) {
      expect(l.inner).toContain("group-focus-visible:");
    }
  });

  it("draws feathers-demo as feathers' generated service, not as a ninth link", () => {
    const svg = sliceByAttr(render(), "data-layout", layout);
    expect(textOf(svg)).toContain("feathers-demo");
    expect(links(svg).some((l) => l.href?.includes("feathers-demo"))).toBe(false);
  });

  it("hides the edge drawing from assistive tech and points to the text description", () => {
    const html = render();
    const svg = sliceByAttr(html, "data-layout", layout);
    const svgTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
    const describedBy = attr(svgTag, "aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(innerById(html, describedBy ?? "")).toBeTruthy();
    const edges = svg.indexOf('data-edges="true"');
    const hidden = svg.lastIndexOf('<g aria-hidden="true">', edges);
    expect(edges).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
    expect(sliceByAttr(svg.slice(hidden), "aria-hidden", "true")).toContain('data-edges="true"');
  });
});

describe("SystemMap as a whole", () => {
  it("describes every flow in text", () => {
    const text = textOf(render());
    for (const flow of FLOWS) expect(text).toContain(flow.summary);
  });

  it("never repeats an id, so every aria reference is unambiguous", () => {
    const ids = [...render(MIXED).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a legend that writes each state it can show", () => {
    const legend = sliceByAttr(render(), "data-legend", "states");
    for (const s of ["live", "asleep", "down", "checking", "unknown"] as const) {
      expect(textOf(legend)).toContain(STATE_META[s].label);
    }
  });

  it("moves packets along the edges only when motion is welcome", () => {
    const css = readFileSync(resolve(__dirname, "../../../../src/app/globals.css"), "utf8");
    const outsideMotionQuery = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g,
      "",
    );
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.map-packets/);
    expect(outsideMotionQuery).not.toMatch(/\.map-packets[^{]*\{[^}]*animation/);
    expect(outsideMotionQuery).not.toMatch(/animation:\s*(blink|pulse-ring|map-dash)/);
  });

  it("stops moving on its own within 5 s, and moves again only while the map is pointed at", () => {
    // WCAG 2.2.2: motion that starts by itself and runs beside other content must stop within 5 s.
    const css = readFileSync(resolve(__dirname, "../../../../src/app/globals.css"), "utf8");
    const finite = (name: string) => {
      const m = new RegExp(`animation:\\s*${name}\\s+([\\d.]+)s[^;]*?\\s(\\d+)\\s*;`).exec(css);
      expect(m, `${name} runs a finite number of times`).toBeTruthy();
      return Number(m?.[1]) * Number(m?.[2]);
    };
    expect(finite("map-dash")).toBeLessThanOrEqual(5);
    expect(finite("blink")).toBeLessThanOrEqual(5);
    expect(css).toMatch(/\.map-panel:hover \.map-packets[^{]*\{[^}]*animation-iteration-count:\s*infinite/);
  });
});

describe("HealthSummary", () => {
  const ids = Object.keys(SERVICES) as ServiceId[];

  function summary(initial?: StatusSnapshot): string {
    return textOf(
      renderToStaticMarkup(
        initial ? (
          <HealthProvider initial={initial}>
            <HealthSummary serviceIds={ids} />
          </HealthProvider>
        ) : (
          <HealthSummary serviceIds={ids} />
        ),
      ),
    );
  }

  it("says it is checking before the first answer", () => {
    expect(summary()).toBe("checking 6 services…");
  });

  it("counts the states it knows, skipping zeros, with the UTC time of the check", () => {
    expect(summary(MIXED)).toBe("6 services: 2 live · 2 asleep · 1 down · 1 unknown · checked 10:00:00 UTC");
  });

  it("says the status is unavailable after a failed request", () => {
    expect(summary({ phase: "error", checkedAt: AT })).toBe(
      "status unavailable · retrying every 30 s",
    );
  });
});
