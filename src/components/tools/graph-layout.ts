import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { EDGE_FAMILIES, EDGE_TYPES, Graph, NODE_KINDS, ROLES } from "@/capabilities/inkthread";

/**
 * inkthread's graph as the workbench draws it (spec 21 §5.1, invariant 6), the pure core of
 * `GraphView`: what d3-force lays out (at most 400 nodes, in reading order; threads whose ends were
 * not drawn are dropped), the role groups that colour the nodes, and the layout itself — a fixed
 * number of ticks of a simulation that never runs on a timer. d3-force seeds its jiggle and its
 * initial phyllotaxis deterministically, so the same graph always gets the same picture.
 */

export type Role = (typeof ROLES)[number];
export type NodeKind = (typeof NODE_KINDS)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type EdgeFamily = (typeof EDGE_FAMILIES)[number];

export const MAX_GRAPH_NODES = 400;
export const LAYOUT_TICKS = 300;

export type RoleGroup = "duty" | "condition" | "definition" | "quantity" | "reference" | "none";

/** The legend: five groups of inkthread's 18 roles, each role in exactly one. */
export const ROLE_GROUPS: readonly {
  group: Exclude<RoleGroup, "none">;
  label: string;
  roles: readonly Role[];
}[] = [
  { group: "duty", label: "duties", roles: ["obligation", "permission", "prohibition"] },
  {
    group: "condition",
    label: "conditions",
    roles: ["condition", "exception", "scope", "temporal"],
  },
  { group: "definition", label: "definitions", roles: ["definition", "convention"] },
  {
    group: "quantity",
    label: "amounts & methods",
    roles: ["quantitative", "computation", "method", "procedure"],
  },
  {
    group: "reference",
    label: "references & notes",
    roles: ["external_pointer", "example", "summary", "claim", "administrative"],
  },
];

export const ROLE_GROUP: Readonly<Record<Role, Exclude<RoleGroup, "none">>> = Object.freeze(
  Object.fromEntries(ROLE_GROUPS.flatMap((g) => g.roles.map((role) => [role, g.group]))) as Record<
    Role,
    Exclude<RoleGroup, "none">
  >,
);

export type LayoutNode = {
  id: string;
  kind: NodeKind;
  label: string;
  roles: Role[];
  group: RoleGroup;
  order: number;
  degree: number;
};

export type LayoutLink = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  family: EdgeFamily;
};

export type LayoutInput = {
  nodes: LayoutNode[];
  links: LayoutLink[];
  /** How many nodes the graph has; more than `nodes.length` when it was capped. */
  total: number;
  truncated: boolean;
};

export function graphLayoutInput(
  graph: Pick<Graph, "nodes" | "edges">,
  max: number = MAX_GRAPH_NODES,
): LayoutInput {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError("graph layout: the node cap must be a positive whole number");
  }
  const ordered = [...graph.nodes].sort((a, b) => a.order - b.order);
  const kept = ordered.slice(0, max);
  const shown = new Set(kept.map((n) => n.id));
  const links: LayoutLink[] = graph.edges
    .filter((e) => shown.has(e.source) && shown.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type, family: e.family }));
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  const nodes: LayoutNode[] = kept.map((n) => {
    const roles = n.roles.map((r) => r.role);
    const first = roles[0];
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      roles,
      group: first === undefined ? "none" : ROLE_GROUP[first],
      order: n.order,
      degree: degree.get(n.id) ?? 0,
    };
  });
  return { nodes, links, total: graph.nodes.length, truncated: graph.nodes.length > kept.length };
}

const RADIUS: Readonly<Record<NodeKind, number>> = {
  document: 11,
  section: 7.5,
  table: 6.5,
  paragraph: 5,
  list_item: 4.5,
  note: 4.5,
  definition: 5.5,
  term: 5,
  external: 4.5,
};

export type PlacedNode = LayoutNode & { x: number; y: number; r: number };
export type PlacedLink = LayoutLink & { x1: number; y1: number; x2: number; y2: number };
export type Placed = {
  nodes: PlacedNode[];
  links: PlacedLink[];
  viewBox: { x: number; y: number; width: number; height: number };
};

type SimNode = SimulationNodeDatum & { id: string; r: number };
type SimLink = SimulationLinkDatum<SimNode> & { family: EdgeFamily };

const PADDING = 16;
const round = (n: number) => Math.round(n * 100) / 100;

/** Runs the simulation for a fixed number of ticks, off any timer, and fits a view box around it. */
export function layoutGraph(input: LayoutInput, ticks: number = LAYOUT_TICKS): Placed {
  const sim: SimNode[] = input.nodes.map((n) => ({ id: n.id, r: RADIUS[n.kind] }));
  const simLinks: SimLink[] = input.links.map((l) => ({
    source: l.source,
    target: l.target,
    family: l.family,
  }));
  const simulation = forceSimulation<SimNode>(sim)
    .stop()
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => (l.family === "structure" ? 26 : 42)),
    )
    .force("charge", forceManyBody<SimNode>().strength(-55).distanceMax(320))
    .force(
      "collide",
      forceCollide<SimNode>((d) => d.r + 2),
    )
    .force("x", forceX<SimNode>(0).strength(0.05))
    .force("y", forceY<SimNode>(0).strength(0.05));
  simulation.tick(ticks);
  simulation.stop();

  const at = new Map<string, { x: number; y: number }>();
  for (const node of sim) at.set(node.id, { x: round(node.x ?? 0), y: round(node.y ?? 0) });

  const nodes: PlacedNode[] = input.nodes.map((n) => {
    const p = at.get(n.id) ?? { x: 0, y: 0 };
    return { ...n, roles: [...n.roles], x: p.x, y: p.y, r: RADIUS[n.kind] };
  });
  const links: PlacedLink[] = input.links.map((l) => {
    const a = at.get(l.source) ?? { x: 0, y: 0 };
    const b = at.get(l.target) ?? { x: 0, y: 0 };
    return { ...l, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  nodes.forEach((n, i) => {
    if (i === 0 || n.x - n.r < minX) minX = n.x - n.r;
    if (i === 0 || n.y - n.r < minY) minY = n.y - n.r;
    if (i === 0 || n.x + n.r > maxX) maxX = n.x + n.r;
    if (i === 0 || n.y + n.r > maxY) maxY = n.y + n.r;
  });
  const viewBox = {
    x: Math.floor(minX - PADDING),
    y: Math.floor(minY - PADDING),
    width: Math.ceil(maxX - minX + 2 * PADDING) + 1,
    height: Math.ceil(maxY - minY + 2 * PADDING) + 1,
  };
  return { nodes, links, viewBox };
}
