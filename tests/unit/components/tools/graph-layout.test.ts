import { describe, expect, it } from "vitest";
import { type Graph, type GraphNode, ROLES } from "@/capabilities/inkthread";
import {
  graphLayoutInput,
  labelPlacement,
  layoutGraph,
  MAX_GRAPH_NODES,
  ROLE_GROUP,
  ROLE_GROUPS,
} from "@/components/tools/graph-layout";
import { fixture } from "../../capabilities/harness";

/**
 * inkthread's graph as the workbench draws it (spec 21 §5.1, invariant 6): the mapping from the
 * graph contract to what d3-force lays out, and a layout that is the same every time.
 */

const graph = fixture("inkthread", "graph.json") as Graph;

function manyNodes(n: number): Graph {
  const paragraph = graph.nodes.find((x) => x.kind === "paragraph") as GraphNode;
  const nodes = Array.from({ length: n }, (_, i) => ({
    ...structuredClone(paragraph),
    id: `p:${i.toString(16).padStart(16, "0")}`,
    order: n - i,
  }));
  const edges = nodes.slice(1).map((node, i) => ({
    ...structuredClone(graph.edges[0] as Graph["edges"][number]),
    id: `e:${i}`,
    source: nodes[0]?.id ?? "",
    target: node.id,
  }));
  return { ...graph, nodes, edges };
}

describe("graphLayoutInput", () => {
  it("keeps every node and thread of a small graph", () => {
    const input = graphLayoutInput(graph);
    expect(input.nodes).toHaveLength(6);
    expect(input.links).toHaveLength(5);
    expect(input.total).toBe(6);
    expect(input.truncated).toBe(false);
  });

  it("colours a node by its first role's group, and a node with no role as none", () => {
    const input = graphLayoutInput(graph);
    const paragraph = input.nodes.find((n) => n.id === "p:c95bca1f83faa250");
    expect(paragraph?.roles[0]).toBe("obligation");
    expect(paragraph?.group).toBe(ROLE_GROUP.obligation);
    expect(input.nodes.find((n) => n.kind === "document")?.group).toBe("none");
  });

  it("carries each thread's type and family, and counts each node's threads", () => {
    const input = graphLayoutInput(graph);
    expect(input.links.find((l) => l.type === "cites_external")?.family).toBe("references");
    expect(input.nodes.find((n) => n.id === "p:c95bca1f83faa250")?.degree).toBe(3);
  });

  it(`draws at most ${MAX_GRAPH_NODES} nodes, in reading order, and says how many there were`, () => {
    const input = graphLayoutInput(manyNodes(450));
    expect(input.nodes).toHaveLength(MAX_GRAPH_NODES);
    expect(input.total).toBe(450);
    expect(input.truncated).toBe(true);
    const orders = input.nodes.map((n) => n.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("drops a thread whose end was not drawn, or that names a node the graph lacks", () => {
    const g = manyNodes(450);
    const input = graphLayoutInput(g);
    const shown = new Set(input.nodes.map((n) => n.id));
    for (const link of input.links) {
      expect(shown.has(link.source)).toBe(true);
      expect(shown.has(link.target)).toBe(true);
    }
    const dangling = { ...graph, edges: [{ ...graph.edges[0], target: "p:missing" }] } as Graph;
    expect(graphLayoutInput(dangling).links).toEqual([]);
  });

  it("refuses a cap that is not a positive whole number", () => {
    expect(() => graphLayoutInput(graph, 0)).toThrow(RangeError);
  });
});

describe("ROLE_GROUP", () => {
  it("puts every inkthread role in exactly one legend group", () => {
    for (const role of ROLES) expect(ROLE_GROUP[role]).toBeDefined();
    const listed = ROLE_GROUPS.flatMap((g) => g.roles);
    expect([...listed].sort()).toEqual([...ROLES].sort());
  });
});

describe("layoutGraph", () => {
  it("is the same layout for the same graph (no randomness, a fixed number of ticks)", () => {
    const a = layoutGraph(graphLayoutInput(graph));
    const b = layoutGraph(graphLayoutInput(graph));
    expect(a).toEqual(b);
  });

  it("places every node at a finite point inside its view box", () => {
    const placed = layoutGraph(graphLayoutInput(manyNodes(120)));
    const { x, y, width, height } = placed.viewBox;
    expect(placed.nodes).toHaveLength(120);
    for (const n of placed.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
      expect(n.x - n.r).toBeGreaterThanOrEqual(x);
      expect(n.y - n.r).toBeGreaterThanOrEqual(y);
      expect(n.x + n.r).toBeLessThanOrEqual(x + width);
      expect(n.y + n.r).toBeLessThanOrEqual(y + height);
    }
  });

  it("draws each thread between its two nodes' positions", () => {
    const placed = layoutGraph(graphLayoutInput(graph));
    const at = new Map(placed.nodes.map((n) => [n.id, n]));
    for (const link of placed.links) {
      expect(link.x1).toBe(at.get(link.source)?.x);
      expect(link.y2).toBe(at.get(link.target)?.y);
    }
  });

  it("does not mutate its input", () => {
    const input = graphLayoutInput(graph);
    const before = structuredClone(input);
    layoutGraph(input);
    expect(input).toEqual(before);
  });
});

describe("labelPlacement", () => {
  const box = { x: -100, y: -100, width: 200, height: 200 };

  it("writes a label to the right of a node on the left half", () => {
    expect(labelPlacement({ x: -40, y: 0, r: 5 }, box)).toEqual({ x: -29, anchor: "start" });
  });

  it("writes it to the left of a node on the right half, so it never runs off the drawing", () => {
    expect(labelPlacement({ x: 60, y: 0, r: 5 }, box)).toEqual({ x: 49, anchor: "end" });
  });
});
