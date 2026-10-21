import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site/config";

/**
 * Spec 21 §2: there is no sign-in. What a tab, a search result and a link preview say about bastion
 * must describe v2 — eight products operated live and chained into one receipt — not v1's auth.
 */

const COPY = [SITE.title, SITE.description, ...SITE.keywords, SITE.card.comment, SITE.card.headline];

describe("site copy (spec 21 §2)", () => {
  it.each([/magic[- ]link/i, /sign[- ]?in/i, /\bRBAC\b/i, /role-based/i, /\blog ?in\b/i, /identity/i])(
    "never claims %s",
    (pattern) => {
      for (const text of COPY) expect(text).not.toMatch(pattern);
    },
  );

  it("says what v2 is: eight products and a receipt you can verify", () => {
    expect(SITE.description).toMatch(/eight|8/);
    expect(SITE.description).toMatch(/receipt/);
    expect(SITE.description).toMatch(/verif/);
  });

  it("uses the brand spine as the share card's headline", () => {
    expect(SITE.card.headline).toBe("tools that hand you a receipt.");
  });
});
