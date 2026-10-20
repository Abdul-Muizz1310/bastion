import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import type { InkthreadDocument, Reading } from "@/capabilities/inkthread";
import { InkgridWorkbench } from "@/features/tools/inkgrid/InkgridWorkbench";
import { fixture } from "../../../capabilities/harness";
import { budgetsWith, buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { links, sliceByAttr, textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok, RID } from "../outcomes";

/**
 * inkgrid's workbench (spec 21 §5, §5.1): a sample or an upload, read by inkgrid through inkthread —
 * tables as cell grids, their exact text, the findings, and the verification report as the receipt.
 */

const samples = fixture("inkthread", "samples.json") as { items: InkthreadDocument[] };
const reading = fixture("inkthread", "reading.json") as Reading;
const DOC = reading.document_id;

function render(opts: Partial<Parameters<typeof Seeded>[0]> = {}, initial: object = {
  samples: ok(samples, "rid-samples"),
  doc: DOC,
  reading: ok(reading, RID),
}) {
  return renderToStaticMarkup(
    <Seeded name="inkgrid" services={["inkthread"]} {...opts}>
      <InkgridWorkbench initial={initial} />
    </Seeded>,
  );
}

describe("InkgridWorkbench", () => {
  it("renders without crashing when the wake fails, with the upload disabled", () => {
    const html = render({ gate: "failed" }, {});
    expect(html).toContain('data-gate="unknown"');
    expect(isDisabled(buttonNamed(html, /upload and read/))).toBe(true);
  });

  it("disables the upload at budget 0", () => {
    const html = render({ budgets: budgetsWith({ upload: { limit: 3, left: 0 } }) });
    expect(isDisabled(buttonNamed(html, /upload and read/))).toBe(true);
  });

  it("says in one line that the reading is inkthread's, which runs inkgrid", () => {
    expect(textOf(render())).toMatch(/inkgrid has no HTTP surface of its own/);
  });

  it("draws every table as a cell grid with its header rows marked, and its exact text", () => {
    const html = render();
    expect(html.match(/<table/g)).toHaveLength(reading.tables.length);
    expect(html).toMatch(/<th[^>]*scope="col"/);
    expect(textOf(html)).toContain("Basic filing fee - Utility");
    expect(html).toContain("| Fee code | 37 CFR");
  });

  it("gives each table its own disclosure at full width, the first one open", () => {
    const html = render();
    const tables = html.match(/<details\b[^>]*data-table=[^>]*>/g) ?? [];
    expect(tables).toHaveLength(reading.tables.length);
    expect(tables[0]).toMatch(/\sopen=""/);
    expect(tables[1]).not.toMatch(/\sopen=""/);
  });

  it("shows the verification report as the receipt", () => {
    const html = render();
    const text = textOf(html);
    expect(text).toMatch(/inkgrid verification/);
    expect(text).toContain(reading.verification.engine);
    expect(text).toMatch(/39 disagreements/);
    expect(auditHrefs(html)).toContain(`/audit/${RID}`);
    expect(copyButtons(html)).toContain("copy the inkgrid verification receipt");
  });

  it("shows an upload or job that met a sleeping inkthread as asleep, waking inkthread (Ruling AI)", () => {
    const html = render({}, { samples: ok(samples, "rid-samples"), upload: { ok: false, kind: "asleep", requestId: "rid-up" } });
    const notice = textOf(sliceByAttr(html, "data-kind", "asleep"));
    expect(notice).toMatch(/bastion is waking inkthread again above/);
  });

  it("links the same document to inkthread's graph", () => {
    expect(links(render()).some((l) => l.href === `/tools/inkthread?doc=${DOC}`)).toBe(true);
  });
});
