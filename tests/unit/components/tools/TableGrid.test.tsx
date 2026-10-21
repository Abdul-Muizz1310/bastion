import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Reading } from "@/capabilities/inkthread";
import { headerCells, TableGrid } from "@/components/tools/TableGrid";
import { fixture } from "../../capabilities/harness";
import { textOf } from "../../helpers/html";

/**
 * inkgrid's exact table as a cell grid (spec 21 §5, §5.1): the header rows marked as headers, the
 * body as data, a merged banner drawn once across its columns.
 */

const reading = fixture("inkthread", "reading.json") as Reading;
const table = reading.tables[0] as Reading["tables"][number];

describe("headerCells", () => {
  it("draws a run of one merged header cell once, spanning its columns", () => {
    expect(headerCells(["a", "a", "a", "b"])).toEqual([
      { text: "a", span: 3, col: 0 },
      { text: "b", span: 1, col: 3 },
    ]);
  });

  it("keeps distinct neighbours apart", () => {
    expect(headerCells(["a", "b", "a"]).map((c) => c.span)).toEqual([1, 1, 1]);
  });
});

describe("TableGrid", () => {
  const html = renderToStaticMarkup(
    <TableGrid rows={table.rows} headerRows={table.header_rows} caption="table b8 · page 1" />,
  );

  it("marks the header rows as column headers in the table head", () => {
    const head = /<thead>([\s\S]*)<\/thead>/.exec(html)?.[1] ?? "";
    expect(head.match(/<tr/g)).toHaveLength(2);
    expect(head).toMatch(/<th[^>]*scope="col"/);
    expect(head).not.toContain("<td");
    expect(textOf(head)).toContain("Fee code");
  });

  it("draws the merged banner once across all six columns", () => {
    expect(html).toMatch(/<th[^>]*colSpan="6"[^>]*>Patent application filing fees<\/th>/i);
  });

  it("puts every other row in the body as data cells", () => {
    const body = /<tbody>([\s\S]*)<\/tbody>/.exec(html)?.[1] ?? "";
    expect(body.match(/<tr/g)).toHaveLength(table.rows.length - 2);
    expect(body).not.toContain("<th");
    expect(textOf(body)).toContain("350.00");
  });

  it("is a named, keyboard-scrollable region with its caption", () => {
    // A <section> with a label is a region landmark.
    expect(html).toMatch(/<section[^>]*aria-labelledby="[^"]+"[^>]*tabindex="0"/i);
    expect(html).toMatch(/<caption[^>]*>table b8 · page 1<\/caption>/);
  });

  it("has no head when the table has no header rows", () => {
    const plain = renderToStaticMarkup(<TableGrid rows={[["a", "b"]]} headerRows={0} caption="t" />);
    expect(plain).not.toContain("<thead");
  });

  it("refuses more header rows than the table has", () => {
    expect(() => renderToStaticMarkup(<TableGrid rows={[["a"]]} headerRows={2} caption="t" />)).toThrow(
      RangeError,
    );
  });
});
