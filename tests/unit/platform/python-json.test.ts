import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PyFloat, type PyJson, pythonFloatRepr, pythonJsonDumps } from "@/platform/python-json";

/**
 * Python's `json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` — the bytes
 * paper-trail signs a transcript over and inkprint signs an envelope over (spec 21 §6.5). Checked
 * against a corpus CPython itself wrote (`tests/fixtures/receipts/generate/py_json_corpus.py`):
 * floats in Python's `repr` (`1.0`, `1e-05`, `1e+16`), keys in code-point order, the same escapes.
 */

type Encoded =
  | null
  | boolean
  | number
  | string
  | Encoded[]
  | { $f: string }
  | { $d: [string, Encoded][] };
type Corpus = {
  python: string;
  floats: [string, string][];
  values: { value: Encoded; dumps: string }[];
};

const corpus = JSON.parse(
  readFileSync(resolve(__dirname, "../../fixtures/receipts/python-json.json"), "utf8"),
) as Corpus;

function fromBits(hex: string): number {
  return Buffer.from(hex, "hex").readDoubleBE(0);
}

function decode(e: Encoded): PyJson {
  if (e === null || typeof e !== "object") return e;
  if (Array.isArray(e)) return e.map(decode);
  if ("$f" in e) return new PyFloat(fromBits(e.$f));
  const out: { [key: string]: PyJson } = {};
  for (const [k, v] of e.$d) out[k] = decode(v);
  return out;
}

describe("pythonFloatRepr", () => {
  it(`matches CPython ${corpus.python}'s repr() on ${corpus.floats.length} doubles`, () => {
    const wrong = corpus.floats.filter(([bits, repr]) => pythonFloatRepr(fromBits(bits)) !== repr);
    expect(wrong).toEqual([]);
  });

  it.each([
    [1, "1.0"],
    [0, "0.0"],
    [-0, "-0.0"],
    [0.82, "0.82"],
    [1e-4, "0.0001"],
    [1e-5, "1e-05"],
    [5e-5, "5e-05"],
    [1e15, "1000000000000000.0"],
    [1e16, "1e+16"],
    [1.5e16, "1.5e+16"],
    [1e100, "1e+100"],
    [-2.5e-7, "-2.5e-07"],
  ])("%d is %s", (x, repr) => {
    expect(pythonFloatRepr(x)).toBe(repr);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "refuses %d (json.dumps would write NaN/Infinity, which no issuer serves)",
    (x) => {
      expect(() => pythonFloatRepr(x)).toThrow(TypeError);
    },
  );
});

describe("pythonJsonDumps", () => {
  it(`matches CPython's json.dumps on ${corpus.values.length} values`, () => {
    const wrong = corpus.values
      .map(({ value, dumps }) => ({ dumps, ours: pythonJsonDumps(decode(value)) }))
      .filter(({ dumps, ours }) => dumps !== ours);
    expect(wrong).toEqual([]);
  });

  it("writes an int as an int and a float as a float", () => {
    expect(pythonJsonDumps({ round: 1, confidence: new PyFloat(1) })).toBe(
      '{"confidence":1.0,"round":1}',
    );
  });

  it("sorts keys by code point, not by UTF-16 code unit", () => {
    const privateUse = String.fromCodePoint(0xe000);
    const astral = String.fromCodePoint(0x1f600);
    expect(pythonJsonDumps({ [astral]: 1, [privateUse]: 2 })).toBe(
      `{"${privateUse}":2,"${astral}":1}`,
    );
  });

  it("writes non-ASCII as itself and escapes control characters in lower-case hex", () => {
    expect(pythonJsonDumps(`é${String.fromCharCode(7)}\n"\\`)).toBe('"é\\u0007\\n\\"\\\\"');
  });

  describe("refuses what Python could not have serialised to UTF-8 (negative space)", () => {
    const bad: Array<[string, unknown]> = [
      ["a float passed as a plain number (int expected)", 0.5],
      ["an int beyond 2^53 (not exact in JS)", 2 ** 53],
      ["a non-finite float", new PyFloat(Number.NaN)],
      ["a lone surrogate", "\ud800"],
      ["a lone surrogate in a key", { "\udc00": 1 }],
      ["undefined", undefined],
      ["a function", () => 1],
      ["a bigint", BigInt(1)],
      ["a Date", new Date(0)],
      // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
      ["a sparse array", [1, , 3]],
    ];
    it.each(bad)("%s", (_name, value) => {
      expect(() => pythonJsonDumps(value as PyJson)).toThrow(TypeError);
    });

    it("a cycle", () => {
      const list: PyJson[] = [];
      list.push(list);
      expect(() => pythonJsonDumps(list)).toThrow(TypeError);
    });
  });
});
