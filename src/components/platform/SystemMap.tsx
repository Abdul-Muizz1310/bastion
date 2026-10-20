import { HealthSummary } from "@/features/health/components/HealthSummary";
import { NodeHealth } from "@/features/health/components/NodeHealth";
import { PRODUCTS, type Product, SERVICES, type ServiceId } from "@/platform/registry/products";
import {
  type Box,
  FLOWS,
  type FlowKind,
  MAP_ORDER,
  type MapLayout,
  NODE_ROLE,
  pathOf,
  TALL,
  WIDE,
} from "./map-layout";
import { ServiceBadge } from "./ServiceBadge";
import { SvgDecoration } from "./SvgDecoration";

/**
 * The live system map (spec 21 §3.1). Drawn on the server; only the health inside each node is a
 * client leaf, fed by the HealthProvider the page wraps around it. Two canvases share one geometry
 * model: wide from `lg` up, tall below. The edges are hidden from assistive tech and described in
 * the ordered list that follows, which the drawing points to with aria-describedby.
 */

const FLOWS_ID = "map-flows";
const TITLE_ID = "map-title";
const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];

const EDGE_CLASS: Readonly<Record<FlowKind, string>> = {
  evidence: "map-edge map-edge-evidence",
  telemetry: "map-edge map-edge-telemetry",
  scaffold: "map-edge map-edge-scaffold",
};

const ARROW_CLASS: Readonly<Record<FlowKind, string>> = {
  evidence: "fill-accent-violet",
  telemetry: "fill-accent-cyan",
  scaffold: "fill-fg-muted",
};

const KINDS: readonly FlowKind[] = ["evidence", "telemetry", "scaffold"];

