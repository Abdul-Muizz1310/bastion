import { describe, expect, it } from "vitest";
import type { PublicDossier } from "@/dossier/gallery";
import { dossierReceipt, GALLERY_SIZE, galleryItems } from "@/features/dossier/gallery-view";

/** Spec 21 §3.1: the gallery is the 6 most recent succeeded dossiers, each shown as a receipt. */

let n = 0;
function dossier(overrides: Partial<PublicDossier> = {}): PublicDossier {
  n += 1;
  return {
    id: `0f8a1c2e-4b6d-4e8f-9a0b-${String(n).padStart(12, "0")}`,
    claim: `claim ${n}`,
    mode: "rapid",
    status: "succeeded",
    verdict: "TRUE",
    confidence: 0.91,
    createdAt: "2026-10-20T10:00:00.000Z",
    evidenceCount: 12,
    documentCount: 1,
    products: ["inkthread", "magpie"],
    ...overrides,
  };
}

describe("galleryItems", () => {
  it("keeps only succeeded dossiers, newest first as given, at most 6", () => {
    const list = [
      dossier({ status: "running" }),
      ...Array.from({ length: 7 }, () => dossier()),
      dossier({ status: "failed" }),
    ];
    const items = galleryItems(list);
    expect(GALLERY_SIZE).toBe(6);
    expect(items).toHaveLength(6);
    expect(items.every((d) => d.status === "succeeded")).toBe(true);
    expect(items[0]).toBe(list[1]);
  });

  it("is empty when nothing has finished", () => {
    expect(galleryItems([dossier({ status: "pending" }), dossier({ status: "failed" })])).toEqual(
      [],
    );
  });
});

describe("dossierReceipt", () => {
  it("prints serial, claim, link, verdict stamp with confidence and the itemised lines", () => {
    const d = dossier({ id: "0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b", claim: "the sky is blue" });
    expect(dossierReceipt(d)).toEqual({
      kind: "dossier",
      serial: "0f8a1c2e",
      title: "the sky is blue",
      href: "/d/0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b",
      stamp: { text: "true", tone: "pass" },
      lines: [
        { label: "verdict", value: "true · 91% confidence" },
        { label: "evidence", value: "12 items" },
        { label: "documents", value: "1 PDF" },
        { label: "products", value: "inkthread · magpie" },
        { label: "mode", value: "rapid" },
      ],
      footer: "20 Oct 2026, 10:00 UTC",
    });
  });

  it.each([
    ["FALSE", "false", "fail"],
    ["INCONCLUSIVE", "inconclusive", "neutral"],
  ] as const)("stamps %s as %s", (verdict, text, tone) => {
    expect(dossierReceipt(dossier({ verdict })).stamp).toEqual({ text, tone });
  });

  it("writes singulars, an absent confidence and no products plainly", () => {
    const r = dossierReceipt(
      dossier({ evidenceCount: 1, documentCount: 0, confidence: null, products: [] }),
    );
    expect(r.lines).toEqual(
      expect.arrayContaining([
        { label: "verdict", value: "true" },
        { label: "evidence", value: "1 item" },
        { label: "documents", value: "none" },
        { label: "products", value: "none recorded" },
      ]),
    );
  });

  it("has no stamp and says so when a dossier has no verdict", () => {
    const r = dossierReceipt(dossier({ verdict: null, confidence: null }));
    expect(r.stamp).toBeUndefined();
    expect(r.lines[0]).toEqual({ label: "verdict", value: "none" });
  });

  it("rounds confidence to a whole percent and clamps it to 0–100", () => {
    expect(dossierReceipt(dossier({ confidence: 0.666 })).lines[0]?.value).toBe(
      "true · 67% confidence",
    );
    expect(dossierReceipt(dossier({ confidence: 1.4 })).lines[0]?.value).toBe(
      "true · 100% confidence",
    );
  });

  it("refuses an unparseable date rather than printing Invalid Date", () => {
    expect(() => dossierReceipt(dossier({ createdAt: "yesterday" }))).toThrow(RangeError);
  });
});
