import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerfReceipt } from "@/features/dossier/components/PerfReceipt";
import { receiptView } from "@/features/dossier/receipt-view";
import { sliceByAttr, textOf } from "../../../helpers/html";
import { dossierRow, perfReceiptRow } from "../fixtures";

/**
 * Spec 21 §6.6: the perf receipt per service — each query's fingerprint, calls and times, and the
 * exact SQL of every suggestion; a service that did not answer says why. Its hash is shown whole
 * enough to check.
 */

function perf(payload?: unknown) {
  const v = receiptView({
    dossier: dossierRow(),
    evidence: [],
    documents: [],
    receipts: [payload === undefined ? perfReceiptRow() : perfReceiptRow({ payload: payload as never })],
  }).perf;
  if (v.kind !== "ok") throw new Error("fixture perf must parse");
  return v.value;
}

describe("PerfReceipt", () => {
  it("lists each service's queries with the exact CREATE INDEX it suggests", () => {
    const html = renderToStaticMarkup(<PerfReceipt perf={perf()} />);
    const inkprint = sliceByAttr(html, "data-service", "inkprint");
    expect(textOf(inkprint)).toContain("SELECT * FROM certificates WHERE content_hash = ?");
    expect(textOf(inkprint)).toMatch(/3 calls/);
    expect(textOf(inkprint)).toMatch(/41\.5 ms/);
    expect(textOf(inkprint)).toContain(
      "CREATE INDEX ix_certificates_content_hash ON certificates (content_hash);",
    );
  });

  it("says why a service has no queries: it did not answer", () => {
    const html = renderToStaticMarkup(<PerfReceipt perf={perf()} />);
    expect(textOf(sliceByAttr(html, "data-service", "magpie"))).toMatch(/did not answer.*asleep/);
  });

  it("shows the receipt hash", () => {
    expect(textOf(renderToStaticMarkup(<PerfReceipt perf={perf()} />))).toContain("d".repeat(16));
  });

  it("says when the dossier called no service that keeps a slowquery log", () => {
    const html = renderToStaticMarkup(
      <PerfReceipt perf={perf({ dossier_id: "x", request_id: "y", services: [] })} />,
    );
    expect(textOf(html)).toMatch(/no service .* slowquery/);
  });

  it("says a service answered with no queries for this request", () => {
    const html = renderToStaticMarkup(
      <PerfReceipt
        perf={perf({ dossier_id: "x", request_id: "y", services: [{ service: "paper-trail", queries: [] }] })}
      />,
    );
    expect(textOf(sliceByAttr(html, "data-service", "paper-trail"))).toMatch(/no queries/);
  });
});
