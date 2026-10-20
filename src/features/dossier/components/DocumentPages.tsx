"use client";

import { type ReactNode, useEffect, useState } from "react";
import { type Graph, inkthread } from "@/capabilities/inkthread";
import { HELD_REASON } from "@/components/tools/held";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { PageWithBoxes } from "@/components/tools/PageWithBoxes";
import { BUTTON_QUIET } from "@/components/tools/styles";
import { useWakeReady, WakeGate } from "@/components/tools/WakeGate";
import type { WakeState } from "@/components/tools/wake-model";
import { callTool } from "@/features/tools/client";
import type { ToolOutcome } from "@/features/tools/outcome";
import { useAction, useFirstLoad } from "@/features/tools/use-action";
import { documentAnchor, evidenceHref } from "../citations";
import type { DocumentView, Excerpt } from "../receipt-view";

/**
 * The documents a dossier quoted (spec 21 §6.6, Ruling AJ). Each quoted page is listed — anchored
 * `doc-<id>-p<N>` whatever happens next, since the evidence table's locators link there — with
 * its excerpts. Nothing wakes inkthread for a visitor who only reads: "show on its pages" opens a
 * wake gate on demand, then the page sizes come from `inkthread.graph` and each excerpt is drawn as
 * a box on inkthread's render of its page (`PageWithBoxes`). An upload whose graph answers 404 or
 * 410 is gone by design (DR-0029: inkthread keeps an upload for an hour and never its bytes); the
 * quoted passages stay in the dossier. Bytes that are not the PDF the dossier read (another
 * sha256) get no boxes.
 */

type Outcomes = Readonly<Record<string, ToolOutcome<Graph>>>;
type PageSize = { width: number; height: number };

export function DocumentPages({
  documents,
  initial = {},
  initialShown = false,
  initialGate,
}: {
  documents: readonly DocumentView[];
  /** Graph reads already answered, by document id (tests seed them). */
  initial?: Outcomes;
  /** Whether the visitor already asked to see the pages, and that gate's state (tests). */
  initialShown?: boolean;
  initialGate?: WakeState;
}) {
  return (
    <div className="space-y-8">
      {documents.map((d) => (
        <DocumentCard
          key={d.documentId}
          doc={d}
          initial={initial[d.documentId] ?? null}
          initialShown={initialShown}
          initialGate={initialGate}
        />
      ))}
    </div>
  );
}

function short(hash: string | null): string {
  return hash === null ? "not recorded" : `${hash.slice(0, 12)}…`;
}

function DocumentCard({
  doc,
  initial,
  initialShown,
  initialGate,
}: {
  doc: DocumentView;
  initial: ToolOutcome<Graph> | null;
  initialShown: boolean;
  initialGate: WakeState | undefined;
}) {
  const [shown, setShown] = useState(initialShown);
  const quoted = doc.excerpts.length > 0;

  return (
    <article
      id={documentAnchor(doc.documentId)}
      data-document={doc.documentId}
      aria-labelledby={`${documentAnchor(doc.documentId)}-title`}
      className="space-y-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-mono text-xs">
        <h3 id={`${documentAnchor(doc.documentId)}-title`} className="text-sm text-foreground">
          {doc.title ?? doc.documentId}
          <span className="ml-2 text-fg-muted">
            {doc.kind}
            {doc.pageCount === null ? "" : ` · ${doc.pageCount} pages`}
          </span>
        </h3>
        <p className="text-fg-muted tabular-nums" translate="no">
          sha256 {short(doc.sha256)} · graph {short(doc.graphHash)}
        </p>
      </header>
      {!quoted ? (
        <p className="font-mono text-xs text-fg-muted">
          no passage of this document was quoted, so there is nothing to draw.
        </p>
      ) : shown ? (
        <WakeGate name="inkthread" services={["inkthread"]} initial={initialGate}>
          <ShownPages doc={doc} initial={initial} />
        </WakeGate>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" onClick={() => setShown(true)} className={BUTTON_QUIET}>
              show on its pages
            </button>
            <p className="font-mono text-[11px] leading-relaxed text-fg-muted">
              This wakes inkthread (a free service can take a minute) and boxes each quoted passage
              on inkthread’s render of its page.
            </p>
          </div>
          <PageList doc={doc} sizes={null} />
        </div>
      )}
    </article>
  );
}

