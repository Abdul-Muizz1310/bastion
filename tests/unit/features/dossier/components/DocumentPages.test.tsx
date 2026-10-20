import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Graph } from "@/capabilities/inkthread";
import { DocumentPages } from "@/features/dossier/components/DocumentPages";
import type { DocumentView } from "@/features/dossier/receipt-view";
import { fixture } from "../../../capabilities/harness";
import { type GateSeed, Seeded } from "../../../components/tools/gate-fixtures";
import { sliceByAttr, textOf } from "../../../helpers/html";
import { ok } from "../../tools/outcomes";

/**
 * Spec 21 §6.6: each document's pages with its excerpts drawn as boxes (page sizes from
 * `inkthread.graph`, behind inkthread's wake gate). An upload whose graph answers 404 or 410 says
 * its pages are gone (DR-0029) and that the quoted passages remain; a sample's 404 says inkthread
 * no longer has it.
 */

const graph = fixture("inkthread", "graph.json") as Graph;
const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";

function doc(over: Partial<DocumentView> = {}): DocumentView {
  return {
    documentId: DOC,
    kind: "sample",
    title: "uspto-fee-schedule.pdf",
    sha256: graph.document.sha256,
    graphHash: "4".repeat(64),
    pageCount: graph.document.page_count,
    excerpts: [
      { key: "d5152b39-p12", page: 1, bbox: [72, 140, 540, 260], title: "Patent fees" },
      { key: "d5152b39-t-t1", page: 1, bbox: [72, 300, 540, 700], title: "Table on page 1" },
    ],
    ...over,
  };
}

function render(d: DocumentView, initial?: Parameters<typeof DocumentPages>[0]["initial"], gate: GateSeed = "live") {
  return renderToStaticMarkup(
    <Seeded name="inkthread" services={["inkthread"]} gate={gate}>
      <DocumentPages documents={[d]} initial={initial} />
    </Seeded>,
  );
}

describe("DocumentPages", () => {
  it("draws each page that holds an excerpt, with one box per excerpt, anchored for the evidence table", () => {
    const html = render(doc(), { [DOC]: ok(graph, "rid-graph") });
    expect(html).toContain(`id="doc-${DOC}-p1"`);
    expect(html.match(/data-box="self"/g)).toHaveLength(2);
    expect(html).toContain("/api/tools/inkthread.page?documentId=");
  });

  it("anchors the document itself for the verify panel", () => {
    expect(render(doc(), { [DOC]: ok(graph, "rid-graph") })).toContain(`id="doc-${DOC}"`);
  });

  it("says an upload's pages are gone when inkthread answers 404 or 410 — the passages remain", () => {
    for (const status of [404, 410]) {
      const html = render(doc({ kind: "upload" }), {
        [DOC]: { ok: false, kind: "downstream_error", status, requestId: "rid" },
      });
      const text = textOf(sliceByAttr(html, "data-document", DOC));
      expect(text).toMatch(/pages are gone/);
      expect(text).toMatch(/an hour/);
      expect(text).toMatch(/quoted passages.*remain/);
      expect(html).not.toContain("data-box=");
    }
  });

  it("says inkthread no longer has a sample that answers 404", () => {
    const html = render(doc(), { [DOC]: { ok: false, kind: "downstream_error", status: 404, requestId: "rid" } });
    expect(textOf(html)).toMatch(/inkthread no longer has this sample/);
  });

  it("draws no box when inkthread now holds different bytes under this id", () => {
    const html = render(doc({ sha256: "0".repeat(64) }), { [DOC]: ok(graph, "rid-graph") });
    expect(html).not.toContain("data-box=");
    expect(textOf(html)).toMatch(/not the PDF this dossier read/);
  });

  it("says a document with no excerpt has nothing to draw", () => {
    expect(textOf(render(doc({ excerpts: [] }), { [DOC]: ok(graph, "rid-graph") }))).toMatch(
      /no passage of this document was quoted/,
    );
  });

  it("names an asleep inkthread as a limit while the gate wakes it", () => {
    const html = render(doc(), { [DOC]: { ok: false, kind: "asleep", requestId: null } }, "waking");
    expect(textOf(html)).toMatch(/inkthread is asleep/);
  });
});
