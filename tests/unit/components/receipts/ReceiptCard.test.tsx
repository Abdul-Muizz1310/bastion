import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceiptCard } from "@/components/receipts/ReceiptCard";
import { links, textOf } from "../../helpers/html";

/**
 * The receipt is the brand spine's object (RR-0004): every product hands one back. A card names its
 * kind and serial, its subject, itemised lines, an optional stamp, and links to the full receipt.
 */

const base = {
  kind: "dossier",
  serial: "0f8a1c2e",
  title: "the sky is blue",
  lines: [
    { label: "evidence", value: "12 items" },
    { label: "products", value: "magpie · inkthread" },
  ],
};

describe("ReceiptCard", () => {
  it("prints the kind, the serial, the subject and every line", () => {
    const text = textOf(renderToStaticMarkup(<ReceiptCard {...base} />));
    expect(text).toContain("dossier");
    expect(text).toContain("#0f8a1c2e");
    expect(text).toContain("the sky is blue");
    expect(text).toContain("evidence");
    expect(text).toContain("12 items");
    expect(text).toContain("magpie · inkthread");
  });

  it("lists its lines as terms and values", () => {
    const html = renderToStaticMarkup(<ReceiptCard {...base} />);
    expect(html).toMatch(/<dl[\s>]/);
    expect(html.match(/<dt[\s>]/g)).toHaveLength(2);
    expect(html.match(/<dd[\s>]/g)).toHaveLength(2);
  });

  it("links the subject to the full receipt, so the link is named by the subject", () => {
    const html = renderToStaticMarkup(<ReceiptCard {...base} href="/d/abc" />);
    const all = links(html);
    expect(all).toHaveLength(1);
    expect(all[0]?.href).toBe("/d/abc");
    expect(all[0]?.name).toBe("the sky is blue");
  });

  it("has no link without an href", () => {
    expect(links(renderToStaticMarkup(<ReceiptCard {...base} />))).toHaveLength(0);
  });

  it("stamps a verdict in words, with its tone for colour", () => {
    const html = renderToStaticMarkup(
      <ReceiptCard {...base} stamp={{ text: "true", tone: "pass" }} />,
    );
    expect(html).toContain('data-tone="pass"');
    expect(textOf(html)).toContain("true");
  });

  it("uses the heading level it is given", () => {
    expect(renderToStaticMarkup(<ReceiptCard {...base} headingLevel={2} />)).toMatch(/<h2[\s>]/);
    expect(renderToStaticMarkup(<ReceiptCard {...base} />)).toMatch(/<h3[\s>]/);
  });

  it("prints a footer, e.g. a hash, when given one", () => {
    const html = renderToStaticMarkup(<ReceiptCard {...base} footer="sha256 9f2c…" />);
    expect(textOf(html)).toContain("sha256 9f2c…");
  });
});
