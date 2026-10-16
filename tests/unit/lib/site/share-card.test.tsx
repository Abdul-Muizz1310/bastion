import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { shareCardAssets } from "@/lib/site/assets";
import { SITE } from "@/lib/site/config";
import {
  fitsIn,
  HEADLINE_SIZES,
  headlineSize,
  headlineWords,
  rgba,
  SHARE_CARD_SIZE,
  ShareCard,
  shareCardAlt,
} from "@/lib/site/share-card";

const plain = (text: string) => ({ text, highlight: false });
const lit = (text: string) => ({ text, highlight: true });

describe("20-site: headline words (case 8)", () => {
  it("splits the headline into words and marks the highlight, not its punctuation", () => {
    expect(headlineWords("prove who wrote it first.", "first")).toMatchObject([
      [plain("prove")],
      [plain("who")],
      [plain("wrote")],
      [plain("it")],
      [lit("first"), plain(".")],
    ]);
  });

  it("marks a highlight that spans words", () => {
    expect(headlineWords("watch AI argue with itself.", "AI argue")).toMatchObject([
      [plain("watch")],
      [lit("AI")],
      [lit("argue")],
      [plain("with")],
      [plain("itself.")],
    ]);
  });

  it("keys every segment by its offset in the headline", () => {
    const offsets = headlineWords("catch slow queries.", "slow")
      .flat()
      .map((s) => s.at);
    expect(offsets).toEqual([0, 6, 11]);
  });

  it("refuses a highlight the headline does not contain", () => {
    expect(() => headlineWords("catch slow queries.", "fast")).toThrow(/highlight/);
  });
});

describe("20-site: headline fit (case 8)", () => {
  it("wraps greedily at the column", () => {
    expect(fitsIn(["catch", "slow", "queries."], 10, 2)).toBe(true);
    expect(fitsIn(["catch", "slow", "queries."], 9, 2)).toBe(false);
  });

  it("never fits a word wider than the column", () => {
    expect(fitsIn(["supercalifragilistic"], 10, 5)).toBe(false);
  });

  it("sets a short headline at the largest size", () => {
    expect(headlineSize("catch slow queries.")).toBe(96);
  });

  it("steps down exactly at the two-line boundary", () => {
    // 1056 px / (0.6 × 96 px) = 18 columns at the largest size
    const full = `${"a".repeat(18)} ${"b".repeat(18)}`;
    expect(headlineSize(full)).toBe(96);
    expect(headlineSize(`${full}b`)).toBe(88);
  });

  it("falls back to the smallest size when nothing fits", () => {
    expect(headlineSize("x".repeat(60))).toBe(HEADLINE_SIZES.at(-1));
  });

  it("fits the real headline on two lines", () => {
    expect(headlineSize(SITE.card.headline)).toBe(96);
  });
});

describe("20-site: accent colours (case 8)", () => {
  it("turns #rrggbb into rgba with the given alpha", () => {
    expect(rgba("#a78bfa", 0.25)).toBe("rgba(167, 139, 250, 0.25)");
    expect(rgba("#0A0a0A", 1)).toBe("rgba(10, 10, 10, 1)");
  });
});

describe("20-site: share card (case 8)", () => {
  it("is the 1200×630 Open Graph size", () => {
    expect(SHARE_CARD_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it("describes itself in its alt text", () => {
    expect(shareCardAlt(SITE)).toBe("bastion — one gateway, every call audited.");
  });

  it("renders the name, the comment, the highlight in the accent and the live host", () => {
    const html = renderToStaticMarkup(<ShareCard site={SITE} icon="data:image/svg+xml;base64," />);
    expect(html).toContain(">bastion<");
    expect(html).toContain("// control plane · identity · audit");
    expect(html).toMatch(/color:#a78bfa[^>]*>audited</);
    expect(html).toContain("bastion-six.vercel.app");
  });

  it("loads both Geist Mono weights and the icon for the renderer", async () => {
    const { fonts, icon } = await shareCardAssets();
    expect(fonts.map((f) => `${f.name} ${f.weight}`)).toEqual(["Geist Mono 400", "Geist Mono 700"]);
    for (const font of fonts) expect(font.data.byteLength).toBeGreaterThan(10_000);
    expect(icon).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
