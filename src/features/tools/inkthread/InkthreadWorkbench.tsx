"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import {
  type Graph,
  type GraphEdge,
  type GraphNode,
  type InkthreadDocument,
  inkthread,
  type Why,
} from "@/capabilities/inkthread";
import { GraphView } from "@/components/tools/GraphView";
import { HELD_REASON } from "@/components/tools/held";
import { Outcome } from "@/components/tools/Outcome";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { type PageBox, PageWithBoxes } from "@/components/tools/PageWithBoxes";
import { Panel, WithReceipt } from "@/components/tools/Panel";
import { BUTTON, BUTTON_QUIET } from "@/components/tools/styles";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { callTool } from "../client";
import { plural, short } from "../format";
import type { ToolOutcome } from "../outcome";
import { type Action, useAction, useFirstLoad } from "../use-action";
import { SamplePicker } from "./SamplePicker";

/**
 * inkthread's workbench (spec 21 §5, §5.1): the document as a graph of its own parts, coloured by
 * role; click or Enter on an element for its why — the rule or model that made it — and the why of
 * each of its roles and threads; the page with its boxes drawn. The receipt is `graph_hash`.
 */

export type InkthreadState = {
  samples?: ToolOutcome<{ items: InkthreadDocument[] }>;
  doc?: string;
  graph?: ToolOutcome<Graph>;
  selected?: string;
  element?: string;
  why?: ToolOutcome<Why>;
};

const P = "inkthread";
const MAX_THREADS = 12;
const words = (s: string) => s.replaceAll("_", " ");

