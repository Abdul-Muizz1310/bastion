import { describe, expect, it } from "vitest";
import { type Candidate, type Locator, selectEvidence, stem, stems } from "@/dossier/select-evidence";

const url = { kind: "url", url: "https://example.com/x" } as const;
const doc: Locator = {
  kind: "document",
  documentId: "d",
  sha256: "a".repeat(64),
  page: 1,
  bbox: [0, 0, 1, 1],
  nodeId: null,
};

function cand(key: string, text: string, extra: Partial<Candidate> = {}): Candidate {
  return {
    key,
    kind: "web",
    product: "magpie",
    title: key,
    url: "https://example.com",
    text,
    locator: url,
    ...extra,
  };
}

describe("stem", () => {
  it.each([
    ["rules", "rule"],
    ["taxes", "tax"],
    ["filing", "fil"],
    ["filed", "fil"],
    ["fee", "fee"],
    ["is", "is"],
    ["Fees", "fee"],
    ["bus", "bus"],
  ])("%s -> %s", (word, expected) => {
    expect(stem(word)).toBe(expected);
  });

  it("tokenises on non-letters and lowercases", () => {
    expect(stems("Fees: $75, per-filing!")).toEqual(["fee", "75", "per", "fil"]);
  });
});

describe("selectEvidence", () => {
  it("ranks the candidate sharing the claim's words first", () => {
    const out = selectEvidence("small entity fee reduction", [
      cand("a", "weather report for tomorrow"),
      cand("b", "the small entity pays a reduced fee"),
    ], 2);
    expect(out.map((c) => c.key)).toEqual(["b", "a"]);
  });

  it("matches across simple inflections", () => {
    const out = selectEvidence("filing fees", [cand("a", "nothing"), cand("b", "a fee was filed")], 1);
    expect(out[0]?.key).toBe("b");
  });

  it("boosts the five roles by 1.5 and tables by 1.2", () => {
    const out = selectEvidence("alpha", [
      cand("c", "alpha beta"),
      cand("b", "alpha betb", { kind: "table", product: "inkthread", locator: doc }),
      cand("a", "alpha betc", { kind: "passage", product: "inkthread", locator: doc, role: "obligation" }),
    ], 3);
    expect(out.map((c) => c.key)).toEqual(["a", "b", "c"]);
  });

  it("does not boost other roles", () => {
    const out = selectEvidence("alpha", [
      cand("a", "alpha one", { role: "example" }),
      cand("b", "alpha two", { role: "definition" }),
    ], 2);
    expect(out.map((c) => c.key)).toEqual(["b", "a"]);
  });

  it("breaks ties by key", () => {
    const out = selectEvidence("alpha", [cand("z", "alpha a"), cand("m", "alpha b"), cand("a", "alpha c")], 3);
    expect(out.map((c) => c.key)).toEqual(["a", "m", "z"]);
  });

  it("drops empty-text candidates and dedupes identical text keeping the better one", () => {
    const out = selectEvidence("alpha", [
      cand("a", "   "),
      cand("b", "alpha"),
      cand("c", "alpha", { role: "obligation" }),
    ], 5);
    expect(out.map((c) => c.key)).toEqual(["c"]);
  });

  it("never returns more than limit, and nothing for limit 0", () => {
    const pool = ["a", "b", "c", "d"].map((k) => cand(k, `alpha ${k}`));
    expect(selectEvidence("alpha", pool, 2)).toHaveLength(2);
    expect(selectEvidence("alpha", pool, 0)).toEqual([]);
  });

  it("with zero overlap returns the role-ordered top, never an empty pool (review focus 4)", () => {
    const out = selectEvidence("zebra quantum", [
      cand("a", "apples"),
      cand("b", "pears", { role: "exception" }),
      cand("c", "plums", { role: "example" }),
      cand("d", "figs", { role: "quantitative" }),
    ], 2);
    expect(out.map((c) => c.key)).toEqual(["b", "d"]);
  });

  it("with an empty claim also returns the role-ordered top", () => {
    const out = selectEvidence("", [cand("a", "x"), cand("b", "y", { role: "condition" })], 1);
    expect(out.map((c) => c.key)).toEqual(["b"]);
  });

  it("is deterministic regardless of input order", () => {
    const pool = ["a", "b", "c", "d", "e"].map((k, i) => cand(k, `alpha ${"beta ".repeat(i)}`));
    const one = selectEvidence("alpha beta", pool, 4).map((c) => c.key);
    const two = selectEvidence("alpha beta", [...pool].reverse(), 4).map((c) => c.key);
    expect(two).toEqual(one);
  });

  it("returns [] for an empty pool and rejects a bad limit", () => {
    expect(selectEvidence("x", [], 3)).toEqual([]);
    expect(() => selectEvidence("x", [], -1)).toThrow(RangeError);
    expect(() => selectEvidence("x", [], 1.5)).toThrow(RangeError);
  });

  it("does not mutate its input", () => {
    const pool = [cand("b", "alpha"), cand("a", "alpha")];
    const copy = structuredClone(pool);
    selectEvidence("alpha", pool, 2);
    expect(pool).toEqual(copy);
  });
});
