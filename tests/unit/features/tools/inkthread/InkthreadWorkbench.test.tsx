import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import type { Graph, InkthreadDocument, Why } from "@/capabilities/inkthread";
import { InkthreadWorkbench } from "@/features/tools/inkthread/InkthreadWorkbench";
import { fixture } from "../../../capabilities/harness";
import { buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { links, textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok, RID } from "../outcomes";

/**
 * inkthread's workbench (spec 21 §5, §5.1): the document as a graph coloured by role, the why of any
 * element, the page with the element's box drawn; the receipt is `graph_hash` and the rule or model
 * behind each element.
 */

const samples = fixture("inkthread", "samples.json") as { items: InkthreadDocument[] };
const graph = fixture("inkthread", "graph.json") as Graph;
const whyNode = fixture("inkthread", "why-node.json") as Why;
const whyRole = fixture("inkthread", "why-role.json") as Why;
const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const NODE = "p:c95bca1f83faa250";

function render(initial: object, opts: Partial<Parameters<typeof Seeded>[0]> = {}) {
  return renderToStaticMarkup(
    <Seeded name="inkthread" services={["inkthread"]} {...opts}>
      <InkthreadWorkbench initial={initial} />
    </Seeded>,
  );
}

const full = {
  samples: ok(samples, "rid-samples"),
  doc: DOC,
  graph: ok(graph, RID),
  selected: NODE,
  element: NODE,
  why: ok(whyNode, "rid-why"),
};

describe("InkthreadWorkbench", () => {
  it("renders without crashing when the wake fails, with the document picker disabled", () => {
    const html = render({}, { gate: "failed" });
    expect(html).toContain('data-gate="unknown"');
    expect(isDisabled(buttonNamed(html, /read the graph/))).toBe(true);
  });

  it("draws the graph and its receipt: graph_hash and provenance", () => {
    const html = render(full);
    const text = textOf(html);
    expect(html.match(/<g\b[^>]*role="button"/g)).toHaveLength(graph.nodes.length);
    expect(text).toMatch(/inkthread graph/);
    expect(text).toContain(graph.provenance.graph_hash.slice(0, 16));
    expect(auditHrefs(html)).toContain(`/audit/${RID}`);
    expect(copyButtons(html)).toContain("copy the inkthread graph receipt");
  });

  it("explains the selected element: what made it, and why", () => {
    const html = render(full);
    const text = textOf(html);
    expect(text).toContain(whyNode.statement);
    expect(text).toMatch(/made by inkgrid/);
    expect(auditHrefs(html)).toContain("/audit/rid-why");
  });

  it("names the rule behind a role", () => {
    const text = textOf(render({ ...full, element: `${NODE}#obligation`, why: ok(whyRole, "rid-role") }));
    expect(text).toContain("R-ROLE-obligation");
    expect(text).toContain("“must”");
  });

  it("offers the why of each of the element's roles and threads", () => {
    const html = render(full);
    expect(buttonNamed(html, /why obligation/)).toBeDefined();
    expect(buttonNamed(html, /why cites external/)).toBeDefined();
  });

  it("draws the element's page with its box", () => {
    const html = render(full);
    expect(html).toContain(`/api/tools/inkthread.page?documentId=${DOC}&amp;page=1`);
    expect(html).toContain('viewBox="0 0 612 792"');
    expect(html).toMatch(/<rect\b[^>]*data-box="self"/);
  });

  it("links the same document to inkgrid's reading", () => {
    expect(links(render(full)).some((l) => l.href === `/tools/inkgrid?doc=${DOC}`)).toBe(true);
  });
});
