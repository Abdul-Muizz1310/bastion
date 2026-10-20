import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Graph } from "@/capabilities/inkthread";
import { DocumentPages } from "@/features/dossier/components/DocumentPages";
import type { DocumentView } from "@/features/dossier/receipt-view";
import { fixture } from "../../../capabilities/harness";
import { buttonNamed, type GateSeed, gateWith, isDisabled } from "../../../components/tools/gate-fixtures";
import { links, sliceByAttr, textOf } from "../../../helpers/html";
import { ok } from "../../tools/outcomes";

/**
 * Spec 21 §6.6 (Ruling AJ): each document's quoted pages, anchored `doc-<id>-p<N>` whatever happens
 * next, listing their excerpts. Nothing wakes inkthread for a visitor who only reads: "show on its
 * pages" opens a wake gate on demand, then the page sizes come from `inkthread.graph` and each
 * excerpt is drawn as a box. An upload whose graph answers 404 or 410 says its pages are gone
 * (DR-0029) and that the quoted passages remain; a sample's 404 says inkthread no longer has it.
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
      { key: "d5152b39-p40", page: 3, bbox: [72, 100, 540, 200], title: "Search fees" },
    ],
    ...over,
  };
}

/** The visitor asked to see the pages; the gate it opened is in `gate`. */
function shown(d: DocumentView, initial: Parameters<typeof DocumentPages>[0]["initial"], gate: GateSeed = "live") {
  return renderToStaticMarkup(
    <DocumentPages documents={[d]} initial={initial} initialShown initialGate={gateWith(["inkthread"], gate)} />,
  );
}

describe("DocumentPages — before the visitor asks (Ruling AJ)", () => {
  const html = renderToStaticMarkup(<DocumentPages documents={[doc()]} />);

  it("wakes nothing and loads no page image", () => {
    expect(html).not.toContain("data-gate=");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("inkthread.page");
  });

  it("anchors every quoted page, so the evidence table's locators always land", () => {
    expect(html).toContain(`id="doc-${DOC}"`);
    expect(html).toContain(`id="doc-${DOC}-p1"`);
    expect(html).toContain(`id="doc-${DOC}-p3"`);
  });

  it("lists each page's excerpts, linking back to their evidence rows", () => {
    const p1 = sliceByAttr(html, "id", `doc-${DOC}-p1`);
    expect(links(p1).map((l) => l.href)).toEqual(["#e-d5152b39-p12", "#e-d5152b39-t-t1"]);
    expect(textOf(p1)).toMatch(/page 1/);
  });

  it("offers to show the passages on their pages, saying it wakes inkthread", () => {
    expect(isDisabled(buttonNamed(html, /show on its pages/))).toBe(false);
    expect(textOf(html)).toMatch(/wakes inkthread/);
  });
});

describe("DocumentPages — once shown", () => {
  it("opens inkthread's wake gate and draws each excerpt as a box on its page", () => {
    const html = shown(doc(), { [DOC]: ok(graph, "rid-graph") });
    expect(html).toContain('data-gate="live"');
    expect(html.match(/data-box="self"/g)).toHaveLength(3);
    expect(html).toContain("/api/tools/inkthread.page?documentId=");
    expect(html).toContain(`id="doc-${DOC}-p1"`);
    expect(html).toContain(`id="doc-${DOC}-p3"`);
  });

  it("holds the page images until the gate is live", () => {
    const html = shown(doc(), {}, "waking");
    expect(html).toContain('data-gate="waking"');
    expect(html).not.toContain("<img");
    expect(html).toContain(`id="doc-${DOC}-p1"`);
  });

  it("says an upload's pages are gone when inkthread answers 404 or 410 — the passages remain", () => {
    for (const status of [404, 410]) {
      const html = shown(doc({ kind: "upload" }), {
        [DOC]: { ok: false, kind: "downstream_error", status, requestId: "rid" },
      });
      const text = textOf(sliceByAttr(html, "data-document", DOC));
      expect(text).toMatch(/pages are gone/);
      expect(text).toMatch(/an hour/);
      expect(text).toMatch(/quoted passages.*remain/);
      expect(html).not.toContain("data-box=");
      expect(html).toContain(`id="doc-${DOC}-p1"`);
    }
  });

  it("says inkthread no longer has a sample that answers 404", () => {
    const html = shown(doc(), { [DOC]: { ok: false, kind: "downstream_error", status: 404, requestId: "rid" } });
    expect(textOf(html)).toMatch(/inkthread no longer has this sample/);
  });

  it("draws no box when inkthread now holds different bytes under this id", () => {
    const html = shown(doc({ sha256: "0".repeat(64) }), { [DOC]: ok(graph, "rid-graph") });
    expect(html).not.toContain("data-box=");
    expect(textOf(html)).toMatch(/not the PDF this dossier read/);
  });

  it("names an asleep inkthread as a limit while the gate wakes it", () => {
    const html = shown(doc(), { [DOC]: { ok: false, kind: "asleep", requestId: null } }, "waking");
    expect(textOf(html)).toMatch(/inkthread is asleep/);
  });
});

describe("DocumentPages — a document nothing was quoted from", () => {
  it("says there is nothing to draw and offers nothing to wake", () => {
    const html = renderToStaticMarkup(<DocumentPages documents={[doc({ excerpts: [] })]} />);
    expect(textOf(html)).toMatch(/no passage of this document was quoted/);
    expect(html).not.toMatch(/show on its pages/);
  });
});
