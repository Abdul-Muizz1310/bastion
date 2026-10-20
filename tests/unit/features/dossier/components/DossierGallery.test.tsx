import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicDossier } from "@/dossier/gallery";
import { DossierGallery } from "@/features/dossier/components/DossierGallery";
import { links, textOf } from "../../../helpers/html";

/** Spec 21 §3.1: the gallery's three states — receipts, nothing finished yet, unavailable. */

function dossier(i: number, overrides: Partial<PublicDossier> = {}): PublicDossier {
  return {
    id: `0f8a1c2e-4b6d-4e8f-9a0b-${String(i).padStart(12, "0")}`,
    claim: `claim number ${i}`,
    mode: "standard",
    status: "succeeded",
    verdict: "FALSE",
    confidence: 0.8,
    createdAt: "2026-10-19T08:30:00.000Z",
    evidenceCount: 7,
    documentCount: 2,
    products: ["magpie"],
    ...overrides,
  };
}

describe("DossierGallery", () => {
  it("prints one receipt per dossier, each linking to its public page", () => {
    const html = renderToStaticMarkup(
      <DossierGallery gallery={{ kind: "ok", dossiers: [dossier(1), dossier(2)] }} />,
    );
    const hrefs = links(html).map((l) => l.href);
    expect(hrefs).toEqual([
      "/d/0f8a1c2e-4b6d-4e8f-9a0b-000000000001",
      "/d/0f8a1c2e-4b6d-4e8f-9a0b-000000000002",
    ]);
    expect(html.match(/<li[\s>]/g)).toHaveLength(2);
    const text = textOf(html);
    expect(text).toContain("claim number 1");
    expect(text).toContain("false · 80% confidence");
    expect(text).toContain("7 items");
    expect(text).toContain("magpie");
  });

  it("invites the first dossier when nothing has finished yet", () => {
    const html = renderToStaticMarkup(<DossierGallery gallery={{ kind: "ok", dossiers: [] }} />);
    expect(textOf(html)).toContain("no finished dossiers yet");
    expect(links(html).map((l) => l.href)).toEqual(["/dossier"]);
    expect(html).not.toMatch(/<ul[\s>]/);
  });

  it("says the gallery is unavailable, with a next step, when the database is not answering", () => {
    const html = renderToStaticMarkup(<DossierGallery gallery={{ kind: "unavailable" }} />);
    expect(textOf(html)).toContain("gallery is unavailable");
    expect(html).toContain('role="status"');
    expect(links(html).map((l) => l.href)).toEqual(["/dossier"]);
  });
});
