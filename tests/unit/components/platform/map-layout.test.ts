import { describe, expect, it } from "vitest";
import {
  type Box,
  FLOWS,
  LAYOUTS,
  MAP_ORDER,
  type MapNodeId,
  NODE_ROLE,
  type Point,
  pathOf,
} from "@/components/platform/map-layout";
import { PRODUCTS } from "@/platform/registry/products";

/**
 * Spec 21 §3.1: the map's edges are exactly the dossier's flows, and the drawing is honest — every
 * edge leaves its source's border, arrives on its target's, and never runs through a node.
 */

const NODE_IDS: MapNodeId[] = [...PRODUCTS.map((p) => p.id), "feathers-demo"];

function onBorder([x, y]: Point, b: Box, tol = 0.5): boolean {
  const inX = x >= b.x - tol && x <= b.x + b.w + tol;
  const inY = y >= b.y - tol && y <= b.y + b.h + tol;
  const onVertical = Math.abs(x - b.x) <= tol || Math.abs(x - (b.x + b.w)) <= tol;
  const onHorizontal = Math.abs(y - b.y) <= tol || Math.abs(y - (b.y + b.h)) <= tol;
  return (inY && onVertical) || (inX && onHorizontal);
}

function strictlyInside([x, y]: Point, b: Box, inset = 1): boolean {
  return x > b.x + inset && x < b.x + b.w - inset && y > b.y + inset && y < b.y + b.h - inset;
}

function onPolyline(p: Point, points: readonly Point[], tol = 0.5): boolean {
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as Point;
    const [bx, by] = points[i] as Point;
    const len = Math.hypot(bx - ax, by - ay);
    const cross = Math.abs((bx - ax) * (ay - p[1]) - (ax - p[0]) * (by - ay)) / (len || 1);
    const within =
      p[0] >= Math.min(ax, bx) - tol &&
      p[0] <= Math.max(ax, bx) + tol &&
      p[1] >= Math.min(ay, by) - tol &&
      p[1] <= Math.max(ay, by) + tol;
    if (cross <= tol && within) return true;
  }
  return false;
}

function samples(points: readonly Point[], step = 2): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as Point;
    const [bx, by] = points[i] as Point;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

describe("FLOWS: exactly the dossier's flows (spec 21 §3.1)", () => {
  it("lists the six edges of the brief, no more, no fewer", () => {
    expect(FLOWS.map((f) => [f.from, f.to])).toEqual([
      [["magpie"], "inkprint"],
      [["inkgrid"], "inkthread"],
      [["inkthread"], "inkprint"],
      [["inkprint"], "paper-trail"],
      [["magpie", "inkthread", "inkprint", "paper-trail"], "slowquery"],
      [["feathers"], "feathers-demo"],
    ]);
  });

  it("gives each flow a unique id, a label and a sentence for the text description", () => {
    expect(new Set(FLOWS.map((f) => f.id)).size).toBe(FLOWS.length);
    for (const flow of FLOWS) {
      expect(flow.label.length).toBeGreaterThan(0);
      expect(flow.summary).toMatch(/\.$/);
    }
  });

  it("orders every product exactly once for reading and tabbing, bastion first", () => {
    expect([...MAP_ORDER].sort()).toEqual(PRODUCTS.map((p) => p.id).sort());
    expect(MAP_ORDER[0]).toBe("bastion");
  });

  it("gives every product a short role", () => {
    for (const p of PRODUCTS) expect(NODE_ROLE[p.id]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe.each(LAYOUTS)("the $id layout", (layout) => {
  it("places every product and feathers-demo, inside the canvas", () => {
    expect(Object.keys(layout.nodes).sort()).toEqual([...NODE_IDS].sort());
    for (const id of NODE_IDS) {
      const b = layout.nodes[id];
      expect(b.x, id).toBeGreaterThanOrEqual(0);
      expect(b.y, id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, id).toBeLessThanOrEqual(layout.width);
      expect(b.y + b.h, id).toBeLessThanOrEqual(layout.height);
    }
  });

  it("keeps at least 16 px between any two nodes", () => {
    for (const a of NODE_IDS) {
      for (const b of NODE_IDS) {
        if (a >= b) continue;
        const p = layout.nodes[a];
        const q = layout.nodes[b];
        const gapX = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w));
        const gapY = Math.max(q.y - (p.y + p.h), p.y - (q.y + q.h));
        expect(Math.max(gapX, gapY), `${a} vs ${b}`).toBeGreaterThanOrEqual(16);
      }
    }
  });

  it("puts bastion at the centre: centred across, in the middle third down", () => {
    const b = layout.nodes.bastion;
    const cy = b.y + b.h / 2;
    expect(Math.abs(b.x + b.w / 2 - layout.width / 2)).toBeLessThanOrEqual(1);
    expect(cy).toBeGreaterThan(layout.height / 3);
    expect(cy).toBeLessThan((layout.height * 2) / 3);
  });

  it.each(FLOWS)("draws $id from every source's border to the target's border", (flow) => {
    const g = layout.flows[flow.id];
    const arrows = g.segments.filter((s) => s.arrow);
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0];
    if (!arrow) throw new Error("unreachable");
    expect(onBorder(arrow.points.at(-1) as Point, layout.nodes[flow.to])).toBe(true);

    for (const source of flow.from) {
      const leaves = g.segments.some((s) => onBorder(s.points[0] as Point, layout.nodes[source]));
      expect(leaves, `${flow.id} leaves ${source}`).toBe(true);
    }

    // Every other end joins the flow's own drawing: a bus, never a dangling line.
    for (const seg of g.segments) {
      const others = g.segments.filter((s) => s !== seg);
      const start = seg.points[0] as Point;
      const end = seg.points.at(-1) as Point;
      const startsOnSource = flow.from.some((s) => onBorder(start, layout.nodes[s]));
      const startsOnBus = others.some((o) => onPolyline(start, o.points));
      expect(startsOnSource || startsOnBus, `${flow.id} segment start`).toBe(true);
      if (!seg.arrow) {
        expect(
          others.some((o) => onPolyline(end, o.points)),
          `${flow.id} segment end`,
        ).toBe(true);
      }
    }
  });

  it.each(FLOWS)("never runs $id through a node", (flow) => {
    for (const seg of layout.flows[flow.id].segments) {
      for (const p of samples(seg.points)) {
        for (const id of NODE_IDS) {
          expect(strictlyInside(p, layout.nodes[id]), `${flow.id} at ${p} inside ${id}`).toBe(
            false,
          );
        }
      }
    }
  });

  it.each(FLOWS)("keeps the $id label on the canvas", (flow) => {
    const { label } = layout.flows[flow.id];
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.x).toBeLessThanOrEqual(layout.width);
    expect(label.y).toBeGreaterThanOrEqual(0);
    expect(label.y).toBeLessThanOrEqual(layout.height);
  });
});

describe("pathOf", () => {
  it("draws a straight run as a move and a line", () => {
    expect(pathOf([
      [0, 0],
      [10, 0],
    ])).toBe("M0 0L10 0");
  });

  it("rounds each corner with a quadratic curve no larger than half the shorter leg", () => {
    expect(
      pathOf(
        [
          [0, 0],
          [20, 0],
          [20, 6],
        ],
        8,
      ),
    ).toBe("M0 0L17 0Q20 0 20 3L20 6");
  });

  it("refuses fewer than two points", () => {
    expect(() => pathOf([[0, 0]])).toThrow(RangeError);
  });
});
