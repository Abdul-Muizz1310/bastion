import type { ProductId } from "@/platform/registry/products";

/**
 * The system map's geometry (spec 21 §3.1), as data: which flows exist, where every node sits and how
 * every edge runs, for a wide (desktop) and a tall (phone) canvas. Pure, so its honesty is testable:
 * edges start on their source's border, end on their target's, and never cross a node.
 */

export type MapNodeId = ProductId | "feathers-demo";
export type FlowKind = "evidence" | "telemetry" | "scaffold";
export type FlowId =
  | "magpie-inkprint"
  | "inkgrid-inkthread"
  | "inkthread-inkprint"
  | "inkprint-paper-trail"
  | "services-slowquery"
  | "feathers-scaffold";

export type Flow = {
  id: FlowId;
  from: readonly ProductId[];
  to: MapNodeId;
  kind: FlowKind;
  /** Printed on the edge. */
  label: string;
  /** One sentence for the text description the drawing points to. */
  summary: string;
};

/** Exactly the dossier's flows (spec 21 §3.1); slowquery's sources are the services it instruments (§8). */
export const FLOWS: readonly Flow[] = [
  {
    id: "magpie-inkprint",
    from: ["magpie"],
    to: "inkprint",
    kind: "evidence",
    label: "web evidence",
    summary: "magpie scrapes web pages live, and inkprint signs each item it brings back.",
  },
  {
    id: "inkgrid-inkthread",
    from: ["inkgrid"],
    to: "inkthread",
    kind: "evidence",
    label: "exact tables",
    summary: "inkgrid reads a PDF’s tables and text exactly; inkthread maps them into a graph.",
  },
  {
    id: "inkthread-inkprint",
    from: ["inkthread"],
    to: "inkprint",
    kind: "evidence",
    label: "PDF passages",
    summary: "inkthread hands each quoted passage, with its page and its why, to inkprint to sign.",
  },
  {
    id: "inkprint-paper-trail",
    from: ["inkprint"],
    to: "paper-trail",
    kind: "evidence",
    label: "signed evidence",
    summary: "paper-trail’s proponent, skeptic and judge argue only over that signed evidence.",
  },
  {
    id: "services-slowquery",
    from: ["magpie", "inkthread", "inkprint", "paper-trail"],
    to: "slowquery",
    kind: "telemetry",
    label: "queries · by request id",
    summary: "slowquery measures every query those four services ran for the dossier’s request id.",
  },
  {
    id: "feathers-scaffold",
    from: ["feathers"],
    to: "feathers-demo",
    kind: "scaffold",
    label: "generates",
    summary: "feathers generated feathers-demo, a live FastAPI service, from one YAML schema.",
  },
];

/** What each node does, in a few words; part of each node's accessible name. */
export const NODE_ROLE: Readonly<Record<ProductId, string>> = {
  bastion: "runs every call",
  magpie: "scrapes the web",
  inkgrid: "reads PDF tables",
  inkthread: "maps a PDF’s parts",
  inkprint: "signs evidence",
  "paper-trail": "debates the claim",
  slowquery: "measures queries",
  feathers: "scaffolds APIs",
};

/** Reading and tab order: the hub first, then the products in the order a dossier uses them. */
export const MAP_ORDER: readonly ProductId[] = [
  "bastion",
  "magpie",
  "inkgrid",
  "inkthread",
  "inkprint",
  "paper-trail",
  "slowquery",
  "feathers",
];

export type Point = readonly [number, number];
export type Box = { x: number; y: number; w: number; h: number };
export type Segment = { points: readonly Point[]; arrow: boolean };
export type FlowGeometry = {
  segments: readonly Segment[];
  /** Where a source's line joins a shared bus. */
  junctions: readonly Point[];
  label: { x: number; y: number; anchor: "start" | "middle" | "end" };
};

export type MapLayout = {
  id: "wide" | "tall";
  width: number;
  height: number;
  /** The narrowest the canvas is ever drawn, in CSS px, at the breakpoint it first shows. */
  minRenderWidth: number;
  /** Font sizes in canvas units. */
  type: { name: number; hub: number; meta: number; label: number };
  nodes: Readonly<Record<MapNodeId, Box>>;
  flows: Readonly<Record<FlowId, FlowGeometry>>;
};

const seg = (arrow: boolean, ...points: Point[]): Segment => ({ points, arrow });

/**
 * Desktop: sources on the left, signing and debate on the right, bastion and slowquery between.
 * Sized so node text and flow labels render at 12 px or more on the narrowest lg screen.
 */
