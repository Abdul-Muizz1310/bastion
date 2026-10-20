import { describe, expect, it } from "vitest";
import { citationSegments, evidenceAnchor, evidenceHref } from "@/features/dossier/citations";

/**
 * Spec 21 §6.6, "The receipt": every `[cert:<id>]` in a transcript argument links to the evidence
 * row holding that certificate; a certificate no row holds is said, never linked. Pure.
 */

const A = "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b";
const B = "7c0d1e2f-3a4b-4c5d-8e6f-9a0b1c2d3e4f";
const keys = new Map([
  [A, "d5152b39-p12"],
  [B, "w-hackernews-41"],
]);

describe("citationSegments", () => {
  it("splits an argument into text and certificate citations, each with its evidence key", () => {
    expect(citationSegments(`The fee is 350.00 [cert:${A}].`, keys)).toEqual([
      { kind: "text", text: "The fee is 350.00 " },
      { kind: "cert", certificateId: A, key: "d5152b39-p12" },
      { kind: "text", text: "." },
    ]);
  });

  it("links several citations, adjacent ones included", () => {
    const segs = citationSegments(`[cert:${A}][cert:${B}] both say so`, keys);
    expect(segs.map((s) => (s.kind === "cert" ? s.key : s.text))).toEqual([
      "d5152b39-p12",
      "w-hackernews-41",
      " both say so",
    ]);
  });

  it("matches a certificate id whatever its case", () => {
    const [seg] = citationSegments(`[cert:${A.toUpperCase()}]`, keys);
    expect(seg).toEqual({ kind: "cert", certificateId: A.toUpperCase(), key: "d5152b39-p12" });
  });

  it("keeps a certificate no evidence row holds, with no key", () => {
    const other = "00000000-0000-4000-8000-000000000000";
    expect(citationSegments(`see [cert:${other}]`, keys)).toEqual([
      { kind: "text", text: "see " },
      { kind: "cert", certificateId: other, key: null },
    ]);
  });

  it("leaves text without citations whole, and an empty argument empty", () => {
    expect(citationSegments("No citation here [cert:] [url:x]", keys)).toEqual([
      { kind: "text", text: "No citation here [cert:] [url:x]" },
    ]);
    expect(citationSegments("", keys)).toEqual([]);
  });
});

describe("evidence anchors", () => {
  it("anchors a row at e-<key> and links to it with the key encoded", () => {
    expect(evidenceAnchor("d5152b39-p12")).toBe("e-d5152b39-p12");
    expect(evidenceHref("d5152b39-p12")).toBe("#e-d5152b39-p12");
    expect(evidenceHref("w-src-a b")).toBe("#e-w-src-a%20b");
  });
});
