"use client";

import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import type { Graph } from "@/capabilities/inkthread";
import { SvgDecoration } from "@/components/platform/SvgDecoration";
import {
  type EdgeFamily,
  graphLayoutInput,
  labelPlacement,
  layoutGraph,
  type NodeKind,
  type PlacedNode,
  ROLE_GROUPS,
  type RoleGroup,
} from "./graph-layout";
import { HELD_REASON, whenLive } from "./held";

/**
 * inkthread's graph, drawn (spec 21 §5, §5.1 invariant 6). The layout is settled before it is drawn
 * (a fixed number of d3-force ticks), so nothing moves on its own; with motion allowed the drawing
 * only fades in once. Nodes are coloured by role group and threads by family, both explained in a
 * text legend. The drawing is one tab stop: arrow keys move between elements in reading order, Home
 * and End jump, Enter or Space explains one (click does too). While the gate is not live a node only
 * moves focus: explaining it is held, and an Enter or click says why (invariant 1, round 4).
 */

export const GROUP_FILL: Readonly<Record<RoleGroup, string>> = {
  duty: "fill-accent-violet",
  condition: "fill-warning",
  definition: "fill-success",
  quantity: "fill-accent-cyan",
  reference: "fill-accent-rose",
  none: "fill-fg-muted",
};

const GROUP_SWATCH: Readonly<Record<RoleGroup, string>> = {
  duty: "bg-accent-violet",
  condition: "bg-warning",
  definition: "bg-success",
  quantity: "bg-accent-cyan",
  reference: "bg-accent-rose",
  none: "bg-fg-muted",
};

const FAMILIES: readonly { family: EdgeFamily; label: string }[] = [
  { family: "structure", label: "structure — contains, continues" },
  { family: "references", label: "references — refers to, cites outside" },
  { family: "logic", label: "logic — governs, qualifies, overrides" },
  { family: "notes", label: "notes — cites a note" },
  { family: "terms", label: "terms — defines, uses a term" },
];

const KIND_LABEL: Readonly<Record<NodeKind, string>> = {
  document: "document",
  section: "section",
  paragraph: "paragraph",
  list_item: "list item",
  table: "table",
  note: "note",
  definition: "definition",
  term: "term",
  external: "outside source",
};

const words = (s: string) => s.replaceAll("_", " ");

function nodeName(n: PlacedNode): string {
  const label = n.label.replace(/\s+/g, " ").trim();
  const short = label.length > 90 ? `${label.slice(0, 89)}…` : label;
  const roles = n.roles.length > 0 ? `, roles: ${n.roles.map(words).join(", ")}` : "";
  return `${KIND_LABEL[n.kind]}: ${short || "(untitled)"}${roles}`;
}

