"use client";

import { useEffect } from "react";
import { type Graph, inkthread } from "@/capabilities/inkthread";
import { HELD_REASON } from "@/components/tools/held";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { PageWithBoxes } from "@/components/tools/PageWithBoxes";
import { useWakeReady } from "@/components/tools/WakeGate";
import { callTool } from "@/features/tools/client";
import type { ToolOutcome } from "@/features/tools/outcome";
import { useAction, useFirstLoad } from "@/features/tools/use-action";
import { documentAnchor, evidenceHref } from "../citations";
import type { DocumentView, Excerpt } from "../receipt-view";

/**
 * The documents a dossier quoted, with each excerpt drawn on its page (spec 21 §6.6): inkthread's
 * render of the page (`inkthread.page`) with the excerpts' boxes over it (`PageWithBoxes`), the
 * page sizes read from `inkthread.graph` once inkthread's wake gate is live. An upload whose graph
 * answers 404 or 410 is gone by design (DR-0029: inkthread keeps an upload for an hour and never
 * its bytes); the quoted passages stay in the dossier. Bytes that are not the PDF the dossier read
 * (another sha256) get no boxes.
 */

type Outcomes = Readonly<Record<string, ToolOutcome<Graph>>>;

export function DocumentPages({
  documents,
  initial = {},
}: {
  documents: readonly DocumentView[];
  /** Graph reads already answered, by document id (tests seed them). */
  initial?: Outcomes;
}) {
  return (
    <div className="space-y-8">
      {documents.map((d) => (
        <DocumentCard key={d.documentId} doc={d} initial={initial[d.documentId] ?? null} />
      ))}
    </div>
  );
}

function short(hash: string | null): string {
  return hash === null ? "not recorded" : `${hash.slice(0, 12)}…`;
}

function DocumentCard({ doc, initial }: { doc: DocumentView; initial: ToolOutcome<Graph> | null }) {
  const ready = useWakeReady();
  const graph = useAction<Graph>(initial);
  const firstLoad = useFirstLoad();
  const quoted = doc.excerpts.length > 0;
  const load = () =>
    void graph.run((signal) =>
      callTool(inkthread.graph, { documentId: doc.documentId }, { signal }),
    );

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the gate opens
  useEffect(() => {
    if (ready && quoted && firstLoad(graph.outcome)) load();
  }, [ready]);

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
      {quoted ? (
        <Pages doc={doc} graph={graph} ready={ready} onRetry={load} />
      ) : (
        <p className="font-mono text-xs text-fg-muted">
          no passage of this document was quoted, so there is nothing to draw.
        </p>
      )}
    </article>
  );
}

function Pages({
  doc,
  graph,
  ready,
  onRetry,
}: {
  doc: DocumentView;
  graph: { busy: boolean; outcome: ToolOutcome<Graph> | null };
  ready: boolean;
  onRetry: () => void;
}) {
  const { busy, outcome } = graph;
  if (outcome === null) {
    return (
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
  }
  if (!outcome.ok) {
    const gone =
      outcome.kind === "downstream_error" && (outcome.status === 404 || outcome.status === 410);
    if (gone && doc.kind === "upload") {
      return (
        <p className="rounded-[3px] border border-border-bright px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
          This upload’s pages are gone: inkthread keeps an uploaded PDF’s graph for an hour and
          never its bytes (DR-0029).{" "}
          <span className="text-fg-muted">
            The quoted passages remain in this dossier — in the evidence table above, certified by
            inkprint.
          </span>
        </p>
      );
    }
    if (gone) {
      return (
        <p className="rounded-[3px] border border-error/50 px-4 py-3 font-mono text-xs text-error">
          inkthread no longer has this sample ({outcome.status}).{" "}
          <span className="text-fg-muted">Its passages remain in the evidence table above.</span>
        </p>
      );
    }
    return <OutcomeNotice failure={outcome} product="inkthread" onRetry={onRetry} />;
  }

  const g = outcome.data;
  if (doc.sha256 !== null && g.document.sha256 !== doc.sha256) {
    return (
      <p className="rounded-[3px] border border-error/50 px-4 py-3 font-mono text-xs leading-relaxed text-error">
        inkthread now holds a PDF under this id that is not the PDF this dossier read (sha256{" "}
        {short(g.document.sha256)}, not {short(doc.sha256)}), so no box is drawn on it.
      </p>
    );
  }
  const pages = [...new Set(doc.excerpts.map((e) => e.page))].sort((a, b) => a - b);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {pages.map((page) => (
        <PageView
          key={page}
          documentId={doc.documentId}
          page={page}
          size={g.document.pages.find((p) => p.number === page) ?? null}
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
  size: { width: number; height: number } | null;
  excerpts: readonly Excerpt[];
}) {
  return (
    <section
      id={documentAnchor(documentId, page)}
      aria-label={`page ${page}`}
      className="min-w-0 space-y-2"
    >
      {size === null ? (
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
