import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Graph, GraphNode } from "@/capabilities/inkthread";
import { GraphView } from "@/components/tools/GraphView";
import { ROLE_GROUPS } from "@/components/tools/graph-layout";
import { HELD_REASON } from "@/components/tools/held";
import { fixture } from "../../capabilities/harness";
import { sliceByAttr, textOf } from "../../helpers/html";

/**
 * inkthread's graph, drawn (spec 21 §5, §5.1 invariant 6): every node a keyboard-reachable button
 * named in words, one tab stop into the drawing, nodes coloured by role group with a text legend,
 * threads by family — and nothing animating on its own.
 */

const graph = fixture("inkthread", "graph.json") as Graph;
const render = (g: Graph = graph, selected: string | null = null, ready = true) =>
  renderToStaticMarkup(<GraphView graph={g} selected={selected} onSelect={() => {}} ready={ready} />);

const nodeTags = (html: string) => html.match(/<g\b[^>]*role="button"[^>]*>/g) ?? [];

describe("GraphView", () => {
  it("draws every node as a button named by its kind, label and roles", () => {
    const tags = nodeTags(render());
    expect(tags).toHaveLength(6);
    const paragraph = tags.find((t) => t.includes('data-node="p:c95bca1f83faa250"')) ?? "";
    expect(paragraph).toMatch(/aria-label="paragraph: The fees subject[^"]*roles: obligation, condition/);
  });

  it("is one tab stop: exactly one node is in the tab order", () => {
    const tags = nodeTags(render());
    expect(tags.filter((t) => t.includes('tabindex="0"'))).toHaveLength(1);
    expect(tags.filter((t) => t.includes('tabindex="-1"'))).toHaveLength(5);
  });

  it("marks the selected node pressed and makes it the tab stop", () => {
    const tags = nodeTags(render(graph, "x:49cb66e4d5148c33"));
    const selected = tags.find((t) => t.includes('data-node="x:49cb66e4d5148c33"')) ?? "";
    expect(selected).toContain('aria-pressed="true"');
    expect(selected).toContain('tabindex="0"');
  });

  it("explains the colours in a text legend: every role group and every thread family", () => {
    const text = textOf(render());
    for (const group of ROLE_GROUPS) {
      expect(text).toContain(group.label);
      for (const role of group.roles) expect(text).toContain(role.replace("_", " "));
    }
    for (const family of ["structure", "references", "logic", "notes", "terms"]) {
      expect(text).toContain(family);
    }
  });

  it("tells the keyboard how to move and choose", () => {
    expect(textOf(render())).toMatch(/arrow keys move between elements; enter explains one/i);
  });

  it("says how many nodes it drew when the graph is larger than the cap", () => {
    const paragraph = graph.nodes[2] as GraphNode;
    const nodes = Array.from({ length: 405 }, (_, i) => ({
      ...paragraph,
      id: `p:${String(i).padStart(16, "0")}`,
      order: i,
    }));
    const text = textOf(render({ ...graph, nodes, edges: [] }));
    expect(text).toMatch(/showing 400 of 405 elements/);
  });

  it("holds every node while the gate is not live, and says why (invariant 1, round 4)", () => {
    const html = render(graph, null, false);
    const tags = nodeTags(html);
    expect(tags.every((t) => t.includes('aria-disabled="true"'))).toBe(true);
    // Arrow keys still move: the one tab stop stays.
    expect(tags.filter((t) => t.includes('tabindex="0"'))).toHaveLength(1);
    const helpId = /<svg\b[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(textOf(sliceByAttr(html, "id", helpId))).toContain(HELD_REASON);
    // An Enter or click while held is announced here (the handler itself is whenLive's).
    expect(html).toMatch(/<p\b[^>]*aria-live="polite"[^>]*data-held-notice=""/);
  });

  it("holds nothing once the gate is live", () => {
    const html = render();
    expect(nodeTags(html).some((t) => t.includes("aria-disabled"))).toBe(false);
    expect(textOf(html)).not.toContain(HELD_REASON);
  });

  it("has no running animation: no SMIL, the layout is settled before it is drawn", () => {
    const html = render();
    expect(html).not.toMatch(/<animate/);
  });
});
