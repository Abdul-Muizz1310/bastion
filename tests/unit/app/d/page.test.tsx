import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const { notFound, connection, store, evidence, documents, receipts } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  connection: vi.fn(async () => {}),
  store: { findDossier: vi.fn(), loadSteps: vi.fn() },
  evidence: vi.fn(),
  documents: vi.fn(),
  receipts: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection }));
vi.mock("@/dossier/store", () => ({
  findDossier: (id: string) => store.findDossier(id),
  loadSteps: (id: string) => store.loadSteps(id),
}));
vi.mock("@/dossier/evidence", () => ({ listEvidence: (id: string) => evidence(id) }));
vi.mock("@/dossier/documents", () => ({ listDocuments: (id: string) => documents(id) }));
vi.mock("@/dossier/receipts", () => ({ listReceipts: (id: string) => receipts(id) }));

import DossierPage, { generateMetadata } from "@/app/d/[id]/page";
import { buttonNamed, buttons, isDisabled } from "../../components/tools/gate-fixtures";
import {
  auditReceiptRow,
  CERT_A,
  certificateReceiptRow,
  DOSSIER_ID,
  documentRow,
  dossierRow,
  envelopeReceiptRow,
  evidenceRow,
  passageRow,
  perfReceiptRow,
  REQUEST_ID,
  stepRows,
  transcriptFixture,
  transcriptReceipt,
} from "../../features/dossier/fixtures";
import { links, sliceByAttr, textOf } from "../../helpers/html";

/**
 * Spec 21 §6.6, "The dossier": public, per request, 404 for an unknown id, titled from the id
 * alone. A succeeded dossier is the permanent receipt rendered on the server; a running one is the
 * live island; a failed one shows its timeline with retry and every receipt it already holds.
 */

async function render(id = DOSSIER_ID): Promise<string> {
  return renderToStaticMarkup(await DossierPage({ params: Promise.resolve({ id }) }));
}