/** Once asked: the graph read behind the gate, then every quoted page drawn — or why not. */
function ShownPages({ doc, initial }: { doc: DocumentView; initial: ToolOutcome<Graph> | null }) {
  const ready = useWakeReady();
  const graph = useAction<Graph>(initial);
  const firstLoad = useFirstLoad();
  const load = () =>
    void graph.run((signal) =>
      callTool(inkthread.graph, { documentId: doc.documentId }, { signal }),
    );

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the gate opens
  useEffect(() => {
    if (ready && firstLoad(graph.outcome)) load();
  }, [ready]);

  const { busy, outcome } = graph;
  let notice: ReactNode = null;
  let sizes: ((page: number) => PageSize | null) | null = null;
  if (outcome === null) {
    notice = (
      <p className="font-mono text-xs text-fg-muted">
        {busy ? (
          <span className="motion-safe:animate-pulse">reading the page sizes from inkthread…</span>
        ) : ready ? (
          "the pages load from inkthread…"
        ) : (
          `The pages are inkthread’s renders. ${HELD_REASON}`
        )}
      </p>
    );
  } else if (!outcome.ok) {
    notice = <GraphFailure doc={doc} failure={outcome} onRetry={load} />;
  } else if (doc.sha256 !== null && outcome.data.document.sha256 !== doc.sha256) {
    notice = (
      <p className="rounded-[3px] border border-error/50 px-4 py-3 font-mono text-xs leading-relaxed text-error">
        inkthread now holds a PDF under this id that is not the PDF this dossier read (sha256{" "}
        {short(outcome.data.document.sha256)}, not {short(doc.sha256)}), so no box is drawn on it.
      </p>
    );
  } else {
    const pages = outcome.data.document.pages;
    sizes = (page) => pages.find((p) => p.number === page) ?? null;
  }
  return (
    <div className="space-y-4">
      {notice}
      <PageList doc={doc} sizes={sizes} />
    </div>
  );
}

function GraphFailure({
  doc,
  failure,
  onRetry,
}: {
  doc: DocumentView;
  failure: Extract<ToolOutcome<Graph>, { ok: false }>;
  onRetry: () => void;
}) {
  const gone =
    failure.kind === "downstream_error" && (failure.status === 404 || failure.status === 410);
  if (gone && doc.kind === "upload") {
    return (
      <p className="rounded-[3px] border border-border-bright px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
        This upload’s pages are gone: inkthread keeps an uploaded PDF’s graph for an hour and never
        its bytes (DR-0029).{" "}
        <span className="text-fg-muted">
          The quoted passages remain in this dossier — in the evidence table above, certified by
          inkprint.
        </span>
      </p>
    );
  }
  if (gone && failure.kind === "downstream_error") {
    return (
      <p className="rounded-[3px] border border-error/50 px-4 py-3 font-mono text-xs text-error">
        inkthread no longer has this sample ({failure.status}).{" "}
        <span className="text-fg-muted">Its passages remain in the evidence table above.</span>
      </p>
    );
  }
  return <OutcomeNotice failure={failure} product="inkthread" onRetry={onRetry} />;
}

/**
 * Every quoted page, anchored for the evidence table: drawn once its size is known (`sizes`), a
 * plain entry before (or when it cannot be drawn) — the anchor and the excerpt links either way.
 */
function PageList({
  doc,
  sizes,
}: {
  doc: DocumentView;
  sizes: ((page: number) => PageSize | null) | null;
}) {
  const pages = [...new Set(doc.excerpts.map((e) => e.page))].sort((a, b) => a - b);
  return (
    <div
      className={sizes ? "grid gap-6 md:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"}
    >
      {pages.map((page) => (
        <PageView
          key={page}
          documentId={doc.documentId}
          page={page}
          size={sizes === null ? undefined : sizes(page)}
          excerpts={doc.excerpts.filter((e) => e.page === page)}
        />
      ))}
    </div>
  );
}

function PageView({
  documentId,
  page,
  size,
  excerpts,
}: {
  documentId: string;
  page: number;
  /** undefined: not loaded (or not loadable); null: the graph has no such page. */
  size: PageSize | null | undefined;
  excerpts: readonly Excerpt[];
}) {
  return (
    <section
      id={documentAnchor(documentId, page)}
      aria-label={`page ${page}`}
      className={`min-w-0 space-y-2 ${size === undefined ? "rounded-[3px] border border-border px-3 py-2.5 target:border-accent-violet" : ""}`}
    >
      {size === undefined ? (
        <p className="font-mono text-xs text-foreground">
          page {page}{" "}
          <span className="text-fg-muted">
            · {excerpts.length} quoted {excerpts.length === 1 ? "passage" : "passages"}
          </span>
        </p>
      ) : size === null ? (
        <p className="font-mono text-xs text-warning">
          page {page} is not in inkthread’s graph of this document, so it cannot be drawn.
        </p>
      ) : (
        <PageWithBoxes
          documentId={documentId}
          page={page}
          size={size}
          label="the quoted passages"
          boxes={excerpts.map((e) => ({ key: e.key, bbox: e.bbox, tone: "self" as const }))}
        />
      )}
      <ul className="space-y-0.5 font-mono text-[11px] text-fg-muted">
        {excerpts.map((e) => (
          <li key={e.key}>
            <a
              href={evidenceHref(e.key)}
              className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              {e.title}
            </a>{" "}
            <span translate="no">· {e.key}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
