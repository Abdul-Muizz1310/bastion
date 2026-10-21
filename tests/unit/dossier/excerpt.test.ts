import { describe, expect, it } from "vitest";
import { EXCERPT_CHARS, excerptOf, storedExcerptOf } from "@/dossier/excerpt";

/** The excerpt an evidence row shows: what seal writes, and what Postgres hands back (spec 21 §6.3). */

describe("excerpt", () => {
  it("is the first 400 UTF-16 code units of the certified text", () => {
    const text = `${"a".repeat(EXCERPT_CHARS)}tail`;
    expect(EXCERPT_CHARS).toBe(400);
    expect(excerptOf(text)).toBe("a".repeat(400));
    expect(excerptOf("short")).toBe("short");
  });

  it("is stored as UTF-8: an astral character cut at the boundary comes back as U+FFFD", () => {
    const text = `${"a".repeat(399)}😀 tail`;
    expect(excerptOf(text).isWellFormed()).toBe(false);
    expect(storedExcerptOf(text)).toBe(`${"a".repeat(399)}�`);
    expect(storedExcerptOf("Café 東京")).toBe("Café 東京");
  });
});