export function SystemMap() {
  return (
    <section aria-labelledby={TITLE_ID} className="map-panel">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-border px-4 py-3 md:px-5">
        <h2 id={TITLE_ID} className="font-mono text-xs uppercase tracking-[0.22em] text-fg-muted">
          <span aria-hidden="true" className="text-accent-violet">
            ▚{" "}
          </span>
          the system, live
        </h2>
        <HealthSummary serviceIds={SERVICE_IDS} />
      </header>

      <div className="px-2 py-4 md:px-4">
        <MapCanvas layout={WIDE} className="hidden w-full lg:block" />
        <MapCanvas layout={TALL} className="mx-auto block w-full max-w-[440px] lg:hidden" />
      </div>

      <div className="grid gap-x-10 gap-y-6 border-t border-border px-4 py-5 md:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Legend />
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
            how they combine
          </h3>
          <ol id={FLOWS_ID} className="mt-3 grid gap-x-8 gap-y-2.5 md:grid-cols-2">
            {FLOWS.map((flow, i) => (
              <li key={flow.id} className="flex gap-3 font-mono text-xs leading-relaxed">
                <span aria-hidden="true" className="tabular-nums text-fg-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-foreground/85">{flow.summary}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="space-y-4">
      <div data-legend="states">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          node state
        </h3>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {(["live", "asleep", "down", "checking", "unknown"] as const).map((s) => (
            <li key={s}>
              <ServiceBadge state={s} />
            </li>
          ))}
        </ul>
        <p className="mt-2 max-w-sm font-mono text-[11px] leading-relaxed text-fg-muted">
          Free Render services sleep after 15 minutes and take about a minute to wake. Asleep is not
          down.
        </p>
      </div>
      <div data-legend="edges">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">edges</h3>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-xs text-fg-muted">
          <li className="flex items-center gap-2">
            <EdgeSwatch kind="evidence" /> evidence
          </li>
          <li className="flex items-center gap-2">
            <EdgeSwatch kind="telemetry" /> queries
          </li>
          <li className="flex items-center gap-2">
            <EdgeSwatch kind="scaffold" /> generates
          </li>
        </ul>
      </div>
    </div>
  );
}

function EdgeSwatch({ kind }: { kind: FlowKind }) {
  return (
    <svg aria-hidden="true" width="28" height="8" viewBox="0 0 28 8" className="overflow-visible">
      <path d="M1 4H27" className={EDGE_CLASS[kind]} />
    </svg>
  );
}

function MapCanvas({ layout, className }: { layout: MapLayout; className: string }) {
  const prefix = `map-${layout.id}-`;
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const products = MAP_ORDER.map((id) => {
    const product = byId.get(id);
    if (!product) throw new Error(`SystemMap: the registry has no ${id}`);
    return product;
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG canvas cannot be a <fieldset>; the group names its 8 links
    <svg
      data-layout={layout.id}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="group"
      aria-labelledby={TITLE_ID}
      aria-describedby={FLOWS_ID}
      className={`map-canvas ${className}`}
    >
      <defs>
        <pattern id={`${prefix}dots`} width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="0.9" className="fill-border-bright" />
        </pattern>
        {KINDS.map((kind) => (
          <marker
            key={kind}
            id={`${prefix}arrow-${kind}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" className={ARROW_CLASS[kind]} />
          </marker>
        ))}
      </defs>

      {/* The grid, the edges and feathers-demo: all said in text by the flows list. */}
      <SvgDecoration>
        <rect width={layout.width} height={layout.height} fill={`url(#${prefix}dots)`} />
        <Edges layout={layout} prefix={prefix} />
        <DemoChip box={layout.nodes["feathers-demo"]} size={layout.type.meta} />
      </SvgDecoration>

      {products.map((product) =>
        product.id === "bastion" ? (
          <HubNode
            key={product.id}
            product={product}
            box={layout.nodes.bastion}
            layout={layout}
            prefix={prefix}
          />
        ) : (
          <ProductNode
            key={product.id}
            product={product}
            box={layout.nodes[product.id]}
            layout={layout}
            prefix={prefix}
          />
        ),
      )}
    </svg>
  );
}

function Edges({ layout, prefix }: { layout: MapLayout; prefix: string }) {
  return (
    <g data-edges="true">
      {FLOWS.map((flow) => {
        const geometry = layout.flows[flow.id];
        return (
          <g key={flow.id} data-flow={flow.id}>
            {geometry.segments.map((segment) => {
              const d = pathOf(segment.points);
              return (
                <g key={d}>
                  <path
                    d={d}
                    className={EDGE_CLASS[flow.kind]}
                    markerEnd={segment.arrow ? `url(#${prefix}arrow-${flow.kind})` : undefined}
                  />
                  {flow.kind === "evidence" ? <path d={d} className="map-packets" /> : null}
                </g>
              );
            })}
            {geometry.junctions.map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} className="fill-accent-cyan" />
            ))}
            <text
              x={geometry.label.x}
              y={geometry.label.y}
              textAnchor={geometry.label.anchor}
              fontSize={layout.type.label}
              className="map-label"
            >
              {flow.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DemoChip({ box, size }: { box: Box; size: number }) {
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={4}
        className="map-chip fill-background"
      />
      <text
        x={box.x + box.w / 2}
        y={box.y + box.h / 2 + size * 0.36}
        textAnchor="middle"
        fontSize={size}
        className="fill-fg-muted"
      >
        feathers-demo
      </text>
    </g>
  );
}

function NodeFrame({ box, hub = false }: { box: Box; hub?: boolean }) {
  return (
    <>
      <rect
        x={box.x - 5}
        y={box.y - 5}
        width={box.w + 10}
        height={box.h + 10}
        rx={hub ? 12 : 9}
        className="map-focus fill-none stroke-accent-violet opacity-0 group-focus-visible:opacity-100"
        strokeWidth={2}
      />
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={hub ? 8 : 5}
        className="map-frame fill-surface"
      />
    </>
  );
}

function ids(prefix: string, id: string) {
  return {
    name: `${prefix}${id}-name`,
    state: `${prefix}${id}-state`,
    role: `${prefix}${id}-role`,
  };
}

function ProductNode({
  product,
  box,
  layout,
  prefix,
}: {
  product: Product;
  box: Box;
  layout: MapLayout;
  prefix: string;
}) {
  const id = ids(prefix, product.id);
  const { name: nameSize, meta } = layout.type;
  const left = box.x + 16;
  return (
    <a
      href={`/tools/${product.id}`}
      aria-labelledby={`${id.name} ${id.state} ${id.role}`}
      className="map-node group outline-none"
    >
      <NodeFrame box={box} />
      <text
        id={id.name}
        x={left}
        y={box.y + box.h * 0.34}
        fontSize={nameSize}
        className="notranslate map-name fill-foreground"
      >
        {product.name}
      </text>
      <SvgDecoration>
        <text
          x={box.x + box.w - 12}
          y={box.y + box.h * 0.32}
          textAnchor="end"
          fontSize={meta}
          className="fill-fg-muted transition-colors group-hover:fill-accent-violet group-focus-visible:fill-accent-violet"
        >
          ↗
        </text>
      </SvgDecoration>
      <text id={id.role} x={left} y={box.y + box.h * 0.6} fontSize={meta} className="fill-fg-muted">
        {NODE_ROLE[product.id]}
      </text>
      <NodeHealth
        services={product.services}
        labelId={id.state}
        x={left}
        y={box.y + box.h * 0.84}
        fontSize={meta}
        rail={{ x: box.x, y: box.y + 12, h: box.h - 24 }}
      />
    </a>
  );
}

function HubNode({
  product,
  box,
  layout,
  prefix,
}: {
  product: Product;
  box: Box;
  layout: MapLayout;
  prefix: string;
}) {
  const id = ids(prefix, product.id);
  const { hub, meta } = layout.type;
  const left = box.x + 22;
  return (
    <a
      href={`/tools/${product.id}`}
      aria-labelledby={`${id.name} ${id.state} ${id.role}`}
      className="map-node map-hub group outline-none"
    >
      <NodeFrame box={box} hub />
      <rect
        x={box.x + 5}
        y={box.y + 5}
        width={box.w - 10}
        height={box.h - 10}
        rx={5}
        className="map-hub-wall fill-none"
      />
      <text
        id={id.name}
        x={left}
        y={box.y + box.h * 0.32}
        fontSize={hub}
        className="notranslate map-name map-hub-name fill-foreground"
      >
        {product.name}
      </text>
      <SvgDecoration>
        <text
          x={box.x + box.w - 18}
          y={box.y + box.h * 0.3}
          textAnchor="end"
          fontSize={meta}
          className="fill-fg-muted transition-colors group-hover:fill-accent-violet group-focus-visible:fill-accent-violet"
        >
          ↗
        </text>
        <text x={left} y={box.y + box.h * 0.66} fontSize={meta} className="fill-accent-violet">
          gateway · dossier · audit
        </text>
      </SvgDecoration>
      <text id={id.role} x={left} y={box.y + box.h * 0.5} fontSize={meta} className="fill-fg-muted">
        {NODE_ROLE[product.id]}
      </text>
      <NodeHealth
        services={product.services}
        labelId={id.state}
        x={left}
        y={box.y + box.h * 0.84}
        fontSize={meta}
        rail={{ x: box.x + 5, y: box.y + 18, h: box.h - 36 }}
      />
    </a>
  );
}