export const WIDE: MapLayout = {
  id: "wide",
  width: 1120,
  height: 640,
  // 1024 viewport − 17 scrollbar − 48 main padding − 2 panel border (no canvas padding at lg).
  minRenderWidth: 957,
  type: { name: 19, hub: 28, meta: 14.5, label: 14.5 },
  nodes: {
    magpie: { x: 44, y: 44, w: 200, h: 92 },
    inkthread: { x: 44, y: 266, w: 200, h: 92 },
    inkgrid: { x: 44, y: 492, w: 200, h: 92 },
    inkprint: { x: 876, y: 44, w: 200, h: 92 },
    "paper-trail": { x: 876, y: 266, w: 200, h: 92 },
    feathers: { x: 876, y: 492, w: 200, h: 92 },
    bastion: { x: 424, y: 240, w: 272, h: 144 },
    slowquery: { x: 460, y: 492, w: 200, h: 92 },
    "feathers-demo": { x: 908, y: 410, w: 136, h: 36 },
  },
  flows: {
    "magpie-inkprint": {
      segments: [seg(true, [244, 76], [876, 76])],
      junctions: [],
      label: { x: 560, y: 64, anchor: "middle" },
    },
    "inkgrid-inkthread": {
      segments: [seg(true, [144, 492], [144, 358])],
      junctions: [],
      label: { x: 156, y: 430, anchor: "start" },
    },
    "inkthread-inkprint": {
      segments: [seg(true, [244, 312], [296, 312], [296, 108], [876, 108])],
      junctions: [],
      label: { x: 560, y: 132, anchor: "middle" },
    },
    "inkprint-paper-trail": {
      segments: [seg(true, [976, 136], [976, 266])],
      junctions: [],
      label: { x: 964, y: 206, anchor: "end" },
    },
    "services-slowquery": {
      segments: [
        seg(false, [44, 100], [16, 100], [16, 612], [560, 612]),
        seg(false, [44, 322], [16, 322]),
        seg(false, [1076, 100], [1104, 100], [1104, 612], [560, 612]),
        seg(false, [1076, 322], [1104, 322]),
        seg(true, [560, 612], [560, 584]),
      ],
      junctions: [
        [16, 322],
        [1104, 322],
        [560, 612],
      ],
      label: { x: 572, y: 604, anchor: "start" },
    },
    "feathers-scaffold": {
      segments: [seg(true, [976, 492], [976, 446])],
      junctions: [],
      label: { x: 966, y: 474, anchor: "end" },
    },
  },
};

/** Phone: the same flows top to bottom, slowquery's bus down both sides. */
export const TALL: MapLayout = {
  id: "tall",
  width: 400,
  height: 944,
  // A 360 px phone − 32 main padding − 2 panel border − 16 canvas padding.
  minRenderWidth: 310,
  type: { name: 15, hub: 22, meta: 12.5, label: 11.5 },
  nodes: {
    magpie: { x: 30, y: 24, w: 160, h: 80 },
    inkgrid: { x: 210, y: 24, w: 160, h: 80 },
    inkthread: { x: 210, y: 150, w: 160, h: 80 },
    inkprint: { x: 30, y: 276, w: 160, h: 80 },
    "paper-trail": { x: 30, y: 402, w: 160, h: 80 },
    bastion: { x: 86, y: 528, w: 228, h: 112 },
    slowquery: { x: 120, y: 690, w: 160, h: 80 },
    feathers: { x: 30, y: 840, w: 160, h: 80 },
    "feathers-demo": { x: 246, y: 862, w: 124, h: 36 },
  },
  flows: {
    "magpie-inkprint": {
      segments: [seg(true, [110, 104], [110, 276])],
      junctions: [],
      label: { x: 118, y: 194, anchor: "start" },
    },
    "inkgrid-inkthread": {
      segments: [seg(true, [290, 104], [290, 150])],
      junctions: [],
      label: { x: 298, y: 131, anchor: "start" },
    },
    "inkthread-inkprint": {
      segments: [seg(true, [290, 230], [290, 300], [190, 300])],
      junctions: [],
      label: { x: 298, y: 270, anchor: "start" },
    },
    "inkprint-paper-trail": {
      segments: [seg(true, [110, 356], [110, 402])],
      junctions: [],
      label: { x: 118, y: 383, anchor: "start" },
    },
    "services-slowquery": {
      segments: [
        seg(false, [30, 74], [10, 74], [10, 800], [200, 800]),
        seg(false, [30, 326], [10, 326]),
        seg(false, [30, 452], [10, 452]),
        seg(false, [370, 200], [390, 200], [390, 800], [200, 800]),
        seg(true, [200, 800], [200, 770]),
      ],
      junctions: [
        [10, 326],
        [10, 452],
        [200, 800],
      ],
      label: { x: 208, y: 791, anchor: "start" },
    },
    "feathers-scaffold": {
      segments: [seg(true, [190, 880], [246, 880])],
      junctions: [],
      label: { x: 308, y: 852, anchor: "middle" },
    },
  },
};

export const LAYOUTS: readonly MapLayout[] = [WIDE, TALL];

/** An SVG path through the points, each corner rounded by at most `radius` (half the shorter leg). */
export function pathOf(points: readonly Point[], radius = 10): string {
  if (points.length < 2) throw new RangeError("pathOf: a path needs at least two points");
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const [x0, y0] = points[0] as Point;
  let d = `M${fmt(x0)} ${fmt(y0)}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1] as Point;
    const [cx, cy] = points[i] as Point;
    const next = points[i + 1];
    if (!next) {
      d += `L${fmt(cx)} ${fmt(cy)}`;
      break;
    }
    const [nx, ny] = next;
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += `L${fmt(ax)} ${fmt(ay)}Q${fmt(cx)} ${fmt(cy)} ${fmt(bx)} ${fmt(by)}`;
  }
  return d;
}
