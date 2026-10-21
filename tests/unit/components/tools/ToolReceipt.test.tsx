import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { receiptText } from "@/components/tools/receipt-text";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { links, textOf } from "../../helpers/html";

/**
 * Every result's receipt (spec 21 §5.1 invariant 3): the receipt card, a copy button that copies it
 * as plain text, and the request id linking to the call's audit trail.
 */

const RID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const props = {
  kind: "inkprint certificate",
  serial: "2b9f6a1e",
  title: "certified text",
  lines: [
    { label: "content hash", value: "9f2c1a…" },
    { label: "signature", value: "Ed25519" },
  ],
  requestId: RID,
};

describe("ToolReceipt", () => {
  it("prints the receipt: kind, serial, subject and every line", () => {
    const text = textOf(renderToStaticMarkup(<ToolReceipt {...props} />));
    for (const part of ["inkprint certificate", "#2b9f6a1e", "certified text", "content hash", "Ed25519"]) {
      expect(text).toContain(part);
    }
  });

  it("links the request id to its audit trail", () => {
    const audit = links(renderToStaticMarkup(<ToolReceipt {...props} />)).filter((l) =>
      l.href?.startsWith("/audit/"),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.href).toBe(`/audit/${RID}`);
    expect(audit[0]?.name).toMatch(/request 6f1d2c3b/);
    expect(audit[0]?.name).toMatch(/audit/);
  });

  it("has a named copy button", () => {
    const html = renderToStaticMarkup(<ToolReceipt {...props} />);
    const button = /<button\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toMatch(/aria-label="copy the inkprint certificate receipt"/);
  });
});

describe("receiptText", () => {
  it("is the receipt as plain text, with the full request id and any extra lines", () => {
    const text = receiptText({ ...props, stamp: { text: "valid", tone: "pass" }, extra: ["x: y"] });
    expect(text).toBe(
      [
        "inkprint certificate #2b9f6a1e",
        "certified text",
        "[valid]",
        "content hash: 9f2c1a…",
        "signature: Ed25519",
        "x: y",
        `request: ${RID}`,
        `audit: /audit/${RID}`,
      ].join("\n"),
    );
  });
});
