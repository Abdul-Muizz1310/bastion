import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageWithBoxes } from "@/components/tools/PageWithBoxes";
import { textOf } from "../../helpers/html";

/**
 * The page with an element's boxes drawn (spec 21 §5, §5.1 invariant 7): inkthread's page PNG through
 * the gateway, and an SVG in page points laid over it, so the boxes scale with the image.
 */

const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";

const html = renderToStaticMarkup(
  <PageWithBoxes
    documentId={DOC}
    page={1}
    size={{ width: 612, height: 792 }}
    boxes={[
      { key: "self", bbox: [50.39, 242.62, 579.64, 368.18], tone: "self" },
      { key: "bad", bbox: [300, 10, 100, 50], tone: "self" },
    ]}
    label="paragraph p:c95bca1f"
  />,
);

describe("PageWithBoxes", () => {
  it("shows inkthread's rendered page through the tools route, at the page's aspect ratio", () => {
    const img = /<img\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(img).toContain(`src="/api/tools/inkthread.page?documentId=${DOC}&amp;page=1"`);
    expect(img).toContain('width="612"');
    expect(img).toContain('height="792"');
    expect(img).toMatch(/alt="page 1 of the document, with paragraph p:c95bca1f boxed"/);
  });

  it("lays an SVG in page points over it, one rectangle per drawable box", () => {
    expect(html).toContain('viewBox="0 0 612 792"');
    const rects = html.match(/<rect\b[^>]*data-box=/g) ?? [];
    expect(rects).toHaveLength(1);
    expect(html).toMatch(/<rect\b[^>]*x="50.39"[^>]*y="242.62"/);
  });

  it("names the page in a caption", () => {
    expect(textOf(/<figcaption[\s\S]*<\/figcaption>/.exec(html)?.[0] ?? "")).toMatch(/page 1/);
  });
});
