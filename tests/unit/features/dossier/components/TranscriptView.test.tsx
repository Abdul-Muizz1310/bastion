import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceTable } from "@/features/dossier/components/EvidenceTable";
import { TranscriptView } from "@/features/dossier/components/TranscriptView";
import { receiptView } from "@/features/dossier/receipt-view";
import { links, textOf } from "../../../helpers/html";
import {
  CERT_A,
  CERT_B,
  documentRow,
  dossierRow,
  envelopeReceiptRow,
  evidenceRow,
  passageRow,
  transcriptFixture,
  transcriptReceipt,
} from "../fixtures";

/**
 * Spec 21 §6.6: the transcript as the receipt shows it — every `[cert:<id>]` citation links to the
 * evidence row that holds the certificate, and that row's anchor exists on the page.
 */

const OTHER = "00000000-0000-4000-8000-0000000000ff";

function page(argumentOf: (round: number) => string = () => "") {
  const t = transcriptFixture();
  t.rounds = t.rounds.map((r, i) => ({ ...r, argument_md: argumentOf(i) || r.argument_md }));
  const view = receiptView({
    dossier: dossierRow(),
    evidence: [passageRow(), evidenceRow()],
    documents: [documentRow()],
    receipts: [transcriptReceipt({ payload: t as never }), envelopeReceiptRow()],
  });
  if (view.transcript.kind !== "ok") throw new Error("fixture transcript must parse");
  const evidence = renderToStaticMarkup(<EvidenceTable rows={view.evidence} />);
  const transcript = renderToStaticMarkup(
    <TranscriptView transcript={view.transcript.value} certificateKeys={view.certificateKeys} />,
  );
  return { evidence, transcript };
}

const anchorIds = (html: string) => new Set([...html.matchAll(/\sid="(e-[^"]+)"/g)].map((m) => m[1]));

describe("TranscriptView", () => {
  it("links every [cert:<id>] citation to an evidence row that exists on the page", () => {
    const { evidence, transcript } = page((i) =>
      i === 0 ? `350.00 [cert:${CERT_A}]` : i === 1 ? `Hacker News agrees [cert:${CERT_B}] [cert:${CERT_A}]` : "",
    );
    const ids = anchorIds(evidence);
    const certLinks = links(transcript).filter((l) => l.tag.includes("data-cite"));
    expect(certLinks).toHaveLength(3);
    for (const link of certLinks) {
      expect(link.href).toMatch(/^#e-/);
      expect(ids.has(decodeURIComponent(link.href?.slice(1) ?? ""))).toBe(true);
    }
    expect(certLinks.map((l) => l.href)).toEqual(["#e-d5152b39-p12", "#e-w-hackernews-41", "#e-d5152b39-p12"]);
  });

  it("names each citation link by its certificate, not a bare symbol", () => {
    const { transcript } = page((i) => (i === 0 ? `fee [cert:${CERT_A}]` : ""));
    const [link] = links(transcript).filter((l) => l.tag.includes("data-cite"));
    expect(link?.name).toMatch(/evidence .*certificate 2b9f6a1e/);
  });

  it("says a citation no evidence row holds, unlinked", () => {
    const { transcript } = page((i) => (i === 0 ? `elsewhere [cert:${OTHER}]` : ""));
    expect(links(transcript).filter((l) => l.tag.includes("data-cite"))).toHaveLength(0);
    expect(textOf(transcript)).toContain("not in this dossier’s evidence");
  });

  it("shows each round's side and number, the verdict, and the signed hash", () => {
    const { transcript } = page();
    const text = textOf(transcript);
    expect(text).toMatch(/proponent · round 1/);
    expect(text).toMatch(/skeptic · round 1/);
    expect(text).toMatch(/judge · round 1/);
    expect(text).toContain(transcriptFixture().transcript_hash.slice(0, 16));
    expect(text).toContain("Ed25519");
  });

  it("links a url citation only when it is http(s)", () => {
    const t = transcriptFixture();
    t.rounds[2] = {
      ...t.rounds[2],
      side: "judge",
      round: 1,
      argument_md: "x",
      confidence: null,
      citations: [
        { type: "url", ref: "https://www.uspto.gov/fees", title: "" },
        { type: "url", ref: "javascript:alert(1)", title: "bad" },
      ],
    };
    const html = renderToStaticMarkup(
      <TranscriptView
        transcript={{
          debateId: t.debate_id,
          hash: t.transcript_hash,
          signature: t.signature,
          signatureAlg: t.signature_alg,
          claim: t.claim,
          verdict: t.verdict,
          confidence: t.confidence,
          rounds: t.rounds.map((r) => ({
            side: r.side,
            round: r.round,
            argument: r.argument_md,
            citations: r.citations,
          })),
        }}
        certificateKeys={new Map()}
      />,
    );
    const hrefs = links(html).map((l) => l.href);
    expect(hrefs).toContain("https://www.uspto.gov/fees");
    expect(hrefs.some((h) => h?.startsWith("javascript"))).toBe(false);
    expect(textOf(html)).toContain("javascript:alert(1)");
  });
});
