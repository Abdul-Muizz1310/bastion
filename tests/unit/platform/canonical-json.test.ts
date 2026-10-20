import { describe, expect, it } from "vitest";
import { canonicalJson, type Json } from "@/platform/canonical-json";

/**
 * Canonical JSON (spec 21 §6.5): the one byte string a receipt hashes, so that a stranger who holds
 * the same value gets the same digest. Keys sorted (UTF-16 code units, as RFC 8785), no whitespace,
 * strings and numbers exactly as JSON.stringify writes them, and nothing JSON cannot hold.
 */

/** A deterministic PRNG (mulberry32), so the shuffles are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same value with every object's keys inserted in a random order. */
function reinsert(value: Json, next: () => number): Json {
  if (Array.isArray(value)) return value.map((v) => reinsert(v, next));
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
  }
  const out: { [key: string]: Json } = {};
  for (const k of keys) out[k] = reinsert(value[k] as Json, next);
  return out;
}

const SAMPLE: Json = {
  dossier_id: "550e8400-e29b-41d4-a716-446655440000",
  services: [
    { service: "paper-trail", queries: [{ id: "a", calls: 3, total_ms: 412.7, max_ms: null }] },
    { service: "magpie", queries: [], error: "404" },
  ],
  nested: { z: [1, [2, [3, { y: true, x: false }]]], a: { c: "é", b: "日本" } },
  "": "empty key",
  Z: 1,
  a: 2,
};

describe("canonicalJson", () => {
  it("sorts keys and writes no whitespace", () => {
    expect(canonicalJson({ b: 1, a: [1, 2], c: { e: null, d: "x" } })).toBe(
      '{"a":[1,2],"b":1,"c":{"d":"x","e":null}}',
    );
  });

  it("does not depend on the order keys were inserted in (200 seeded shuffles)", () => {
    const expected = canonicalJson(SAMPLE);
    const next = rng(20261020);
    for (let i = 0; i < 200; i++) expect(canonicalJson(reinsert(SAMPLE, next))).toBe(expected);
  });

  it("sorts keys by UTF-16 code units: upper case before lower case, ASCII before accents", () => {
    expect(canonicalJson({ é: 1, z: 2, Z: 3, a: 4, "": 5 })).toBe('{"":5,"Z":3,"a":4,"z":2,"é":1}');
    // U+FF61 sorts after U+1F600's high surrogate (0xD83D) by code unit, not by code point.
    expect(canonicalJson({ "｡": 1, "😀": 2 })).toBe('{"😀":2,"｡":1}');
  });

  it("keeps unicode as itself and escapes what JSON must", () => {
    expect(canonicalJson({ k: "é 日本 😀" })).toBe('{"k":"é 日本 😀"}');
    expect(canonicalJson('quote " backslash \\ newline \n tab \t nul \u0000')).toBe(
      JSON.stringify('quote " backslash \\ newline \n tab \t nul \u0000'),
    );
    expect(canonicalJson({ "a\nb": "\u001f" })).toBe('{"a\\nb":"\\u001f"}');
  });

  it("writes a lone surrogate as an escape, so the output is always valid UTF-8", () => {
    expect(canonicalJson("\ud800")).toBe('"\\ud800"');
    expect(canonicalJson("\ud800").isWellFormed()).toBe(true);
  });

  it("keeps array order, including nested arrays, and sorts the objects inside them", () => {
    expect(canonicalJson([[3, 1], [2], [], [{ b: 1, a: 2 }]])).toBe(
      '[[3,1],[2],[],[{"a":2,"b":1}]]',
    );
    expect(canonicalJson([[3, 1], [2]])).not.toBe(canonicalJson([[1, 3], [2]]));
    expect(canonicalJson([[[[]]]])).toBe("[[[[]]]]");
  });

  it("writes numbers as JSON.stringify does", () => {
    for (const n of [0, -0, 1, -1, 1.5, 0.1, 0.1 + 0.2, 412.7, 1e21, 1e-7, 2 ** 53, -123.456e-10]) {
      expect(canonicalJson(n)).toBe(JSON.stringify(n));
    }
    expect(canonicalJson(-0)).toBe("0");
  });

  it("writes the JSON literals and empty containers", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson("")).toBe('""');
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  it("round-trips: parsing the output and canonicalising again gives the same string", () => {
    const once = canonicalJson(SAMPLE);
    expect(canonicalJson(JSON.parse(once) as Json)).toBe(once);
  });

  it("treats an own __proto__ key as data", () => {
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":0}') as Json;
    expect(canonicalJson(parsed)).toBe('{"__proto__":{"x":1},"a":0}');
  });

  it("accepts an object without a prototype", () => {
    const bare = Object.assign(Object.create(null) as { [key: string]: Json }, { b: 1, a: 2 });
    expect(canonicalJson(bare)).toBe('{"a":2,"b":1}');
  });

  describe("refuses what JSON cannot hold (negative space)", () => {
    const bad: Array<[string, unknown]> = [
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY],
      ["a nested NaN", { a: [1, Number.NaN] }],
      ["undefined", undefined],
      ["an undefined property", { a: undefined }],
      ["an undefined element", [1, undefined]],
      // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
      ["a sparse array", [1, , 3]],
      ["a bigint", BigInt(1)],
      ["a function", () => 1],
      ["a symbol", Symbol("s")],
      ["a Date", new Date(0)],
      ["a Map", new Map()],
      ["a class instance", new (class Box {})()],
      ["an array with an extra property", Object.assign([1], { x: 1 })],
    ];
    it.each(bad)("%s", (_name, value) => {
      expect(() => canonicalJson(value as Json)).toThrow(TypeError);
    });

    it("a cycle", () => {
      const a: { [key: string]: Json } = {};
      (a as Record<string, unknown>).self = a;
      expect(() => canonicalJson(a)).toThrow(TypeError);
      const list: Json[] = [];
      list.push(list);
      expect(() => canonicalJson(list)).toThrow(TypeError);
    });

    it("but not a value that is merely shared (a DAG is not a cycle)", () => {
      const shared = { x: 1 };
      expect(canonicalJson({ a: shared, b: [shared, shared] })).toBe(
        '{"a":{"x":1},"b":[{"x":1},{"x":1}]}',
      );
    });
  });
});