export function InkthreadWorkbench({
  initial = {},
  doc: linked = null,
}: {
  initial?: InkthreadState;
  doc?: string | null;
}) {
  const ready = useWakeReady();
  const samples = useAction(initial.samples ?? null);
  const graph = useAction(initial.graph ?? null);
  const why = useAction(initial.why ?? null);
  const [doc, setDoc] = useState<string | null>(initial.doc ?? linked);
  const [selected, setSelected] = useState<string | null>(initial.selected ?? null);
  const [element, setElement] = useState<string | null>(initial.element ?? null);

  const load = (id: string) => {
    setDoc(id);
    setSelected(null);
    setElement(null);
    why.set(null);
    void graph.run((signal) => callTool(inkthread.graph, { documentId: id }, { signal }));
  };

  const loadSamples = () =>
    void samples
      .run((signal) => callTool(inkthread.samples, {}, { signal }))
      .then((outcome) => {
        // The first graph only: a failed one is retried by its own first-load rule below.
        if (graph.outcome !== null) return;
        const first = doc ?? (outcome?.ok ? (outcome.data.items[0]?.id ?? null) : null);
        if (first) load(first);
      });

  // Each first load retries once after a failure (the gate reopening), then waits for its manual
  // retry, so a load that keeps timing out never loops (review round 3).
  const samplesLoad = useFirstLoad();
  const graphLoad = useFirstLoad();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the gate opens
  useEffect(() => {
    if (!ready) return;
    if (samplesLoad(samples.outcome)) {
      loadSamples();
      return;
    }
    if (doc !== null && graph.outcome !== null && graphLoad(graph.outcome)) load(doc);
  }, [ready]);

  // Invariant 1: a why (and a new selection's page image) is a call — held until the gate is live.
  const explain = (id: string) => {
    if (!ready || doc === null) return;
    setElement(id);
    void why.run((signal) => callTool(inkthread.why, { documentId: doc, element: id }, { signal }));
  };

  const select = (id: string) => {
    if (!ready) return;
    setSelected(id);
    explain(id);
  };

  const list = samples.outcome?.ok ? samples.outcome.data.items : [];

  return (
    <div className="space-y-8">
      <Panel
        id="inkthread-document"
        title="the document"
        hint={
          doc ? (
            <Link
              href={`/tools/inkgrid?doc=${doc}`}
              className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              see inkgrid’s reading of it →
            </Link>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <SamplePicker
            samples={list}
            value={doc}
            onChange={(id) => id && load(id)}
            disabled={!ready}
          />
          <button
            type="button"
            onClick={() => doc && load(doc)}
            disabled={!ready || doc === null || graph.busy}
            className={BUTTON}
          >
            read the graph
          </button>
        </div>
        {samples.outcome && !samples.outcome.ok ? (
          <OutcomeNotice failure={samples.outcome} product={P} onRetry={loadSamples} />
        ) : null}
      </Panel>

      <Outcome
        state={graph}
        product={P}
        what="the graph"
        retry={doc === null ? undefined : () => load(doc)}
      >
        {(g, requestId) =>
          doc === null ? null : (
            <GraphPanels
              graph={g}
              requestId={requestId}
              doc={doc}
              selected={selected}
              element={element}
              why={why}
              ready={ready}
              onSelect={select}
              onExplain={explain}
            />
          )
        }
      </Outcome>
    </div>
  );
}

function GraphPanels({
  graph,
  requestId,
  doc,
  selected,
  element,
  why,
  ready,
  onSelect,
  onExplain,
}: {
  graph: Graph;
  requestId: string;
  doc: string;
  selected: string | null;
  element: string | null;
  why: Action<Why>;
  ready: boolean;
  onSelect: (id: string) => void;
  onExplain: (id: string) => void;
}) {
  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const node = selected === null ? undefined : nodes.get(selected);
  const p = graph.provenance;
  const fileName = graph.document.title ?? graph.document.file_name ?? "the document";

  return (
    <div className="space-y-8">
      <Panel
        id="inkthread-graph"
        title="the graph"
        hint={`${plural(graph.nodes.length, "element")} · ${plural(graph.edges.length, "thread")}`}
      >
        <WithReceipt
          receipt={
            <ToolReceipt
              kind="inkthread graph"
              serial={p.graph_hash.slice(0, 8)}
              title={fileName}
              lines={[
                { label: "graph_hash", value: p.graph_hash },
                { label: "elements", value: String(graph.nodes.length) },
                { label: "threads", value: String(graph.edges.length) },
                { label: "pipeline", value: p.pipeline_version },
                { label: "inkgrid", value: p.inkgrid_version },
                { label: "ops", value: String(p.ops_count) },
              ]}
              extra={[
                `graph_hash: ${p.graph_hash}`,
                `document sha256: ${graph.document.sha256}`,
                ...Object.entries(p.models).map(([task, model]) => `model ${task}: ${model}`),
              ]}
              requestId={requestId}
            />
          }
        >
          <GraphView graph={graph} selected={selected} onSelect={onSelect} ready={ready} />
        </WithReceipt>
      </Panel>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel id="inkthread-why" title="why" hint="the rule or model behind the element">
          {node === undefined ? (
            <p className="font-mono text-xs text-fg-muted">
              Choose an element in the graph — click it, or tab to the graph and use the arrow keys
              — to see what made it and why.
            </p>
          ) : (
            <ElementWhy
              node={node}
              graph={graph}
              nodes={nodes}
              element={element}
              why={why}
              ready={ready}
              onExplain={onExplain}
            />
          )}
        </Panel>
        <Panel
          id="inkthread-page"
          title="the page"
          hint="the element’s box, drawn on inkthread’s render"
        >
          {node === undefined ? (
            <p className="font-mono text-xs text-fg-muted">
              The chosen element’s page appears here.
            </p>
          ) : (
            <ElementPage node={node} graph={graph} nodes={nodes} doc={doc} ready={ready} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function threadsOf(graph: Graph, id: string): GraphEdge[] {
  const touching = graph.edges.filter((e) => e.source === id || e.target === id);
  // The structural "contains" threads say the least; show the others first.
  return [
    ...touching.filter((e) => e.type !== "contains"),
    ...touching.filter((e) => e.type === "contains"),
  ].slice(0, MAX_THREADS);
}

function ElementWhy({
  node,
  graph,
  nodes,
  element,
  why,
  ready,
  onExplain,
}: {
  node: GraphNode;
  graph: Graph;
  nodes: Map<string, GraphNode>;
  element: string | null;
  why: Action<Why>;
  ready: boolean;
  onExplain: (id: string) => void;
}) {
  const threads = threadsOf(graph, node.id);
  const heldId = `why-held-${useId()}`;
  const held = ready ? {} : { disabled: true, "aria-describedby": heldId };
  const pill = (id: string) =>
    `${BUTTON_QUIET} ${element === id ? "border-accent-violet text-accent-violet" : ""}`;
  return (
    <div className="space-y-5">
      <div className="font-mono text-xs">
        <p className="text-fg-muted">
          {words(node.kind)} · <span translate="no">{node.id}</span> · tier {node.confidence.tier}
        </p>
        <p className="mt-1.5 line-clamp-6 leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
          {node.text || node.label}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onExplain(node.id)}
          className={pill(node.id)}
          aria-pressed={element === node.id}
          {...held}
        >
          why this element
        </button>
        {node.roles.map((r) => {
          const id = `${node.id}#${r.role}`;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onExplain(id)}
              className={pill(id)}
              aria-pressed={element === id}
              {...held}
            >
              why {words(r.role)}
            </button>
          );
        })}
        {threads.map((e) => {
          const other = nodes.get(e.source === node.id ? e.target : e.source);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onExplain(e.id)}
              className={pill(e.id)}
              aria-pressed={element === e.id}
              {...held}
            >
              why {words(e.type)} {e.source === node.id ? "→" : "←"}{" "}
              {short(other?.label ?? "?", 24)}
            </button>
          );
        })}
      </div>
      {ready ? null : (
        <p id={heldId} className="font-mono text-[11px] text-fg-muted">
          {HELD_REASON}
        </p>
      )}

      <Outcome state={why} product={P} what="the why">
        {(w, requestId) => <WhyView why={w} requestId={requestId} />}
      </Outcome>
    </div>
  );
}

function WhyView({ why: w, requestId }: { why: Why; requestId: string }) {
  const maker = w.maker;
  return (
    <WithReceipt
      receipt={
        <ToolReceipt
          kind="inkthread why"
          serial={w.kind}
          title={w.element}
          lines={[
            { label: "made by", value: `${maker.actor} · ${maker.id}` },
            { label: "model", value: maker.model ?? "none — no model involved" },
            { label: "reasons", value: w.reasons.map((r) => r.code).join(", ") || "none" },
            { label: "verdict", value: w.verdict?.verdict ?? "none" },
          ]}
          extra={w.ops.map((o) => `op ${o.seq} ${o.stage} ${o.kind} by ${o.actor} (${o.method})`)}
          requestId={requestId}
        />
      }
    >
      <div className="space-y-3 font-mono text-xs leading-relaxed">
        <p className="text-foreground">{w.statement}</p>
        {w.evidence ? (
          <p className="text-fg-muted">
            evidence: <span className="text-accent-violet">“{w.evidence.quote}”</span> at characters{" "}
            {w.evidence.start}–{w.evidence.end}
          </p>
        ) : null}
        <ul className="space-y-0.5 text-fg-muted">
          {w.reasons.map((r) => (
            <li key={`${r.code}-${r.detail ?? ""}`}>
              {r.severity} · {words(r.code)}
              {r.detail ? ` — ${r.detail}` : ""}
            </li>
          ))}
        </ul>
        {w.ops.length > 0 ? (
          <ol className="space-y-0.5 border-l border-border-bright pl-3 text-fg-muted">
            {w.ops.map((o) => (
              <li key={o.seq} className="tabular-nums">
                #{o.seq} {o.stage} · {words(o.kind)} by {o.actor} ({o.method})
                {o.model ? ` · ${o.model}` : ""}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </WithReceipt>
  );
}

function ElementPage({
  node,
  graph,
  nodes,
  doc,
  ready,
}: {
  node: GraphNode;
  graph: Graph;
  nodes: Map<string, GraphNode>;
  doc: string;
  /** Another page's image is a call (`inkthread.page`): held until the gate is live. */
  ready: boolean;
}) {
  const pages = [...new Set(node.regions.map((r) => r.page))].sort((a, b) => a - b);
  const [chosen, setChosen] = useState<number | null>(null);
  const heldId = `page-held-${useId()}`;
  const page = chosen !== null && pages.includes(chosen) ? chosen : pages[0];
  if (page === undefined) {
    return (
      <p className="font-mono text-xs text-fg-muted">
        This element has no place on a page (a {words(node.kind)} lives only in the graph).
      </p>
    );
  }
  const size = graph.document.pages.find((p) => p.number === page);
  if (size === undefined) {
    return (
      <p className="font-mono text-xs text-fg-muted">inkthread gave no size for page {page}.</p>
    );
  }
  const related: PageBox[] = threadsOf(graph, node.id)
    .filter((e) => e.type !== "contains")
    .flatMap((e) => {
      const other = nodes.get(e.source === node.id ? e.target : e.source);
      return (other?.regions ?? [])
        .filter((r) => r.page === page)
        .map((r, i) => ({ key: `${e.id}-${i}`, bbox: r.bbox, tone: "related" as const }));
    });
  const boxes: PageBox[] = [
    ...node.regions
      .filter((r) => r.page === page)
      .map((r, i) => ({ key: `self-${i}`, bbox: r.bbox, tone: "self" as const })),
    ...related,
  ];
  return (
    <div className="space-y-3">
      {pages.length > 1 ? (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">pages this element is on</legend>
          {pages.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setChosen(n)}
              disabled={!ready}
              aria-describedby={ready ? undefined : heldId}
              aria-pressed={n === page}
              className={`${BUTTON_QUIET} ${n === page ? "border-accent-violet text-accent-violet" : ""}`}
            >
              page {n}
            </button>
          ))}
          {ready ? null : (
            <p id={heldId} className="w-full font-mono text-[11px] text-fg-muted">
              {HELD_REASON}
            </p>
          )}
        </fieldset>
      ) : null}
      <PageWithBoxes
        documentId={doc}
        page={page}
        size={{ width: size.width, height: size.height }}
        boxes={boxes}
        label={`${words(node.kind)} ${node.id}`}
      />
    </div>
  );
}
