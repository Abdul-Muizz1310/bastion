import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceTable } from "@/features/dossier/components/EvidenceTable";
import { VerifyProvider } from "@/features/dossier/components/verify-context";
import { receiptView } from "@/features/dossier/receipt-view";
import { links, sliceByAttr, textOf } from "../../../helpers/html";
import { CERT_A, CERT_B, DOSSIER_ID, documentRow, dossierRow, evidenceRow, passageRow } from "../fixtures";
import { verifiedOk } from "./verify-fixtures";

/**
 * Spec 21 §6.6: the evidence table — product, locator, excerpt, certificate (linking to inkprint's
 * public page) and its verify state once "verify everything" ran.
 */

function rows() {
  return receiptView({
    dossier: dossierRow(),
    evidence: [passageRow(), evidenceRow(), evidenceRow({ id: "e3", stableId: "w-x-unsealed", certificateId: null })],
    documents: [documentRow()],
    receipts: [],
  }).evidence;
}

function render(children: ReactNode = createElement(EvidenceTable, { rows: rows() })) {
  return renderToStaticMarkup(children);
}

describe("EvidenceTable", () => {
  it("gives every row its e-<key> anchor", () => {
    const html = render();
    expect(html).toContain('id="e-d5152b39-p12"');
    expect(html).toContain('id="e-w-hackernews-41"');
    expect(html).toContain('id="e-w-x-unsealed"');
  });

  it("links each certificate to inkprint's public certificate page", () => {
    const hrefs = links(render()).map((l) => l.href);
    expect(hrefs).toContain(`https://inkprint-frontend.vercel.app/certificates/${CERT_A}`);
    expect(hrefs).toContain(`https://inkprint-frontend.vercel.app/certificates/${CERT_B}`);
  });

  it("shows product, locator and excerpt; a document row points at its page below", () => {
    const html = render();
    const passage = sliceByAttr(html, "id", "e-d5152b39-p12");
    expect(textOf(passage)).toContain("inkthread");
    expect(textOf(passage)).toContain("page 1");
    expect(textOf(passage)).toContain("Basic filing fee - Utility 350.00");
    expect(links(passage).map((l) => l.href)).toContain("#doc-d5152b39-8bbc-4141-ac06-9d5e70f98f99-p1");
    const web = sliceByAttr(html, "id", "e-w-hackernews-41");
    expect(links(web).map((l) => l.href)).toContain("https://news.ycombinator.com/item?id=41");
  });

  it("marks a scraped page's link nofollow ugc noreferrer (Ruling AK)", () => {
    const web = links(sliceByAttr(render(), "id", "e-w-hackernews-41")).find(
      (l) => l.href === "https://news.ycombinator.com/item?id=41",
    );
    expect(web?.tag).toMatch(/\srel="nofollow ugc noreferrer"/);
  });

  it("says a row was not certified instead of leaving the cell empty", () => {
    expect(textOf(sliceByAttr(render(), "id", "e-w-x-unsealed"))).toContain("not certified");
  });

  it("says the verify state is not checked yet, then each row's state once verified", () => {
    expect(textOf(render())).toContain("not checked yet");
    const html = render(
      <VerifyProvider dossierId={DOSSIER_ID} initial={verifiedOk()}>
        <EvidenceTable rows={rows()} />
      </VerifyProvider>,
    );
    expect(textOf(sliceByAttr(html, "id", "e-d5152b39-p12"))).toMatch(/\bpass\b/);
    expect(textOf(sliceByAttr(html, "id", "e-w-hackernews-41"))).toMatch(/\bfail\b/);
  });

  it("keeps its screen-reader text inside its scroller, so a phone page never scrolls sideways", () => {
    // An absolutely positioned sr-only caption escapes an unpositioned overflow container and
    // widens the page (seen at 390 px in the browser check).
    const scroller = /<section\b[^>]*aria-label="evidence, scrollable"[^>]*>/.exec(render())?.[0] ?? "";
    expect(scroller).toMatch(/class="[^"]*\boverflow-x-auto\b/);
    expect(scroller).toMatch(/class="[^"]*\brelative\b/);
  });

  it("says its certified rows are the pool handed to the debate, never all the debate saw (final review)", () => {
    // paper-trail may also search the web for what the pool cannot answer; its URL citations
    // show in the transcript, not here.
    const caption = textOf(/<caption\b[^>]*>([\s\S]*?)<\/caption>/.exec(render())?.[1] ?? "");
    expect(caption).toMatch(/^The dossier’s evidence; the certified items are the pool handed to the debate/);
    expect(caption).not.toMatch(/the debate saw/);
  });

  it("says there is no evidence when there is none", () => {
    expect(textOf(render(createElement(EvidenceTable, { rows: [] })))).toMatch(/no evidence/);
  });
});