function seedFinished() {
  const t = transcriptFixture();
  t.rounds[0] = { ...t.rounds[0], argument_md: `350.00 per the schedule [cert:${CERT_A}].` } as never;
  store.findDossier.mockResolvedValue(dossierRow());
  store.loadSteps.mockResolvedValue(stepRows());
  evidence.mockResolvedValue([passageRow(), evidenceRow()]);
  documents.mockResolvedValue([documentRow()]);
  receipts.mockResolvedValue([
    certificateReceiptRow(CERT_A, "d5152b39-p12"),
    transcriptReceipt({ payload: t as never }),
    perfReceiptRow(),
    envelopeReceiptRow(),
    auditReceiptRow(),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  seedFinished();
});

describe("/d/[id]", () => {
  it("is titled from the id alone, never the database", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ id: DOSSIER_ID }) });
    expect(meta.title).toBe("dossier 5b1e0c3a");
    expect(meta.alternates?.canonical).toBe(`/d/${DOSSIER_ID}`);
    expect(store.findDossier).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown dossier, after waiting for a request", async () => {
    store.findDossier.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(connection).toHaveBeenCalled();
  });

  it("renders a succeeded dossier as the receipt, on the server: claim, verdict, evidence, transcript", async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toContain("The USPTO basic filing fee for a utility patent is 350 dollars.");
    expect(text).toMatch(/true/i);
    expect(text).toMatch(/82\s?%/);
    expect(html).toContain('id="e-d5152b39-p12"');
    const cite = links(html).find((l) => l.tag.includes("data-cite"));
    expect(cite?.href).toBe("#e-d5152b39-p12");
    expect(text).not.toMatch(/connecting to the live run/);
  });

  it("shows the perf receipt, the envelope and the audit trail link", async () => {
    const html = await render();
    expect(textOf(html)).toContain("CREATE INDEX ix_certificates_content_hash");
    expect(textOf(sliceByAttr(html, "data-section", "envelope"))).toContain("ZW52ZWxvcGUtc2lnbmF0dXJl");
    expect(links(html).map((l) => l.href)).toContain(`/audit/${REQUEST_ID}`);
  });

  it("offers verify everything and the receipts download", async () => {
    const html = await render();
    expect(isDisabled(buttonNamed(html, /verify everything/))).toBe(false);
    expect(links(html).map((l) => l.href)).toContain(`/api/dossiers/${DOSSIER_ID}/receipts`);
  });

  it("points from the verdict slip to verify everything, which sits at the end of a long receipt", async () => {
    const slip = sliceByAttr(await render(), "aria-label", "the verdict");
    const link = links(slip).find((l) => l.href === "#verify-title");
    expect(link?.name).toMatch(/verify everything/);
  });

  it("draws the documents behind inkthread's wake gate, anchored for the evidence rows", async () => {
    const html = await render();
    const section = sliceByAttr(html, "data-section", "documents");
    expect(section).toContain('data-gate="checking"');
    expect(section).toContain(`data-document="${documentRow().documentId}"`);
  });

  it("lists the eight stages in stage order, all settled, with no retry", async () => {
    // Postgres hands the rows back in no particular order (here: as updates left them).
    store.loadSteps.mockResolvedValue([...stepRows()].reverse());
    const html = await render();
    expect([...html.matchAll(/data-stage="([a-z]+)"/g)].map((m) => m[1])).toEqual([
      "wake",
      "gather",
      "read",
      "seal",
      "debate",
      "measure",
      "envelope",
      "record",
    ]);
    expect(buttons(html).some((b) => /retry from this stage/.test(b))).toBe(false);
  });

  it("renders a running dossier as the live island, with no receipt yet", async () => {
    store.findDossier.mockResolvedValue(
      dossierRow({ status: "running", verdict: null, confidence: null, envelopeId: null }),
    );
    store.loadSteps.mockResolvedValue(
      stepRows({
        seal: { status: "running", leaseUntil: new Date("2026-10-20T10:04:30Z"), finishedAt: null },
        debate: { status: "pending", attempt: 0 },
        measure: { status: "pending", attempt: 0 },
        envelope: { status: "pending", attempt: 0 },
        record: { status: "pending", attempt: 0 },
      }),
    );
    receipts.mockResolvedValue([]);
    const html = await render();
    const text = textOf(html);
    expect(links(html).map((l) => l.href)).not.toContain("#verify-title");
    expect(text).toMatch(/connecting to the live run/);
    expect(text).toMatch(/the receipt appears here once the run finishes/);
  });

  it("renders a failed dossier with retry on the failed stage and the receipts it holds", async () => {
    store.findDossier.mockResolvedValue(
      dossierRow({ status: "failed", verdict: null, confidence: null, envelopeId: null, error: "debate: x" }),
    );
    store.loadSteps.mockResolvedValue(
      stepRows({
        debate: { status: "error", error: "paper-trail.debate: downstream_error (500)" },
        measure: { status: "pending", attempt: 0 },
        envelope: { status: "pending", attempt: 0 },
        record: { status: "pending", attempt: 0 },
      }),
    );
    receipts.mockResolvedValue([certificateReceiptRow(CERT_A, "d5152b39-p12")]);
    const html = await render();
    const debate = sliceByAttr(html, "data-stage", "debate");
    expect(isDisabled(buttonNamed(debate, /retry from this stage/))).toBe(false);
    expect(html).toContain('id="e-d5152b39-p12"');
    expect(textOf(html)).toMatch(/no transcript/);
  });

  it("still renders a dossier whose step rows are not one per stage, and says it cannot follow it", async () => {
    // Only tampering produces this; verification fails its steps check. The page must not crash.
    store.findDossier.mockResolvedValue(
      dossierRow({ status: "running", verdict: null, confidence: null, envelopeId: null }),
    );
    store.loadSteps.mockResolvedValue(stepRows().slice(0, 7));
    receipts.mockResolvedValue([]);
    const html = await render();
    expect(html.match(/data-stage=/g)).toHaveLength(7);
    expect(textOf(html)).toMatch(/not one per stage/);
    expect(textOf(html)).not.toMatch(/connecting to the live run/);
  });

  it("renders a v1 dossier (no step rows) without inventing stages", async () => {
    store.findDossier.mockResolvedValue(dossierRow({ visitor: null, userId: "u1" }));
    store.loadSteps.mockResolvedValue([]);
    receipts.mockResolvedValue([]);
    const text = textOf(await render());
    expect(text).toMatch(/predates the eight-stage runner/);
  });

  it("never shows who composed it (visitor, user)", async () => {
    const html = await render();
    expect(html).not.toContain("v_kk6eooepno");
  });
});