export function GraphView({
  graph,
  selected,
  onSelect,
  ready,
}: {
  graph: Pick<Graph, "nodes" | "edges">;
  selected: string | null;
  onSelect: (id: string) => void;
  /** The wake gate is live: explaining a node calls inkthread. */
  ready: boolean;
}) {
  const input = useMemo(() => graphLayoutInput(graph), [graph]);
  const placed = useMemo(() => layoutGraph(input), [input]);
  const [focused, setFocused] = useState<string | null>(null);
  const refs = useRef(new Map<string, SVGGElement>());
  const helpId = `graph-help-${useId()}`;
  const titleId = `graph-title-${useId()}`;
  // An Enter or click on a held node; it is said in the polite region below until the gate is live.
  const [heldTry, setHeldTry] = useState(false);
  const activate = whenLive(
    ready,
    (id: string) => {
      setHeldTry(false);
      onSelect(id);
    },
    () => setHeldTry(true),
  );

  const ids = placed.nodes.map((n) => n.id);
  const stop =
    (selected !== null && ids.includes(selected) ? selected : null) ??
    (focused !== null && ids.includes(focused) ? focused : null) ??
    ids[0];

  function move(e: KeyboardEvent<SVGGElement>, index: number) {
    let next = index;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = Math.min(ids.length - 1, index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = Math.max(0, index - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = ids.length - 1;
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const id = ids[index];
        if (id !== undefined) activate(id);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    const id = ids[next];
    if (id === undefined) return;
    setFocused(id);
    refs.current.get(id)?.focus();
  }

  const { x, y, width, height } = placed.viewBox;
  const chosen = placed.nodes.find((n) => n.id === selected) ?? null;
  const fontSize = Math.max(10, width / 55);

  return (
    <figure className="space-y-3">
      <p id={titleId} className="sr-only">
        inkthread’s graph of the document: {input.nodes.length} elements and {input.links.length}{" "}
        threads
      </p>
      <div className="overflow-hidden rounded-[3px] border border-border bg-background">
        {/* biome-ignore lint/a11y/useSemanticElements: an SVG canvas cannot be a <fieldset>; the group names its node buttons */}
        <svg
          viewBox={`${x} ${y} ${width} ${height}`}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={helpId}
          className="graph-canvas block h-auto max-h-[34rem] w-full"
        >
          <SvgDecoration>
            {placed.links.map((l) => (
              <line
                key={l.id}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                className={`graph-edge graph-edge-${l.family}`}
              />
            ))}
          </SvgDecoration>
          {placed.nodes.map((n, i) => {
            const isSelected = n.id === selected;
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG has no <button>; the group is a button by role, with keys
              <g
                key={n.id}
                ref={(el) => {
                  if (el) refs.current.set(n.id, el);
                  else refs.current.delete(n.id);
                }}
                role="button"
                tabIndex={n.id === stop ? 0 : -1}
                aria-pressed={isSelected}
                aria-disabled={ready ? undefined : true}
                aria-label={nodeName(n)}
                data-node={n.id}
                data-group={n.group}
                transform={`translate(${n.x} ${n.y})`}
                className={`graph-node ${ready ? "cursor-pointer" : "cursor-not-allowed"}`}
                onClick={() => activate(n.id)}
                onKeyDown={(e) => move(e, i)}
                onFocus={() => setFocused(n.id)}
              >
                <circle r={n.r + 5} className="graph-ring" />
                <circle r={n.r} className={`${GROUP_FILL[n.group]} graph-dot`} />
                {isSelected ? <circle r={n.r + 3} className="graph-selected" /> : null}
              </g>
            );
          })}
          {chosen ? (
            <SvgDecoration>
              <text
                x={labelPlacement(chosen, placed.viewBox).x}
                y={chosen.y + fontSize / 3}
                textAnchor={labelPlacement(chosen, placed.viewBox).anchor}
                fontSize={fontSize}
                className="graph-label"
              >
                {nodeName(chosen).slice(0, 48)}
              </text>
            </SvgDecoration>
          ) : null}
        </svg>
      </div>
      <figcaption className="space-y-3 font-mono text-[11px] text-fg-muted">
        <p id={helpId}>
          {input.truncated
            ? `showing ${input.nodes.length} of ${input.total} elements (the first in reading order). `
            : null}
          Arrow keys move between elements; Enter explains one. Click works too.
          {ready ? null : ` ${HELD_REASON}`}
        </p>
        <p aria-live="polite" data-held-notice="" className="text-warning">
          {!ready && heldTry ? `Nothing was explained yet. ${HELD_REASON}` : ""}
        </p>
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          <div>
            <p className="uppercase tracking-[0.18em]">nodes · coloured by their first role</p>
            <ul className="mt-2 space-y-1">
              {ROLE_GROUPS.map((g) => (
                <li key={g.group} className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${GROUP_SWATCH[g.group]}`}
                  />
                  <span>
                    <span className="text-foreground">{g.label}</span> —{" "}
                    {g.roles.map(words).join(", ")}
                  </span>
                </li>
              ))}
              <li className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${GROUP_SWATCH.none}`}
                />
                <span>
                  <span className="text-foreground">no role</span> — structure: the document, its
                  sections, tables, outside sources
                </span>
              </li>
            </ul>
          </div>
          <div>
            <p className="uppercase tracking-[0.18em]">threads · by family</p>
            <ul className="mt-2 space-y-1">
              {FAMILIES.map((f) => (
                <li key={f.family} className="flex items-center gap-2">
                  <svg
                    aria-hidden="true"
                    width="26"
                    height="6"
                    viewBox="0 0 26 6"
                    className="shrink-0 overflow-visible"
                  >
                    <line
                      x1="1"
                      y1="3"
                      x2="25"
                      y2="3"
                      className={`graph-edge graph-edge-${f.family}`}
                    />
                  </svg>
                  <span>{f.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
